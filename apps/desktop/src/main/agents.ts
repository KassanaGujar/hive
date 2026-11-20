import { Notification, BrowserWindow } from 'electron'
import { Orchestrator, chatResultFrom } from './agentsHost'
import type { AgentRun, ApprovalRequest, InstalledModel } from '@hive/shared'
import { emit } from './ipc'
import { currentProject, projectRoot } from './project'
import { getSettings, store } from './store'
import { endpointFor, installedModels } from './models'
import { gitOps } from './git'
import { execCapture } from './terminal'
import { recordFeed } from './feed'
import { memoryBudgetGB } from './hardware'
import { smokeTestWeb } from './smoke'
import path from 'node:path'
import { afterModelError, capacityOf, classifyModelError, limitsFromError, offloadMessage, replyTokensFor, slowLocalModel, streamChat } from '@hive/models'
import { loadedModels } from './ollama'
import { isCliSource, learnedCapacity, recordOutcome, type ModelStats } from '@hive/agents'
import { runCli } from './cliAgents'

const approvals = new Map<string, { req: ApprovalRequest; resolve: (ok: boolean) => void }>()
let modelsCache: Awaited<ReturnType<typeof installedModels>> = []
/** HIVE_TEAM_MODELS (QA/advanced): only these installed models (Ollama names or ids, comma-separated) join the AI team. */
const AGENT_MAX_REPLY_TOKENS = Number(process.env.HIVE_AGENT_MAX_REPLY_TOKENS ?? 6144)
const teamOnly =(process.env.HIVE_TEAM_MODELS ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const persistTimers = new Map<string, NodeJS.Timeout>()

export async function refreshModels() {
  modelsCache = await installedModels()
  return modelsCache
}

const teamModels = () => (teamOnly.length ? modelsCache.filter((m) => teamOnly.includes(m.model) || teamOnly.includes(m.id)) : modelsCache)

// Free hosted models run out: a daily quota (Groq counts it per model, OpenRouter per account) or a per-minute size
// cap (Groq free: 8,000 tokens/minute). One exhausted model used to fail every remaining task of the run (a Groq batch:
// gpt-oss 20B hit its daily limit and eight challenges failed in seconds). Now the call moves to the best other team
// model that still has room; a model out of daily quota is skipped for 6 hours.
const exhaustedUntil = new Map<string, number>()
const tierRank = { top: 3, lead: 2, worker: 1 } as Record<string, number>
function standIns(model: InstalledModel, tried: Set<string>): InstalledModel[] {
  return teamModels()
    // subscription CLIs answer through runCli, not this HTTP path
    .filter((m) => !isCliSource(m.source) && !tried.has(m.id) && (exhaustedUntil.get(m.id) ?? 0) < Date.now())
    // hosted first (a local model on a small GPU is far slower), then the strongest
    .sort((a, b) => Number(a.source === 'ollama') - Number(b.source === 'ollama') || (tierRank[b.tier] ?? 0) - (tierRank[a.tier] ?? 0) || b.codingScore - a.codingScore)
}

export const orchestrator = new Orchestrator({
  projectRoot,
  models: teamModels,
  tierOverrides: () => getSettings().tierOverrides,
  modelStats: () => store.get<ModelStats>('modelStats', {}),
  recordOutcome(modelId, o) {
    store.set('modelStats', recordOutcome(store.get<ModelStats>('modelStats', {}), modelId, o))
  },
  async chat(model, messages, tools, { signal, onText, onModel }) {
    // Cap each reply: a small local model can loop without ever going quiet (Qwen3 4B produced one plan reply for an
    // hour, past its whole context), and the stall timer only catches silence. 6k tokens fits a whole game file.
    // Free hosted models are often briefly rate-limited (429 "temporarily rate-limited upstream"). Wait and retry.
    const tried = new Set<string>()
    let current = (exhaustedUntil.get(model.id) ?? 0) > Date.now() ? (standIns(model, tried)[0] ?? model) : model
    if (current !== model) onModel?.(current)
    let tries = 0 // failures on the current model
    for (;;) {
      try {
        const cap = capacityOf(current, learnedCapacity(store.get<ModelStats>('modelStats', {})[current.id]))
        const maxTokens = Math.min(AGENT_MAX_REPLY_TOKENS, replyTokensFor(cap))
        return await chatResultFrom(streamChat(endpointFor(current), messages, { tools, signal, maxTokens }), onText)
      } catch (e) {
        const msg = (e as Error).message ?? ''
        if (signal?.aborted) throw e
        // gpt-oss sometimes emits a garbled tool name ("read_file<|channel|>analysis") that the provider rejects.
        // It's random, so asking again usually works; it failed a whole Snake task on Groq after one try.
        const kind = classifyModelError(msg)
        const outOfQuota = kind === 'quota'
        // The provider names its own per-minute cap in the error ("OTPM: Limit 1000"): keep it so the router sizes
        // the next tasks for this model to fit, instead of learning it again from the next refusal.
        const stated = limitsFromError(msg)
        if (stated) {
          const stats = store.get<ModelStats>('modelStats', {})
          const r = stats[current.id] ?? { ok: { small: 0, medium: 0, large: 0 }, failed: { small: 0, medium: 0, large: 0 } }
          store.set('modelStats', { ...stats, [current.id]: { ...r, learned: { ...r.learned, ...stated } } })
        }
        // Retry a little, then move the task to another team model: a briefly rate-limited Gemma and a gpt-oss
        // sending broken tool calls each failed a whole task while other models on the team were free.
        const step = afterModelError(kind, tries)
        tries++
        if (step.action === 'fail') throw e
        if (step.action === 'retry') continue
        if (step.action === 'wait') {
          await new Promise((r) => setTimeout(r, step.ms))
          continue
        }
        if (step.restMs) {
          // OpenRouter's free allowance is per account: one model out of daily quota means all of them are.
          const rest = Date.now() + step.restMs
          for (const m of outOfQuota && current.source === 'openrouter' ? teamModels().filter((x) => x.source === 'openrouter') : [current]) exhaustedUntil.set(m.id, rest)
        }
        tried.add(current.id)
        const next = standIns(current, tried)[0]
        if (!next) {
          // nobody else to ask: a busy model is still worth waiting for a while
          if (kind === 'busy' && tries <= 4) {
            await new Promise((r) => setTimeout(r, 15000 * tries))
            continue
          }
          throw e
        }
        const why = { quota: 'is out of free daily quota', 'too-big': 'refused a request this large', busy: 'is rate-limited', 'bad-tool': 'keeps sending broken tool calls' }[kind ?? 'busy']
        console.log(`[agents] ${current.name} ${why}; using ${next.name}`)
        current = next
        tries = 0
        onModel?.(current)
      }
    }
  },
  git: gitOps,
  exec: execCapture,
  requestApproval(req) {
    return new Promise<boolean>((resolve) => {
      approvals.set(req.id, { req, resolve })
      emit('agents:approval', req)
      const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
      if (!focused && Notification.isSupported()) {
        new Notification({ title: 'Hive: an agent needs your OK', body: `${req.agent} wants to run: ${req.command}` }).show()
      }
    })
  },
  emit(run: AgentRun) {
    emit('agents:update', run)
    const project = currentProject()
    if (!project) return
    clearTimeout(persistTimers.get(run.id))
    persistTimers.set(run.id, setTimeout(() => store.runSave(project, run), 500))
  },
  log(runId, agent, taskId, line) {
    emit('agents:log', { runId, agent, taskId, line })
  },
  feed(ev) {
    recordFeed(ev)
  },
  memoryBudgetGB,
  smokeTest: smokeTestWeb,
  runCli,
  // HIVE_COORDINATION: auto (default), team, single, or off (QA: one agent alone, the baseline)
  coordination: () => {
    const v = process.env.HIVE_COORDINATION
    return v === 'off' || v === 'team' || v === 'single' ? v : 'auto'
  },
  fileWritten(runId, agent, taskId, absPath) {
    const rel = path.relative(projectRoot(), absPath).replace(/\\/g, '/')
    emit('agents:file', { runId, agent, taskId, path: rel })
  }
})

// With games or other apps holding the graphics card, Ollama put only 9 of 29 layers of a 7B model on it, wrote under
// 1 token a second, and one task ran 2.5 hours with nothing on screen saying why. Check while the team is working.
const ACTIVE_PHASES = new Set(['planning', 'working', 'merging'])
let offload: string | null = null
const warnedRuns = new Set<string>()
async function checkOffload() {
  const active = orchestrator.list().filter((r) => ACTIVE_PHASES.has(r.phase))
  const local = active.length > 0 && teamModels().some((m) => m.source === 'ollama')
  const slow = local ? slowLocalModel(await loadedModels()) : null
  const text = slow ? offloadMessage(slow) : null
  if (text !== offload) {
    offload = text
    emit('models:offload', text)
  }
  if (!text) return
  for (const r of active.filter((x) => !warnedRuns.has(x.id))) {
    warnedRuns.add(r.id)
    console.log(`[agents] ${text}`)
    emit('agents:log', { runId: r.id, agent: 'architect', line: `Warning: ${text}` })
  }
}
setInterval(() => void checkOffload().catch(() => {}), 30000).unref()
export const offloadWarning = () => offload

export async function startAgents(goal: string, preset?: { title: string; description: string }[], prd?: string) {
  await refreshModels()
  return orchestrator.start(goal, preset, prd)
}

export function answerApproval(id: string, ok: boolean) {
  const a = approvals.get(id)
  if (!a) return
  approvals.delete(id)
  a.resolve(ok)
}

export const pendingApprovals = () => [...approvals.values()].map((a) => a.req)

export function restoreRuns() {
  const project = currentProject()
  if (project) orchestrator.restore(store.runList(project))
}

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
import { classifyModelError, limitsFromError, streamChat } from '@hive/models'
import { recordOutcome, type ModelStats } from '@hive/agents'

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
const QUOTA_REST_MS = 6 * 60 * 60 * 1000
const tierRank = { top: 3, lead: 2, worker: 1 } as Record<string, number>
function standIns(model: InstalledModel, tried: Set<string>): InstalledModel[] {
  return teamModels()
    .filter((m) => !tried.has(m.id) && (exhaustedUntil.get(m.id) ?? 0) < Date.now())
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
    for (let attempt = 0; ; attempt++) {
      try {
        return await chatResultFrom(streamChat(endpointFor(current), messages, { tools, signal, maxTokens: AGENT_MAX_REPLY_TOKENS }), onText)
      } catch (e) {
        const msg = (e as Error).message ?? ''
        if (signal?.aborted) throw e
        // gpt-oss sometimes emits a garbled tool name ("read_file<|channel|>analysis") that the provider rejects.
        // It's random, so asking again usually works; it failed a whole Snake task on Groq after one try.
        const kind = classifyModelError(msg)
        if (kind === 'bad-tool' && attempt < 2) continue
        const outOfQuota = kind === 'quota'
        // The provider names its own per-minute cap in the error ("OTPM: Limit 1000"): keep it so the router sizes
        // the next tasks for this model to fit, instead of learning it again from the next refusal.
        const stated = limitsFromError(msg)
        if (stated) {
          const stats = store.get<ModelStats>('modelStats', {})
          const r = stats[current.id] ?? { ok: { small: 0, medium: 0, large: 0 }, failed: { small: 0, medium: 0, large: 0 } }
          store.set('modelStats', { ...stats, [current.id]: { ...r, learned: { ...r.learned, ...stated } } })
        }
        if (outOfQuota || kind === 'too-big') {
          if (outOfQuota) {
            // OpenRouter's free allowance is per account: one model out means all of them are.
            const rest = Date.now() + QUOTA_REST_MS
            for (const m of current.source === 'openrouter' ? teamModels().filter((x) => x.source === 'openrouter') : [current]) exhaustedUntil.set(m.id, rest)
          }
          tried.add(current.id)
          const next = standIns(current, tried)[0]
          if (!next) throw e
          console.log(`[agents] ${current.name} ${outOfQuota ? 'is out of free daily quota' : 'refused a request this large'}; using ${next.name}`)
          current = next
          onModel?.(current)
          continue
        }
        if (kind !== 'busy' || attempt >= 4) throw e
        await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)))
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
  fileWritten(runId, agent, taskId, absPath) {
    const rel = path.relative(projectRoot(), absPath).replace(/\\/g, '/')
    emit('agents:file', { runId, agent, taskId, path: rel })
  }
})

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

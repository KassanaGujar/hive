import { applyPlannerEdits, planForPrompt, setArray, undoEdit, replaceById, type AppliedEdit, type PlannerEdit, type PlanItem, type Proposal } from '@hive/collab'
import { extractJson } from '@hive/models'
import { mvpPrompt, plannerPrompt } from '@hive/agents/prompts'
import { invoke } from '../lib/api'
import type { ProjectSession } from './session'

export const AUTO_EVERY = 4

/** Messages in the planning room the Planner hasn't read yet. */
export function unreadPlanning(s: ProjectSession) {
  const cursor = s.parts.plannerCursor.get('at') ?? 0
  return s.parts.chat.toArray().filter((m) => m.channel === 'planning' && m.at > cursor)
}

let running = false

/**
 * Read new planning chat, ask the Architect model for traceable edits, apply them. Human-edited
 * items are never overwritten — those edits become proposals.
 */
export async function runPlanner(s: ProjectSession): Promise<{ applied: number; proposals: number }> {
  if (running) return { applied: 0, proposals: 0 }
  const msgs = unreadPlanning(s)
  if (!msgs.length) return { applied: 0, proposals: 0 }
  running = true
  try {
    const team = await invoke('agents:team')
    const model = team.architect
    if (!model) throw new Error('Download a model first — the Planner uses your strongest model.')
    const transcript = msgs.map((m) => `${m.id}: ${m.author}: ${m.text}`).join('\n')
    const items = s.parts.plan.toArray()
    const reply = await invoke('chat:once', model.id, [
      { role: 'system', content: 'You maintain a team plan document. Answer with JSON only.' },
      { role: 'user', content: plannerPrompt(planForPrompt(items), transcript) }
    ])
    const j = extractJson<{ edits?: PlannerEdit[] } | PlannerEdit[]>(reply)
    const edits = Array.isArray(j) ? j : j?.edits ?? []
    let r = applyPlannerEdits(items, edits, msgs.map((m) => m.id))
    // The doc must always be a usable PRD/MVP: a goal plus tasks the agents can build.
    const mvp = await mvpEdits(model.id, r.items, s)
    if (mvp.length) {
      const r2 = applyPlannerEdits(r.items, mvp, msgs.map((m) => m.id))
      r = { items: r2.items, applied: [...r.applied, ...r2.applied], proposals: [...r.proposals, ...r2.proposals] }
    }
    s.doc.transact(() => {
      setArray(s.parts.plan, r.items)
      if (r.applied.length) s.parts.planLog.push(r.applied)
      if (r.proposals.length) s.parts.proposals.push(r.proposals)
      s.parts.plannerCursor.set('at', Math.max(...msgs.map((m) => m.at)))
    })
    if (r.applied.length) {
      s.pushFeed({
        id: `f${Date.now().toString(36)}`,
        at: Date.now(),
        actor: 'planner',
        actorType: 'agent',
        kind: 'plan.updated',
        files: [],
        summary: `updated the plan (${r.applied.length} change${r.applied.length === 1 ? '' : 's'})`
      })
    }
    return { applied: r.applied.length, proposals: r.proposals.length }
  } finally {
    running = false
  }
}

/**
 * PRD/MVP pass: small models often add features but no goal or tasks. When either is missing, ask
 * specifically for them (cited to the planning chat); if the model still can't, derive them.
 */
async function mvpEdits(modelId: string, items: PlanItem[], s: ProjectSession): Promise<PlannerEdit[]> {
  const hasGoal = items.some((i) => i.section === 'goal')
  const hasTasks = items.some((i) => i.section === 'tasks')
  if (hasGoal && hasTasks) return []
  const chat = s.parts.chat.toArray().filter((m) => m.channel === 'planning')
  const ids = chat.map((m) => m.id)
  const features = items.filter((i) => i.section === 'features').map((i) => i.text)
  let goal: string | undefined
  let tasks: string[] = []
  try {
    const reply = await invoke('chat:once', modelId, [
      { role: 'system', content: 'You write short product plans. Answer with JSON only.' },
      { role: 'user', content: mvpPrompt(chat.map((m) => `${m.author}: ${m.text}`).join('\n'), features) }
    ])
    const j = extractJson<{ goal?: unknown; tasks?: unknown }>(reply)
    if (typeof j?.goal === 'string') goal = j.goal
    if (Array.isArray(j?.tasks)) tasks = j!.tasks.map((t) => (typeof t === 'string' ? t : (t as { title?: string })?.title ?? '')).filter(Boolean).slice(0, 6)
  } catch {
    /* fall back below */
  }
  goal ??= chat[0] ? chat[0].text.slice(0, 140) : undefined
  if (!tasks.length) tasks = features.slice(0, 6)
  const out: PlannerEdit[] = []
  if (!hasGoal && goal) out.push({ section: 'goal', op: 'add', text: goal, sources: ids })
  if (!hasTasks) for (const t of tasks) out.push({ section: 'tasks', op: 'add', text: t, status: 'todo', sources: ids })
  return out
}

export function undoPlannerEdit(s: ProjectSession, edit: AppliedEdit): boolean {
  const next = undoEdit(s.parts.plan.toArray(), edit)
  if (!next) return false
  s.doc.transact(() => {
    setArray(s.parts.plan, next)
    replaceById(s.parts.planLog, edit.id, { ...edit, undone: true })
  })
  return true
}

export function resolveProposal(s: ProjectSession, p: Proposal, accept: boolean, who: string) {
  s.doc.transact(() => {
    if (accept) {
      const items = s.parts.plan.toArray()
      const target = items.find((i) => i.id === p.itemId)
      if (target) {
        if (p.op === 'remove') setArray(s.parts.plan, items.filter((i) => i.id !== p.itemId))
        else {
          const next: PlanItem = {
            ...target,
            text: p.text ?? target.text,
            owner: p.owner ?? target.owner,
            status: p.status ?? target.status,
            sources: [...new Set([...target.sources, ...p.sources])],
            at: Date.now(),
            by: who
          }
          replaceById(s.parts.plan, target.id, next)
        }
      }
    }
    replaceById<Proposal>(s.parts.proposals, p.id, { ...p, state: accept ? 'accepted' : 'rejected' })
  })
}

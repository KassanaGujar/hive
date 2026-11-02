import { applyPlannerEdits, planForPrompt, setArray, undoEdit, replaceById, type AppliedEdit, type PlannerEdit, type PlanItem, type Proposal } from '@hive/collab'
import { extractJson } from '@hive/models'
import { plannerPrompt } from '@hive/agents/prompts'
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
    const r = applyPlannerEdits(items, edits, msgs.map((m) => m.id))
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

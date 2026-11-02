/** The living plan doc (F7). Pure functions over plain objects so they're easy to test. */

export type PlanSection = 'goal' | 'features' | 'decisions' | 'questions' | 'tasks' | 'who'

export const PLAN_SECTIONS: { id: PlanSection; title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'features', title: 'Features' },
  { id: 'decisions', title: 'Decisions' },
  { id: 'questions', title: 'Open questions' },
  { id: 'tasks', title: 'Tasks' },
  { id: 'who', title: "Who's doing what" }
]

export interface PlanItem {
  id: string
  section: PlanSection
  text: string
  owner?: string
  status?: 'todo' | 'doing' | 'done'
  /** 'ai' or the person's name */
  by: string
  /** chat message ids this came from */
  sources: string[]
  /** true once a person edited it; the AI must propose rather than overwrite */
  humanEdited: boolean
  at: number
}

export interface PlannerEdit {
  section?: string
  op?: string
  itemId?: string
  text?: string
  owner?: string
  status?: string
  sources?: unknown[]
}

/** One applied AI edit, kept so it can be undone. */
export interface AppliedEdit {
  id: string
  batch: string
  op: 'add' | 'update' | 'remove'
  before: PlanItem | null
  after: PlanItem | null
  sources: string[]
  at: number
  undone?: boolean
}

export interface Proposal {
  id: string
  itemId: string
  op: 'update' | 'remove'
  text?: string
  owner?: string
  status?: PlanItem['status']
  sources: string[]
  at: number
  state: 'open' | 'accepted' | 'rejected'
}

const SECTIONS = new Set(PLAN_SECTIONS.map((s) => s.id))
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const rid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export function applyPlannerEdits(
  items: PlanItem[],
  edits: PlannerEdit[],
  batchMessageIds: string[]
): { items: PlanItem[]; applied: AppliedEdit[]; proposals: Proposal[] } {
  const out = items.map((i) => ({ ...i }))
  const applied: AppliedEdit[] = []
  const proposals: Proposal[] = []
  const batch = rid('b')
  const validIds = new Set(batchMessageIds)
  const now = Date.now()

  for (const e of edits ?? []) {
    let sources = (e.sources ?? []).map(String).filter((s) => validIds.has(s))
    if (!sources.length) sources = [...batchMessageIds]
    const op = e.op === 'update' || e.op === 'remove' ? e.op : 'add'
    const status = (['todo', 'doing', 'done'] as const).find((s) => s === e.status)

    if (op === 'add') {
      const section = SECTIONS.has(e.section as PlanSection) ? (e.section as PlanSection) : 'features'
      const text = String(e.text ?? '').trim()
      if (!text) continue
      const dup = out.find((i) => i.section === section && norm(i.text) === norm(text))
      if (dup) {
        const before = { ...dup }
        dup.sources = [...new Set([...dup.sources, ...sources])]
        if (!dup.humanEdited) applied.push({ id: rid('e'), batch, op: 'update', before, after: { ...dup }, sources, at: now })
        continue
      }
      // The goal section holds one item; a new goal replaces an AI-written one.
      if (section === 'goal') {
        const g = out.find((i) => i.section === 'goal')
        if (g) {
          if (g.humanEdited) {
            proposals.push({ id: rid('p'), itemId: g.id, op: 'update', text, sources, at: now, state: 'open' })
            continue
          }
          const before = { ...g }
          Object.assign(g, { text, sources: [...new Set([...g.sources, ...sources])], at: now })
          applied.push({ id: rid('e'), batch, op: 'update', before, after: { ...g }, sources, at: now })
          continue
        }
      }
      const item: PlanItem = {
        id: rid('i'),
        section,
        text,
        owner: section === 'tasks' || section === 'who' ? e.owner : undefined,
        status: section === 'tasks' ? status ?? 'todo' : undefined,
        by: 'ai',
        sources,
        humanEdited: false,
        at: now
      }
      out.push(item)
      applied.push({ id: rid('e'), batch, op: 'add', before: null, after: { ...item }, sources, at: now })
      continue
    }

    const target = out.find((i) => i.id === e.itemId)
    if (!target) continue
    if (target.humanEdited || target.by !== 'ai') {
      proposals.push({
        id: rid('p'),
        itemId: target.id,
        op,
        text: e.text,
        owner: e.owner,
        status,
        sources,
        at: now,
        state: 'open'
      })
      continue
    }
    const before = { ...target }
    if (op === 'remove') {
      out.splice(out.indexOf(target), 1)
      applied.push({ id: rid('e'), batch, op, before, after: null, sources, at: now })
    } else {
      if (e.text) target.text = String(e.text)
      if (e.owner !== undefined) target.owner = e.owner
      if (status) target.status = status
      target.sources = [...new Set([...target.sources, ...sources])]
      target.at = now
      applied.push({ id: rid('e'), batch, op, before, after: { ...target }, sources, at: now })
    }
  }
  return { items: out, applied, proposals }
}

/** Undo one applied AI edit (only if nobody changed that item since). */
export function undoEdit(items: PlanItem[], edit: AppliedEdit): PlanItem[] | null {
  const out = items.map((i) => ({ ...i }))
  if (edit.op === 'add') {
    const idx = out.findIndex((i) => i.id === edit.after!.id)
    if (idx < 0) return out
    if (out[idx].humanEdited) return null
    out.splice(idx, 1)
    return out
  }
  if (edit.op === 'remove') {
    out.push({ ...edit.before! })
    return out
  }
  const idx = out.findIndex((i) => i.id === edit.before!.id)
  if (idx < 0 || out[idx].humanEdited) return null
  out[idx] = { ...edit.before! }
  return out
}

export function humanEdit(item: PlanItem, patch: Partial<Pick<PlanItem, 'text' | 'owner' | 'status'>>, who: string): PlanItem {
  return { ...item, ...patch, humanEdited: true, by: item.by === 'ai' ? item.by : who, at: Date.now() }
}

export function planToMarkdown(items: PlanItem[], title = 'Plan'): string {
  const lines = [`# ${title}`, '']
  for (const s of PLAN_SECTIONS) {
    lines.push(`## ${s.title}`, '')
    const list = items.filter((i) => i.section === s.id)
    if (!list.length) lines.push('_(empty)_')
    for (const i of list) {
      if (s.id === 'tasks') {
        const box = i.status === 'done' ? 'x' : ' '
        lines.push(`- [${box}] ${i.text}${i.owner ? ` — @${i.owner}` : ''}${i.status === 'doing' ? ' _(in progress)_' : ''}`)
      } else if (s.id === 'goal') lines.push(i.text)
      else lines.push(`- ${i.text}${i.owner ? ` — @${i.owner}` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** Plan → compact JSON the Planner prompt sees. */
export function planForPrompt(items: PlanItem[]): string {
  return JSON.stringify(
    items.map((i) => ({ id: i.id, section: i.section, text: i.text, owner: i.owner, status: i.status, human: i.humanEdited })),
    null,
    0
  )
}

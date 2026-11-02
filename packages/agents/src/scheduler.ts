import type { AgentPlan, AgentTask, PlanTask, TaskStatus } from '@hive/shared'

const DONE: TaskStatus[] = ['merged']
const ACTIVE: TaskStatus[] = ['running', 'review', 'changes-requested', 'approved', 'blocked']
const TERMINAL_BAD: TaskStatus[] = ['failed', 'cancelled']

/** Tasks whose dependencies are all merged and which haven't started yet. */
export function readyTasks(tasks: AgentTask[]): AgentTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return tasks.filter(
    (t) =>
      (t.status === 'pending' || t.status === 'ready') &&
      t.dependsOn.every((d) => {
        const dep = byId.get(d)
        return !dep || DONE.includes(dep.status)
      })
  )
}

/** Tasks that can never run because a dependency failed or was cancelled. */
export function starvedTasks(tasks: AgentTask[]): AgentTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const bad = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    const t = byId.get(id)
    if (!t) return false
    return TERMINAL_BAD.includes(t.status) || t.dependsOn.some((d) => bad(d, seen))
  }
  return tasks.filter((t) => t.status === 'pending' && t.dependsOn.some((d) => bad(d)))
}

export function activeCount(tasks: AgentTask[]): number {
  return tasks.filter((t) => ACTIVE.includes(t.status)).length
}

export function allSettled(tasks: AgentTask[]): boolean {
  return tasks.every((t) => DONE.includes(t.status) || TERMINAL_BAD.includes(t.status))
}

/** Kahn topological order. Throws on cycles. */
export function topoOrder<T extends { id: string; dependsOn: string[] }>(tasks: T[]): T[] {
  const ids = new Set(tasks.map((t) => t.id))
  const indeg = new Map(tasks.map((t) => [t.id, t.dependsOn.filter((d) => ids.has(d)).length]))
  const out: T[] = []
  const queue = tasks.filter((t) => indeg.get(t.id) === 0)
  while (queue.length) {
    const t = queue.shift()!
    out.push(t)
    for (const n of tasks) {
      if (n.dependsOn.includes(t.id)) {
        indeg.set(n.id, indeg.get(n.id)! - 1)
        if (indeg.get(n.id) === 0) queue.push(n)
      }
    }
  }
  if (out.length !== tasks.length) throw new Error('Plan has a dependency cycle')
  return out
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'
}

/**
 * Normalise whatever JSON the Architect produced into a valid plan: string ids, deps that exist,
 * no cycles (cyclic edges are dropped), at least one task.
 */
export function normalizePlan(goal: string, raw: any): AgentPlan {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : []
  const used = new Set<string>()
  const idMap = new Map<string, string>()
  const tasks: PlanTask[] = list
    .filter((t) => t && (t.title || t.description || t.name))
    .map((t, i) => {
      const title = String(t.title ?? t.name ?? `Task ${i + 1}`).slice(0, 120)
      let id = slug(String(t.id ?? title))
      while (used.has(id)) id = `${id}-${i + 1}`
      used.add(id)
      idMap.set(String(t.id ?? i + 1), id)
      idMap.set(String(i + 1), idMap.get(String(i + 1)) ?? id)
      return {
        id,
        title,
        description: String(t.description ?? t.details ?? title),
        files: (Array.isArray(t.files) ? t.files : []).map(String).slice(0, 30),
        dependsOn: (Array.isArray(t.dependsOn ?? t.depends_on ?? t.deps) ? t.dependsOn ?? t.depends_on ?? t.deps : []).map(String),
        owner: t.owner ? String(t.owner) : undefined,
        acceptance: t.acceptance ? String(t.acceptance) : undefined
      }
    })
  for (const t of tasks) {
    t.dependsOn = [...new Set(t.dependsOn.map((d) => idMap.get(d) ?? slug(d)).filter((d) => d !== t.id && used.has(d)))]
  }
  // Break cycles by dropping back-edges in list order.
  const seen = new Set<string>()
  for (const t of tasks) {
    t.dependsOn = t.dependsOn.filter((d) => seen.has(d))
    seen.add(t.id)
  }
  if (tasks.length === 0) {
    tasks.push({ id: 'build', title: goal.slice(0, 120), description: goal, files: [], dependsOn: [] })
  }
  return { goal, summary: String(raw?.summary ?? ''), tasks }
}

export function planToTasks(runId: string, plan: AgentPlan): AgentTask[] {
  return plan.tasks.map((t) => ({ ...t, runId, status: 'pending' as TaskStatus, attempts: 0, log: [] }))
}

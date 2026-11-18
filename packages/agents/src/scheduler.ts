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

/**
 * File ownership: every file belongs to exactly one task, so two agents never edit the same file in
 * parallel. The first task that lists a file owns it; later tasks see it as read-only. A task left
 * with no files of its own is folded into the task that owns its first file. The owner of an HTML
 * page is told to load the scripts/styles other tasks create, so parallel pieces fit together.
 */
const NL = String.fromCharCode(10)
const norm = (f: string) => f.replace(/^\.?\//, '').toLowerCase()

/**
 * canFit (optional): whether some team model can do a task. Folding two tasks into one used to build tasks no small
 * model could finish (free-hosted Visual run: graph logic + DOM rendering in one task). When the merged task would not
 * fit, the later task stays separate as the next part of the same file and runs after the previous part.
 */
export function enforceFileOwnership(plan: AgentPlan, canFit?: (t: PlanTask) => boolean): AgentPlan {
  const owner = new Map<string, string>()
  for (const t of plan.tasks) for (const f of t.files) if (!owner.has(norm(f))) owner.set(norm(f), t.id)
  const own = (t: PlanTask) => t.files.filter((f) => owner.get(norm(f)) === t.id)
  const changed = plan.tasks.some((t) => own(t).length !== t.files.length)
  if (!changed) return plan

  // fold tasks with nothing of their own into the owner of their first file
  const parent = new Map(plan.tasks.map((t) => [t.id, t.id]))
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!))
  const members = new Map(plan.tasks.map((t) => [t.id, [t]]))
  const sequential = new Map<string, { file: string; after: string; part: number }>()
  const lastPart = new Map<string, { id: string; part: number }>()
  for (const t of plan.tasks) {
    if (!t.files.length || own(t).length !== 0) continue
    const file = t.files[0]
    const target = find(owner.get(norm(file))!)
    const group = [...members.get(target)!, t]
    const merged: PlanTask = { ...t, title: group.map((g) => g.title).join('; '), description: group.map((g, i) => `${i + 1}. ${g.title}: ${g.description}`).join(NL), files: [...new Set(group.flatMap((g) => g.files))] }
    if (canFit && !canFit(merged)) {
      const prev = lastPart.get(norm(file)) ?? { id: target, part: 1 }
      sequential.set(t.id, { file, after: prev.id, part: prev.part + 1 })
      lastPart.set(norm(file), { id: t.id, part: prev.part + 1 })
      continue
    }
    parent.set(t.id, target)
    members.set(target, group)
  }
  const groups = new Map<string, PlanTask[]>()
  for (const t of plan.tasks) groups.set(find(t.id), [...(groups.get(find(t.id)) ?? []), t])

  const tasks: PlanTask[] = []
  for (const [root, list] of groups) {
    const first = list.find((t) => t.id === root) ?? list[0]
    const seq = sequential.get(root)
    if (seq) {
      tasks.push({
        ...first,
        description: `${first.description}${NL}Part ${seq.part} of ${seq.file}: an earlier part already wrote this file. Read it, then add your part with edit_file; do not rewrite or remove what is there.`,
        dependsOn: [...new Set([seq.after, ...first.dependsOn.map(find)])].filter((d) => d !== root)
      })
      continue
    }
    const files = [...new Set(list.flatMap(own))]
    const shared = [...new Set(list.flatMap((t) => t.files).filter((f) => !files.includes(f)))]
    let description = list.length === 1 ? first.description : list.map((t, i) => `${i + 1}. ${t.title}: ${t.description}`).join(NL)
    if (shared.length) description += `${NL}Other agents own ${shared.join(', ')} — read them if they exist but do not edit them.`
    tasks.push({
      id: root,
      title: list.length === 1 ? first.title : list.map((t) => t.title).join('; ').slice(0, 120),
      description,
      files,
      dependsOn: [...new Set(list.flatMap((t) => t.dependsOn).map(find))].filter((d) => d !== root),
      owner: first.owner,
      acceptance: list.map((t) => t.acceptance).filter(Boolean).join(' ') || undefined
    })
  }
  // the page owner wires in everyone else's scripts and styles
  const assets = [...new Set(tasks.flatMap((t) => t.files).filter((f) => /\.(js|mjs|css)$/i.test(f)))]
  for (const t of tasks) {
    const page = t.files.find((f) => /\.html?$/i.test(f))
    const others = assets.filter((a) => !t.files.includes(a))
    if (page && others.length && !sequential.has(t.id)) t.description += `${NL}${page} must load these files made by other agents: ${others.join(', ')}.`
  }
  return { ...plan, tasks }
}

/** The most tasks a plan may grow to by splitting (each one is a worker run and a review). */
export const MAX_PLAN_TASKS = 12

/** Swap one task for several; whatever depended on it depends on all of them. */
export function replaceTask(plan: AgentPlan, id: string, parts: PlanTask[]): AgentPlan {
  const tasks = plan.tasks.flatMap((t) => (t.id === id ? parts : [t]))
  for (const t of tasks) if (t.dependsOn.includes(id)) t.dependsOn = [...t.dependsOn.filter((d) => d !== id), ...parts.map((p) => p.id)]
  return { ...plan, tasks }
}

/** One file of a task split by file. Every piece gets the shared contract so they fit together. */
export function pieceFor(big: PlanTask, f: string): PlanTask {
  const files = big.files
  const contract = `${NL}This is one part of "${big.title}". It is split across agents by file, all built at the same time: ${files.join(', ')}. Use exactly these file names; keep element ids, function names and data shapes consistent with the description above.`
  return {
    id: `${big.id}-${f.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 60),
    title: `${big.title.slice(0, 80)} — ${f}`,
    description: `${big.description}${contract}${NL}You write ONLY ${f}.` + (/\.html?$/i.test(f) ? ` ${f} must load: ${files.filter((x) => /\.(js|mjs|css)$/i.test(x)).join(', ') || '(no other assets)'} (CSS with <link rel="stylesheet">, JS with <script src> at the end of <body>).` : ''),
    files: [f],
    dependsOn: [...big.dependsOn],
    owner: undefined,
    acceptance: `${f} exists and implements its part of: ${big.acceptance ?? big.title}`
  }
}

/**
 * Split tasks no team model can do (canFit false), without asking a model: a multi-file task becomes one task per
 * file; a one-file task with numbered jobs becomes parts that run in order on that file. The plan never grows past
 * MAX_PLAN_TASKS; a task left too big goes to the strongest model when it is routed.
 */
export function splitOversized(plan: AgentPlan, canFit: (t: PlanTask) => boolean): AgentPlan {
  let out = plan
  for (const big of plan.tasks) {
    if (canFit(big)) continue
    let parts: PlanTask[] = []
    if (big.files.length > 1) parts = big.files.map((f) => pieceFor(big, f))
    else {
      const chunks = big.description.split(/(?:^|\n)\s*\d+\.\s+/)
      const intro = chunks[0].trim()
      const items = chunks.slice(1).map((s) => s.trim()).filter(Boolean)
      if (items.length < 2) continue
      const file = big.files[0] ?? '(its file)'
      parts = items.map((item, i) => ({
        id: `${big.id}-part-${i + 1}`.slice(0, 60),
        title: `${big.title.slice(0, 80)} (part ${i + 1} of ${items.length})`,
        description: `${intro ? intro + NL : ''}${item}${i ? `${NL}Part ${i + 1} of ${file}: earlier parts already wrote this file. Read it, then add your part with edit_file; do not rewrite or remove what is there.` : `${NL}Part 1 of ${file}: write only this part; later parts add the rest.`}`,
        files: [...big.files],
        dependsOn: i ? [`${big.id}-part-${i}`.slice(0, 60)] : [...big.dependsOn],
        owner: undefined,
        acceptance: i === items.length - 1 ? big.acceptance : undefined
      }))
    }
    if (out.tasks.length - 1 + parts.length > MAX_PLAN_TASKS) continue
    out = replaceTask(out, big.id, parts)
  }
  return out
}

/**
 * Router rule: when there are more idle workers than tasks, split multi-file tasks one file per
 * worker so the team actually works in parallel. Every piece gets the shared contract (all file
 * names, what is built at the same time); the page owner is told to load the others. Tasks that
 * depended on the original depend on all of its pieces.
 */
export function splitForParallelism(plan: AgentPlan, workers: number): AgentPlan {
  let tasks = [...plan.tasks]
  while (tasks.length < workers) {
    const big = [...tasks].sort((a, b) => b.files.length - a.files.length)[0]
    if (!big || big.files.length < 2) break
    tasks = replaceTask({ ...plan, tasks }, big.id, big.files.map((f) => pieceFor(big, f))).tasks
  }
  return tasks.length === plan.tasks.length ? plan : { ...plan, tasks }
}

/**
 * Router rule: tasks own disjoint files (see enforceFileOwnership), so ordering between them only
 * exists to share names. Replace those dependencies with an explicit team contract — every task sees
 * which agent-task writes which file — and run them all at once. The page owner loads every asset.
 */
export function parallelizeWithContract(plan: AgentPlan): AgentPlan {
  if (plan.tasks.length < 2) return plan
  // Shared names must reach every task: in a Groq Snake run the canvas id (id="game") was only in the HTML task, the
  // game.js worker guessed "gameCanvas", and the page crashed. Collect the element ids and window globals any task
  // mentions and give the whole list to all of them.
  const text = plan.tasks.map((t) => t.description).join(NL)
  const ids = [...new Set([...text.matchAll(/\bid=["']([A-Za-z][\w-]*)["']/g)].map((m) => m[1]).concat([...text.matchAll(/(?:^|[\s(,])#([A-Za-z][\w-]*)\b/g)].map((m) => m[1])))]
  const globals = [...new Set([...text.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]
  const names = [
    ids.length ? `- Element ids (use exactly these; never rename): ${ids.map((i) => `#${i}`).join(', ')}` : '',
    globals.length ? `- Shared globals: ${globals.map((g) => `window.${g}`).join(', ')}` : ''
  ].filter(Boolean)
  const contract = [...plan.tasks.map((t) => `- ${t.files.join(', ') || '(no files)'}: ${t.title}`), ...names].join(NL)
  const assets = [...new Set(plan.tasks.flatMap((t) => t.files).filter((f) => /\.(js|mjs|css)$/i.test(f)))]
  // Parts of one file must still run in order (part 2 edits what part 1 wrote); every other dependency goes.
  const filesOf = new Map(plan.tasks.map((t) => [t.id, new Set(t.files.map(norm))]))
  const sameFile = (t: PlanTask) => t.dependsOn.filter((d) => t.files.some((f) => filesOf.get(d)?.has(norm(f))))
  const tasks = plan.tasks.map((t) => {
    if (t.description.includes('Team contract')) return { ...t, dependsOn: sameFile(t) }
    const page = t.files.find((f) => /\.html?$/i.test(f))
    const others = assets.filter((a) => !t.files.includes(a))
    const wiring = page && others.length && !t.description.includes('must load') ? `${NL}${page} must load: ${others.join(', ')} (CSS via <link rel="stylesheet">, JS via <script src> at the end of <body>, in this order).` : ''
    return {
      ...t,
      dependsOn: sameFile(t),
      description: `${t.description}${wiring}${NL}Team contract — these files are written AT THE SAME TIME by other agents; use these exact names and share globals/ids consistently:${NL}${contract}${assets.some((a) => /\.m?js$/i.test(a)) ? `${NL}Browser scripts are plain <script> files: NO import/export. Share state as properties of window (e.g. window.game). Create any DOM elements you need if they are missing.` : ''}`
    }
  })
  return { ...plan, tasks }
}

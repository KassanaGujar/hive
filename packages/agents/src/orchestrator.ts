import path from 'node:path'
import type {
  AgentInfo,
  AgentRun,
  AgentTask,
  ApprovalRequest,
  ChatMessage,
  FeedEvent,
  InstalledModel,
  Tier,
  ToolCall,
  ToolSpec
} from '@hive/shared'
import { promises as fsp } from 'node:fs'
import type { AgentPlan, PlanTask } from '@hive/shared'
import { rankTeam, extractJson, stripThinking, capacityOf } from '@hive/models'
import { classifyCommand } from './policy'
import { allSettled, enforceFileOwnership, MAX_PLAN_TASKS, normalizePlan, parallelizeWithContract, planToTasks, readyTasks, replaceTask, splitForParallelism, splitOversized, starvedTasks } from './scheduler'
import { architectPlanPrompt, architectSplitPrompt, leadReviewPrompt, workerSystemPrompt } from './prompts'
import { estimateTask, fitsSize, type TaskSize } from './sizing'
import { pickWorker } from './routing'
import { buildWorkerContext } from './context'
import { combineReviews, reviewBudgetChars, splitDiff } from './review'
import { learnedCapacity, type ModelOutcome, type ModelStats } from './stats'
import { AGENT_TOOLS, executeTool, listFiles } from './tools'
import { ResourceGuard } from './guard'
import { loadProjectChecks, syntaxProblems, tail } from './checks'
import { cliErrorKind, cliInvocation, cliTaskPrompt, flattenMessages, isCliSource, parseCliOutput, type CliInvocation, type CliSource } from './cliAgents'

export const MAX_STEPS = 40
export const MAX_REVIEW_ROUNDS = 3
export const COMMAND_TIMEOUT_MS = 5 * 60 * 1000
/** Worker agents per run, even with one model installed (they share it). */
export const DEFAULT_WORKERS = 3
/** Integration rounds after all tasks merge, when the smoke test finds problems. */
export const MAX_INTEGRATION_ROUNDS = 2
/** A subscription CLI doing a whole task in one call. */
export const CLI_TASK_TIMEOUT_MS = 30 * 60 * 1000
export const CLI_ASK_TIMEOUT_MS = 10 * 60 * 1000

export interface ChatResult {
  text: string
  toolCalls?: ToolCall[]
  tokensPerSec?: number
}

export interface GitOps {
  /** Make sure root is a repo with at least one commit; returns the current branch. */
  ensureRepo(root: string): Promise<string>
  addWorktree(root: string, wtPath: string, branch: string, fromRef: string): Promise<void>
  removeWorktree(root: string, wtPath: string): Promise<void>
  commitAll(cwd: string, message: string): Promise<boolean>
  diff(cwd: string, fromRef: string, toRef: string): Promise<string>
  merge(cwd: string, branch: string, message: string): Promise<{ ok: boolean; conflicts?: string }>
  deleteBranch(root: string, branch: string): Promise<void>
  /** Files changed, added or deleted in the worktree since its last commit (repo-relative, forward slashes). */
  changedFiles?(cwd: string): Promise<string[]>
  /** Undo uncommitted changes to these paths (new files are deleted). */
  restorePaths?(cwd: string, paths: string[]): Promise<void>
}

export interface OrchestratorHost {
  projectRoot(): string
  models(): InstalledModel[]
  tierOverrides(): Record<string, Tier>
  chat(
    model: InstalledModel,
    messages: ChatMessage[],
    tools: ToolSpec[] | undefined,
    /** onModel: the host answered with a different model (fallback after a quota or size refusal). */
    opts: { signal: AbortSignal; onText?: (t: string) => void; onModel?: (m: InstalledModel) => void }
  ): Promise<ChatResult>
  /** What each model has managed before (saved between runs). Optional. */
  modelStats?(): ModelStats
  /** A task merged or failed because of what this model wrote. */
  recordOutcome?(modelId: string, o: ModelOutcome): void
  git: GitOps
  exec(cwd: string, command: string, timeoutMs: number, signal: AbortSignal): Promise<{ code: number; output: string }>
  requestApproval(req: ApprovalRequest): Promise<boolean>
  emit(run: AgentRun): void
  log(runId: string, agent: string, taskId: string | undefined, line: string): void
  feed(ev: Omit<FeedEvent, 'id' | 'at'>): void
  memoryBudgetGB(): number
  /**
   * Optional smoke test of the merged result (e.g. load a web page and collect errors). Returns
   * problems found; [] = looks fine; null = this kind of project can't be smoke-tested.
   */
  smokeTest?(dir: string): Promise<string[] | null>
  /** Called whenever an agent writes a file (absolute path), so the UI can show it live. */
  fileWritten?(runId: string, agent: string, taskId: string, absPath: string): void
  /** Run a coding-agent CLI (Claude Code, Codex) signed in with the user's own subscription. Desktop only. */
  runCli?(inv: CliInvocation, cwd: string, signal: AbortSignal, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }>
}

const WORKER_NAMES = ['bee', 'wasp', 'ant', 'moth', 'beetle', 'cricket', 'firefly', 'mantis']

interface RunCtl {
  run: AgentRun
  /** The project the run started in. Fixed for the whole run: switching projects mid-run must not send worktrees,
   *  merges or cleanup to a different folder. */
  root: string
  abort: AbortController
  paused: Set<string>
  takenOver: Set<string>
  team: { architect: InstalledModel; leads: InstalledModel[]; workers: InstalledModel[] }
  /** strong: a lead/architect model added so big tasks can go straight to it (not planned onto by default). */
  workerPool: { name: string; model: InstalledModel; busy: boolean; strong?: boolean }[]
  /** Size estimate per task id, made when the plan is shaped. */
  sizes: Map<string, TaskSize>
  /** The local model most recently used, likely still in GPU memory. */
  lastLocal?: string
  /** Task id → the model that really answered, when the host fell back to another one. */
  actualModel: Map<string, InstalledModel>
  intWorktree?: string
  /** The team's plan doc (PRD/MVP) from the Planning room, if the run came from there. */
  prd?: string
  waiters: Map<string, (ok: boolean) => void>
  integrationRounds?: number
  integrating?: boolean
  integrated?: boolean
}

export class Orchestrator {
  private runs = new Map<string, RunCtl>()
  private guard: ResourceGuard

  constructor(private host: OrchestratorHost) {
    this.guard = new ResourceGuard(() => host.memoryBudgetGB())
  }

  list(): AgentRun[] {
    return [...this.runs.values()].map((c) => c.run)
  }

  /** Re-hydrate finished/persisted runs for display. Running state is not resumed. */
  restore(runs: AgentRun[]) {
    for (const run of runs) {
      if (this.runs.has(run.id)) continue
      if (!['done', 'failed', 'cancelled'].includes(run.phase)) {
        run.phase = 'cancelled'
        run.error = 'Hive was closed while this run was active.'
      }
      this.runs.set(run.id, { run, abort: new AbortController(), paused: new Set(), takenOver: new Set(), team: null as any, workerPool: [], sizes: new Map(), actualModel: new Map(), waiters: new Map(), root: '' })
    }
  }

  team() {
    return rankTeam(this.host.models(), this.host.tierOverrides())
  }

  async start(goal: string, presetTasks?: { title: string; description: string }[], prd?: string): Promise<string> {
    const t = this.team()
    if (!t.architect) throw new Error('No models installed. Download a model in the Model store first.')
    const team = { architect: t.architect, leads: t.leads, workers: t.workers }
    const id = `run-${Date.now().toString(36)}`
    // At least DEFAULT_WORKERS agents work in parallel (they share models when few are installed).
    const nWorkers = Math.max(DEFAULT_WORKERS, team.workers.length)
    const workerPool = Array.from({ length: nWorkers }, (_, i) => ({
      name: WORKER_NAMES[i % WORKER_NAMES.length] + (i >= WORKER_NAMES.length ? `-${i}` : ''),
      model: team.workers[i % team.workers.length],
      busy: false
    })) as RunCtl['workerPool']
    // Strong models can take a big task themselves instead of only stepping in after 3 failed review rounds. One
    // extra worker per lead/architect model not already in the pool; the router only gives them work that needs them.
    for (const m of [team.architect, ...team.leads]) {
      if (workerPool.some((w) => w.model.id === m.id)) continue
      const i = workerPool.length
      workerPool.push({ name: WORKER_NAMES[i % WORKER_NAMES.length] + (i >= WORKER_NAMES.length ? `-${i}` : ''), model: m, busy: false, strong: true })
    }
    const agents: AgentInfo[] = [
      { name: 'architect', role: 'architect', modelId: team.architect.id, modelName: team.architect.name, status: 'thinking' },
      ...team.leads.slice(0, 2).map((m, i) => ({ name: `lead${i ? '-' + (i + 1) : ''}`, role: 'lead' as const, modelId: m.id, modelName: m.name, status: 'idle' as const })),
      ...workerPool.map((w) => ({ name: w.name, role: 'worker' as const, modelId: w.model.id, modelName: w.model.name, status: 'idle' as const }))
    ]
    const run: AgentRun = { id, goal, phase: 'planning', tasks: [], agents, baseBranch: '', createdAt: Date.now() }
    const ctl: RunCtl = { run, abort: new AbortController(), paused: new Set(), takenOver: new Set(), team, workerPool, sizes: new Map(), actualModel: new Map(), waiters: new Map(), prd, root: this.host.projectRoot() }
    this.runs.set(id, ctl)
    this.emit(ctl)
    this.plan(ctl, presetTasks).catch((e) => this.fail(ctl, e))
    return id
  }

  // ---------- planning ----------

  private async plan(ctl: RunCtl, presetTasks?: { title: string; description: string }[]) {
    const { run } = ctl
    const files = (await listFiles(ctl.root, '.', 300)).join('\n')
    const workers = ctl.workerPool.filter((w) => !w.strong).map((w) => w.name)
    const workerOut = Math.min(...ctl.team.workers.map((m) => this.capacity(m).maxOutput))
    const strongOut = Math.max(...this.teamModels(ctl).map((m) => this.capacity(m).maxOutput))
    let prompt = architectPlanPrompt(run.goal, files, workers, { workerMaxOutput: workerOut, strongMaxOutput: strongOut })
    if (ctl.prd) prompt += `

The team's plan document (PRD / MVP) — build exactly this:
${ctl.prd.slice(0, 8000)}`
    if (presetTasks?.length) {
      prompt += `\n\nThe team already wrote this task list in their plan doc. Turn it into the plan (keep their intent, add files, deps and acceptance):\n${presetTasks
        .map((t, i) => `${i + 1}. ${t.title}${t.description ? ' — ' + t.description : ''}`)
        .join('\n')}`
    }
    this.log(ctl, 'architect', undefined, 'Writing the task plan…')
    let raw: unknown = null
    for (let attempt = 0; attempt < 2 && !raw; attempt++) {
      const res = await this.chat(ctl, 'architect', undefined, ctl.team.architect, [
        { role: 'system', content: 'You are a precise software architect. You answer with JSON only.' },
        { role: 'user', content: prompt + (attempt ? '\n\nYour last reply was not valid JSON. Reply with JSON only.' : '') }
      ])
      raw = extractJson(res.text)
    }
    const sizes = await fileSizes(ctl.root, files.split('\n').filter(Boolean))
    // Size only: splitting makes a task smaller, not easier, so a hard task is not split just for being hard.
    const canFit = (t: PlanTask) => this.teamModels(ctl).some((m) => fitsSize(estimateTask(t, sizes), this.capacity(m)))
    let shaped = enforceFileOwnership(normalizePlan(run.goal, raw), canFit)
    shaped = await this.splitWithArchitect(ctl, shaped, canFit)
    shaped = splitOversized(enforceFileOwnership(shaped, canFit), canFit)
    const plan = parallelizeWithContract(splitForParallelism(shaped, workers.length))
    routeTasks(plan.tasks, workers)
    for (const t of plan.tasks) ctl.sizes.set(t.id, estimateTask(t, sizes))
    for (const t of plan.tasks) {
      const s = ctl.sizes.get(t.id)!
      this.log(ctl, 'architect', undefined, `Router: "${t.title}" (${s.size}, ~${s.outputTokens} tokens to write) → ${t.owner}${t.dependsOn.length ? ` (after ${t.dependsOn.join(', ')})` : ''}`)
    }
    run.plan = plan
    run.tasks = planToTasks(run.id, plan).map((t) => ({ ...t, size: ctl.sizes.get(t.id)!.size, estimate: ctl.sizes.get(t.id)!.outputTokens }))
    run.phase = 'awaiting-plan-approval'
    this.setAgent(ctl, 'architect', { status: 'waiting' })
    this.log(ctl, 'architect', undefined, `Plan ready: ${plan.tasks.length} task(s). Waiting for your approval.`)
    this.emit(ctl)
  }

  /** Every distinct model on the team (architect, leads, workers). */
  private teamModels(ctl: RunCtl): InstalledModel[] {
    const all = [ctl.team.architect, ...ctl.team.leads, ...ctl.team.workers].filter(Boolean) as InstalledModel[]
    return [...new Map(all.map((m) => [m.id, m])).values()]
  }

  private capacity(m: InstalledModel) {
    return capacityOf(m, learnedCapacity(this.host.modelStats?.()[m.id]))
  }

  private outcome(ctl: RunCtl, task: AgentTask, model: InstalledModel, ok: boolean) {
    const s = ctl.sizes.get(task.id) ?? estimateTask(task, {})
    this.host.recordOutcome?.(model.id, { size: s.size, outputTokens: s.outputTokens, ok })
  }

  /**
   * A planned task no team model can do goes back to the architect once to be broken up (at most 4 such asks per
   * plan, to save scarce free quota). A reply that is not usable is ignored; splitOversized then splits by rule.
   */
  private async splitWithArchitect(ctl: RunCtl, plan: AgentPlan, canFit: (t: PlanTask) => boolean): Promise<AgentPlan> {
    const tooBig = plan.tasks.filter((t) => !canFit(t)).slice(0, 4)
    const workerOut = Math.min(...ctl.team.workers.map((m) => this.capacity(m).maxOutput))
    let out = plan
    for (const big of tooBig) {
      if (out.tasks.length >= MAX_PLAN_TASKS) break
      this.log(ctl, 'architect', undefined, `"${big.title}" is too big for any model on the team; splitting it…`)
      const res = await this.chat(ctl, 'architect', undefined, ctl.team.architect, [
        { role: 'system', content: 'You are a precise software architect. You answer with JSON only.' },
        { role: 'user', content: architectSplitPrompt(big, workerOut) }
      ])
      const raw = extractJson(res.text)
      if (!raw) continue
      const sub = normalizePlan(big.title, raw).tasks
      if (sub.length < 2 || out.tasks.length - 1 + sub.length > MAX_PLAN_TASKS) continue
      const ids = new Map(sub.map((s) => [s.id, `${big.id}-${s.id}`.slice(0, 60)]))
      const parts = sub.map((s) => ({ ...s, id: ids.get(s.id)!, owner: undefined, dependsOn: [...big.dependsOn, ...s.dependsOn.map((d) => ids.get(d) ?? d)] }))
      out = replaceTask(out, big.id, parts)
      this.log(ctl, 'architect', undefined, `Split "${big.title}" into ${parts.length} tasks.`)
    }
    return out
  }

  async approvePlan(runId: string, approved: boolean) {
    const ctl = this.get(runId)
    if (ctl.run.phase !== 'awaiting-plan-approval') return
    if (!approved) return this.cancel(ctl, 'Plan rejected.')
    const root = ctl.root
    ctl.run.baseBranch = await this.host.git.ensureRepo(root)
    const integration = `hive/run-${ctl.run.id.replace(/^run-/, '')}`
    ctl.run.integrationBranch = integration
    ctl.intWorktree = path.join(root, '.hive', 'worktrees', ctl.run.id, '_integration')
    await this.host.git.addWorktree(root, ctl.intWorktree, integration, ctl.run.baseBranch)
    ctl.run.previewDir = path.relative(root, ctl.intWorktree).replace(/\\/g, '/')
    ctl.run.phase = 'working'
    this.setAgent(ctl, 'architect', { status: 'idle' })
    this.emit(ctl)
    this.pump(ctl)
  }

  // ---------- scheduling ----------

  private pump(ctl: RunCtl) {
    const { run } = ctl
    if (run.phase !== 'working') return
    for (const t of starvedTasks(run.tasks)) {
      t.status = 'cancelled'
      t.log.push('Cancelled: a task it depends on failed.')
    }
    for (const task of readyTasks(run.tasks)) {
      // Each task goes to the cheapest free model that can do it (routing.ts); a big one waits for a model big enough.
      const size = ctl.sizes.get(task.id) ?? estimateTask(task, {})
      const pool = ctl.workerPool.filter((w) => !ctl.paused.has(w.name))
      const pick = pickWorker(size, pool, (m) => this.capacity(m), { loadedLocal: ctl.lastLocal, prefer: task.owner })
      if ('wait' in pick) continue
      const worker = pick.worker
      this.log(ctl, 'architect', task.id, `Router: "${task.title}" (${size.size}, ~${size.outputTokens} tokens to write) → ${worker.name} (${worker.model.name})${pick.reason ? `: ${pick.reason}` : ''}`)
      if (worker.model.source === 'ollama') ctl.lastLocal = worker.model.model
      task.size = size.size
      task.estimate = size.outputTokens
      worker.busy = true
      task.owner = worker.name
      task.status = 'running'
      this.runTask(ctl, task, worker)
        .catch((e) => {
          task.status = 'failed'
          task.log.push(`Failed: ${e?.message ?? e}`)
          this.log(ctl, worker.name, task.id, `Task failed: ${e?.message ?? e}`)
        })
        .finally(() => {
          worker.busy = false
          this.setAgent(ctl, worker.name, { status: 'idle', currentTaskId: undefined })
          this.emit(ctl)
          this.pump(ctl)
        })
    }
    if (allSettled(run.tasks) && run.phase === 'working') {
      const merged = run.tasks.filter((t) => t.status === 'merged').length
      if (merged === 0) return this.fail(ctl, new Error('No task finished successfully.'))
      // Pieces built in parallel must work together: smoke-test the merged result first.
      if (this.host.smokeTest && !ctl.integrated) {
        if (!ctl.integrating) {
          ctl.integrating = true
          this.integrate(ctl)
            .catch((e) => this.log(ctl, 'architect', undefined, `Integration check failed to run: ${e?.message ?? e}`))
            .finally(() => {
              ctl.integrating = false
              this.pump(ctl)
            })
        }
        this.emit(ctl)
        return
      }
      run.phase = 'awaiting-merge-approval'
      this.log(ctl, 'architect', undefined, `All tasks settled (${merged} merged). Approve the final merge into ${run.baseBranch}.`)
    }
    this.emit(ctl)
  }

  private async runTask(ctl: RunCtl, task: AgentTask, worker: { name: string; model: InstalledModel }) {
    const root = ctl.root
    const branch = `hive/agent-${worker.name}/${task.id}`
    const wt = path.join(root, '.hive', 'worktrees', ctl.run.id, task.id)
    task.branch = branch
    task.worktree = wt
    task.model = worker.model.name
    this.setAgent(ctl, worker.name, { status: 'working', currentTaskId: task.id })
    await this.host.git.addWorktree(root, wt, branch, ctl.run.integrationBranch!)
    this.log(ctl, worker.name, task.id, `Started "${task.title}" on ${branch}`)
    this.host.feed({ actor: worker.name, actorType: 'agent', kind: 'agent.task', files: task.files, summary: `started "${task.title}"` })

    let notes: string | undefined
    let approved = false
    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      task.attempts = round
      task.status = 'running'
      this.emit(ctl)
      const summary = await this.workerLoop(ctl, task, worker, wt, notes)
      if (ctl.takenOver.has(task.id)) {
        await this.waitForHuman(ctl, task)
      }
      await this.host.git.commitAll(wt, `${task.title}\n\n${summary}\n\nAgent: ${worker.name} (${worker.model.name})`)
      task.diff = await this.host.git.diff(wt, ctl.run.integrationBranch!, 'HEAD')
      task.status = 'review'
      this.emit(ctl)
      // Deterministic check before any AI review: the task's own files must exist.
      const missing = (await Promise.all(task.files.map(async (f) => ((await executeTool({ root: wt, runCommand: async () => '' }, 'read_file', { path: f })).output.startsWith('Error') ? f : null)))).filter(Boolean)
      // Then Hive's own checks (syntax, the project's commands); the AI review only sees work that passes them.
      const problems = missing.length ? null : await this.runChecks(ctl, task, wt)
      const review = missing.length
        ? { approved: false, notes: `These files are missing — create them with write_file: ${missing.join(', ')}` }
        : problems
          ? { approved: false, notes: problems }
          : await this.review(ctl, task)
      if (review.approved) {
        task.reviewNotes = review.notes
        approved = true
        break
      }
      notes = review.notes
      task.reviewNotes = notes
      task.status = 'changes-requested'
      this.log(ctl, 'lead', task.id, `Round ${round}: changes requested — ${notes}`)
      if (round === MAX_REVIEW_ROUNDS) {
        this.log(ctl, 'lead', task.id, `Max ${MAX_REVIEW_ROUNDS} review rounds reached; passing it on with notes for your final check.`)
      }
    }
    // A weak worker that couldn't satisfy the lead hands the task to the strongest model on the team for one
    // last attempt (the "router head" steps in), instead of the task failing or merging unapproved work.
    const strongest = ctl.team.architect
    if (!ctl.abort.signal.aborted) this.outcome(ctl, task, ctl.actualModel.get(task.id) ?? worker.model, approved)
    ctl.actualModel.delete(task.id)
    if (!approved && strongest && strongest.id !== worker.model.id && !ctl.abort.signal.aborted) {
      this.log(ctl, 'architect', task.id, `Taking over "${task.title}" from ${worker.name} (${worker.model.name}) after ${MAX_REVIEW_ROUNDS} review rounds.`)
      task.model = strongest.name
      task.status = 'running'
      this.emit(ctl)
      const summary = await this.workerLoop(ctl, task, { name: worker.name, model: strongest }, wt, notes)
      await this.host.git.commitAll(wt, `${task.title} (finished by ${strongest.name})\n\n${summary}`)
      task.diff = await this.host.git.diff(wt, ctl.run.integrationBranch!, 'HEAD')
      task.status = 'review'
      this.emit(ctl)
      const problems = task.diff?.trim() ? await this.runChecks(ctl, task, wt) : null
      const review = !task.diff?.trim() ? { approved: false, notes: 'No files were produced.' } : problems ? { approved: false, notes: problems } : await this.review(ctl, task)
      task.reviewNotes = review.notes
      this.outcome(ctl, task, ctl.actualModel.get(task.id) ?? strongest, review.approved)
      this.log(ctl, 'lead', task.id, review.approved ? 'Approved after the architect took over.' : `Still not approved after the architect took over: ${review.notes}`)
    }
    if (!task.diff?.trim()) {
      // Never merge empty work; dependants get cancelled and the user sees why.
      task.status = 'failed'
      this.log(ctl, 'lead', task.id, 'No files were produced after all review rounds — task failed.')
      this.emit(ctl)
      return
    }
    task.status = 'approved'
    this.emit(ctl)
    await this.mergeTask(ctl, task)
  }

  private async workerLoop(
    ctl: RunCtl,
    task: AgentTask,
    worker: { name: string; model: InstalledModel },
    wt: string,
    notes?: string
  ): Promise<string> {
    if (isCliSource(worker.model.source)) return this.cliWorker(ctl, task, worker, wt, notes)
    // Context sized to this model: a fixed bundle (every file name, 6 files × 6,000 chars, 3,000 chars of PRD) was more
    // than Groq's 7,000-tokens-a-minute cap and crowded small local models. See context.ts for the fill order.
    const files = await listFiles(wt, '.', 300)
    const cap = this.capacity(worker.model)
    const size = ctl.sizes.get(task.id) ?? estimateTask(task, {})
    const budget = Math.max(1500, Math.min(cap.contextTokens * 0.5, cap.inputPerMinute * 0.8) - size.outputTokens - PROMPT_TOKENS)
    const others = files.filter((f) => !task.files.includes(f) && /\.(m?js|ts|tsx|jsx|html?|css|py)$/i.test(f)).slice(0, 40)
    const context = buildWorkerContext(
      { owned: await readTexts(wt, task.files), others: await readTexts(wt, others, 60000), fileList: files, prd: ctl.prd?.slice(0, 8000) },
      budget
    )
    const messages: ChatMessage[] = [
      { role: 'system', content: workerSystemPrompt(task, null, notes) + context },
      { role: 'user', content: notes ? 'Apply the reviewer notes, then call report_done.' : 'Start the task.' }
    ]
    let nudges = 0
    let writes = 0
    let refusedDone = 0
    for (let step = 1; step <= MAX_STEPS; step++) {
      await this.waitWhilePaused(ctl, worker.name)
      if (ctl.abort.signal.aborted) throw new Error('Run stopped')
      if (ctl.takenOver.has(task.id)) return 'Finished by hand.'
      const res = await this.chat(ctl, worker.name, task.id, worker.model, messages, AGENT_TOOLS)
      const text = stripThinking(res.text)
      messages.push({ role: 'assistant', content: text, toolCalls: res.toolCalls })
      if (!res.toolCalls?.length) {
        // A one-file task answered with the file itself (code block / raw HTML) instead of a tool call.
        const pasted = task.files.length === 1 ? fileFromReply(text, task.files[0]) : null
        if (pasted) {
          await executeTool({ root: wt, runCommand: async () => '' }, 'write_file', { path: task.files[0], content: pasted })
          this.host.fileWritten?.(ctl.run.id, worker.name, task.id, path.join(wt, task.files[0]))
          writes++
          this.log(ctl, worker.name, task.id, `→ write_file ${task.files[0]} (from the code in its reply)`)
          messages.push({ role: 'user', content: `Saved that as ${task.files[0]}. If it is complete, call report_done; otherwise write the full file again.` })
          continue
        }
        if (++nudges > 3) return text.slice(0, 500) || 'Finished.'
        messages.push({ role: 'user', content: 'Use the tools to do the work (write_file etc). When finished, call report_done.' })
        continue
      }
      for (const call of res.toolCalls) {
        this.log(ctl, worker.name, task.id, `→ ${call.name} ${summarizeArgs(call.arguments)}`)
        const result = await executeTool(
          {
            root: wt,
            runCommand: (cmd) => this.runCommand(ctl, worker.name, task, wt, cmd),
            defaultPath: task.files.length === 1 ? task.files[0] : undefined,
            onWrite: (rel) => this.host.fileWritten?.(ctl.run.id, worker.name, task.id, path.join(wt, rel)),
            allowedPaths: task.files
          },
          call.name,
          call.arguments
        )
        if ((call.name === 'write_file' || call.name === 'edit_file') && !result.output.startsWith('Error')) writes++
        if (result.output.startsWith('Error')) this.log(ctl, worker.name, task.id, `  ✗ ${result.output.slice(0, 200)}`)
        // It pasted the file in its reply but the tool call failed or was only "done": save the paste.
        if (result.done && writes === 0 && task.files.length === 1) {
          const pasted = fileFromReply(text, task.files[0])
          if (pasted) {
            await executeTool({ root: wt, runCommand: async () => '' }, 'write_file', { path: task.files[0], content: pasted })
            this.host.fileWritten?.(ctl.run.id, worker.name, task.id, path.join(wt, task.files[0]))
            writes++
            this.log(ctl, worker.name, task.id, `→ write_file ${task.files[0]} (from the code in its reply)`)
          }
        }
        if (result.done && writes === 0 && refusedDone++ < 2) {
          // "Done" without writing anything: send it back instead of wasting a review round.
          this.log(ctl, worker.name, task.id, '✗ said done without writing any files — asked to write them')
          messages.push({
            role: 'tool',
            content: `Not done: you have not written any files yet. Call write_file with the full content of ${task.files.join(', ') || 'your files'}, then report_done.`,
            toolCallId: call.id,
            name: call.name
          })
          continue
        }
        if (result.done) {
          this.log(ctl, worker.name, task.id, `✓ done: ${result.done.summary}`)
          return result.done.summary
        }
        messages.push({ role: 'tool', content: result.output, toolCallId: call.id, name: call.name })
      }
      // Keep context bounded for small models: drop old tool outputs.
      trimHistory(messages)
    }
    this.log(ctl, worker.name, task.id, `Hit the ${MAX_STEPS}-step limit; sending what exists to review.`)
    return 'Step limit reached.'
  }

  /**
   * A subscription CLI does the whole task in one call. Edits outside the task's files are undone afterwards, the
   * same rule write_file enforces for Hive's own workers. If the subscription is used up or signed out, the task
   * moves to the best other model on the team.
   */
  private async cliWorker(ctl: RunCtl, task: AgentTask, worker: { name: string; model: InstalledModel }, wt: string, notes?: string): Promise<string> {
    await this.waitWhilePaused(ctl, worker.name)
    if (ctl.abort.signal.aborted) throw new Error('Run stopped')
    const source = worker.model.source as CliSource
    let failure = 'this app cannot run coding-agent CLIs'
    if (this.host.runCli) {
      this.setAgent(ctl, worker.name, { status: 'working' })
      this.log(ctl, worker.name, task.id, `→ ${worker.model.name} is doing the task (your subscription)`)
      const inv = cliInvocation(source, 'task', cliTaskPrompt(task, notes, ctl.prd), worker.model.model || undefined)
      const res = await this.host.runCli(inv, wt, ctl.abort.signal, CLI_TASK_TIMEOUT_MS)
      if (ctl.abort.signal.aborted) throw new Error('Run stopped')
      await this.keepOwnedFiles(ctl, worker.name, task, wt)
      for (const f of task.files) this.host.fileWritten?.(ctl.run.id, worker.name, task.id, path.join(wt, f))
      const out = parseCliOutput(source, res.code, res.stdout, res.stderr)
      if (out.ok) {
        this.log(ctl, worker.name, task.id, `✓ done: ${out.text.slice(0, 300)}`)
        return out.text.slice(0, 2000) || 'Finished.'
      }
      failure = out.error ?? 'failed'
    }
    const fallback = this.nonCliModel(ctl)
    if (!fallback) throw new Error(`${worker.model.name}: ${failure}`)
    const kind = cliErrorKind(failure)
    const why = kind === 'quota' ? 'subscription limit reached' : kind === 'signed-out' ? 'not signed in' : failure.slice(0, 200)
    this.log(ctl, worker.name, task.id, `${worker.model.name} could not do it (${why}); now using ${fallback.name}.`)
    task.model = fallback.name
    ctl.actualModel.set(task.id, fallback)
    this.emit(ctl)
    return this.workerLoop(ctl, task, { name: worker.name, model: fallback }, wt, notes)
  }

  /** Undo edits outside the task's own files. */
  private async keepOwnedFiles(ctl: RunCtl, agent: string, task: AgentTask, wt: string) {
    const git = this.host.git
    if (!task.files.length || !git.changedFiles || !git.restorePaths) return
    const own = new Set(task.files.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '')))
    const stray = (await git.changedFiles(wt)).filter((f) => !own.has(f))
    if (!stray.length) return
    await git.restorePaths(wt, stray)
    this.log(ctl, agent, task.id, `Undid edits outside its own files: ${stray.slice(0, 8).join(', ')}${stray.length > 8 ? '…' : ''}`)
  }

  /** The strongest model on the team that is not a subscription CLI (a fallback when the subscription fails). */
  private nonCliModel(ctl: RunCtl): InstalledModel | undefined {
    return [ctl.team.architect, ...ctl.team.leads, ...ctl.team.workers].find((m) => m && !isCliSource(m.source))
  }

  /**
   * Hive's own checks, run after the agent stops: a syntax check of the task's files, then the project's commands
   * from .hive/checks.json in the task's worktree. Returns what failed, or null when everything passed.
   */
  private async runChecks(ctl: RunCtl, task: AgentTask, wt: string): Promise<string | null> {
    const syntax = syntaxProblems(await readTexts(wt, task.files))
    if (syntax.length) {
      this.log(ctl, 'architect', task.id, `✗ syntax check: ${syntax[0]}`)
      return `Hive's syntax check failed. Fix these errors:\n${syntax.join('\n')}`
    }
    const { commands, refused } = await loadProjectChecks(ctl.root)
    for (const r of refused) this.log(ctl, 'architect', task.id, `Skipped check "${r}": shell operators are not allowed in .hive/checks.json.`)
    for (const cmd of commands) {
      const { code, output } = await this.host.exec(wt, cmd, COMMAND_TIMEOUT_MS, ctl.abort.signal)
      if (code !== 0) {
        this.log(ctl, 'architect', task.id, `✗ check failed: ${cmd} (exit ${code})`)
        return `The project check \`${cmd}\` failed (exit ${code}). Fix the code so it passes:\n${tail(output)}`
      }
    }
    if (commands.length) this.log(ctl, 'architect', task.id, `✓ checks passed: ${commands.join(', ')}`)
    return null
  }

  /** Planning and review with a subscription CLI: one prompt, no tools. Falls back to another model if it fails. */
  private async askCli(ctl: RunCtl, model: InstalledModel, messages: ChatMessage[], tools: ToolSpec[] | undefined, onModel: (m: InstalledModel) => void): Promise<ChatResult> {
    const source = model.source as CliSource
    let failure = 'this app cannot run coding-agent CLIs'
    if (this.host.runCli) {
      const inv = cliInvocation(source, 'ask', flattenMessages(messages), model.model || undefined)
      const res = await this.host.runCli(inv, ctl.root, ctl.abort.signal, CLI_ASK_TIMEOUT_MS)
      const out = parseCliOutput(source, res.code, res.stdout, res.stderr)
      if (out.ok) return { text: out.text }
      failure = out.error ?? 'failed'
    }
    const fallback = this.nonCliModel(ctl)
    if (!fallback || ctl.abort.signal.aborted) throw new Error(`${model.name}: ${failure}`)
    onModel(fallback)
    return this.host.chat(fallback, messages, tools, { signal: ctl.abort.signal })
  }

  private async runCommand(ctl: RunCtl, agent: string, task: AgentTask, cwd: string, command: string): Promise<string> {
    const verdict = classifyCommand(command)
    if (verdict.action === 'block') return `Blocked: ${verdict.reason}. This command is never allowed.`
    if (verdict.action === 'approve') {
      const req: ApprovalRequest = {
        id: `ap-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        runId: ctl.run.id,
        agent,
        taskId: task.id,
        command,
        reason: verdict.reason
      }
      this.setAgent(ctl, agent, { status: 'waiting' })
      this.log(ctl, agent, task.id, `⏸ waiting for approval: ${command} (${verdict.reason})`)
      const ok = await this.host.requestApproval(req)
      this.setAgent(ctl, agent, { status: 'working' })
      if (!ok) return 'The user denied this command. Find another way or skip it.'
    }
    const { code, output } = await this.host.exec(cwd, command, COMMAND_TIMEOUT_MS, ctl.abort.signal)
    return `exit code ${code}\n${output}`
  }

  private async review(ctl: RunCtl, task: AgentTask): Promise<{ approved: boolean; notes: string }> {
    const leadName = ctl.run.agents.find((a) => a.role === 'lead')?.name ?? 'lead'
    this.setAgent(ctl, leadName, { status: 'thinking', currentTaskId: task.id })
    this.log(ctl, leadName, task.id, `Reviewing "${task.title}" (round ${task.attempts})`)
    if (!task.diff?.trim()) {
      this.setAgent(ctl, leadName, { status: 'idle', currentTaskId: undefined })
      return { approved: false, notes: 'No files were changed. Write the code for this task with write_file.' }
    }
    // The first lead whose limits hold the whole diff reviews it; if none does, the roomiest one reviews it file by
    // file, so nothing is silently cut off and no request goes over a per-minute cap.
    const promptChars = leadReviewPrompt(task, '').length
    const candidates = [...ctl.team.leads, ctl.team.architect].filter(Boolean)
    const budget = (m: InstalledModel) => reviewBudgetChars(this.capacity(m), promptChars)
    const lead = candidates.find((m) => budget(m) >= task.diff!.length) ?? [...candidates].sort((a, b) => budget(b) - budget(a))[0]
    const chunks = splitDiff(task.diff, budget(lead))
    if (chunks.length > 1) this.log(ctl, leadName, task.id, `The diff is large; reviewing it in ${chunks.length} parts.`)
    const results: { approved: boolean; notes: string }[] = []
    for (let i = 0; i < chunks.length; i++) {
      const res = await this.chat(ctl, leadName, task.id, lead, [
        { role: 'system', content: 'You are a strict but fair code reviewer. Answer with JSON only.' },
        { role: 'user', content: leadReviewPrompt(task, chunks[i], chunks[i].length, chunks.length > 1 ? `${i + 1} of ${chunks.length}` : undefined) }
      ])
      const j = extractJson<{ approved?: unknown; notes?: unknown }>(res.text)
      results.push(j ? { approved: j.approved === true || j.approved === 'true', notes: String(j.notes ?? '') } : { approved: true, notes: 'Reviewer reply unreadable; approved by default.' })
    }
    this.setAgent(ctl, leadName, { status: 'idle', currentTaskId: undefined })
    return combineReviews(results)
  }

  /** Merge one approved task branch into the run's integration branch. */
  private async mergeTask(ctl: RunCtl, task: AgentTask) {
    this.setAgent(ctl, 'architect', { status: 'working' })
    const res = await this.host.git.merge(ctl.intWorktree!, task.branch!, `Merge ${task.title} (${task.owner})`)
    this.setAgent(ctl, 'architect', { status: 'idle' })
    if (res.ok) {
      task.status = 'merged'
      this.log(ctl, 'architect', task.id, `Merged ${task.branch}`)
      this.host.feed({
        actor: task.owner ?? 'agent',
        actorType: 'agent',
        kind: 'agent.merge',
        files: task.files,
        diff: task.diff?.slice(0, 4000),
        summary: `merged "${task.title}" into ${ctl.run.integrationBranch}`
      })
    } else {
      task.status = 'failed'
      this.log(ctl, 'architect', task.id, `Merge conflict in ${task.branch}: ${res.conflicts}. Creating a fix-up task.`)
      // Conflict → new task built on the current integration head.
      const fix: AgentTask = {
        ...task,
        id: `${task.id}-fix${Date.now().toString(36).slice(-3)}`,
        title: `Redo "${task.title}" on top of merged work`,
        description: `${task.description}\n\nAn earlier attempt conflicted with other merged tasks (${res.conflicts}). Re-apply the change to the current files.`,
        dependsOn: [],
        status: 'pending',
        attempts: 0,
        diff: undefined,
        reviewNotes: undefined,
        log: []
      }
      ctl.run.tasks.push(fix)
    }
    this.emit(ctl)
  }

  /**
   * Integration: smoke-test the merged work; if it fails, add one task that may touch every file to
   * make the pieces work together (errors + PRD in its brief). Up to MAX_INTEGRATION_ROUNDS.
   */
  private async integrate(ctl: RunCtl) {
    const dir = ctl.intWorktree!
    this.log(ctl, 'architect', undefined, 'Integration check: testing the merged app…')
    const problems = await this.host.smokeTest!(dir)
    if (problems === null) {
      ctl.integrated = true
      return
    }
    if (problems.length === 0) {
      this.log(ctl, 'architect', undefined, 'Integration check passed: the merged app loads without errors.')
      ctl.integrated = true
      return
    }
    const round = (ctl.integrationRounds ?? 0) + 1
    this.log(ctl, 'architect', undefined, `Integration check found ${problems.length} problem(s): ${problems.slice(0, 5).join(' | ')}`)
    if (round > MAX_INTEGRATION_ROUNDS) {
      this.log(ctl, 'architect', undefined, 'Still not working after integration rounds — check it yourself before merging.')
      ctl.integrated = true
      return
    }
    ctl.integrationRounds = round
    // The fixer may write every file the plan named, not only the ones that exist: when a worker failed, its file
    // (e.g. game.js) is missing and the integration round is the only chance to create it (Groq Snake run: it tried
    // and was refused because it only "owned" index.html).
    const existing = (await listFiles(dir, '.', 200)).filter((f) => !/^(PLAN|README)\.md$/i.test(f))
    const planned = ctl.run.tasks.filter((t) => !t.id.startsWith('integrate-')).flatMap((t) => t.files ?? [])
    const files = [...new Set([...existing, ...planned])]
    const task: AgentTask = {
      id: `integrate-${round}`,
      runId: ctl.run.id,
      title: `Make all the pieces work together (integration round ${round})`,
      description: [
        `The team built these files in parallel and they don't work together yet. Fix that so the app does what the goal says: ${ctl.run.goal}`,
        `Problems found when loading the app:`,
        ...problems.map((p) => `- ${p}`),
        `You may rewrite any file, merge files, or remove broken parts. Make it simple and complete.`,
        `For a web page: index.html must contain everything it needs (e.g. a <canvas>), load scripts as plain <script src> tags (no import/export), and share state through globals.`
      ].join('\n'),
      files,
      dependsOn: [],
      owner: ctl.workerPool[0]?.name,
      acceptance: 'The app loads with no errors and shows a working version of the goal.',
      status: 'pending',
      attempts: 0,
      log: []
    }
    // Sized from the real files, so the router gives integration (often every file) to a model that can hold them.
    ctl.sizes.set(task.id, estimateTask(task, await fileSizes(dir, existing)))
    ctl.run.tasks.push(task)
    this.log(ctl, 'architect', undefined, `Integration round ${round} queued (${ctl.sizes.get(task.id)!.size}).`)
  }

  async approveMerge(runId: string, approved: boolean) {
    const ctl = this.get(runId)
    if (ctl.run.phase !== 'awaiting-merge-approval') return
    if (!approved) return this.cancel(ctl, 'Final merge rejected. Branches are kept so you can inspect them.', false)
    ctl.run.phase = 'merging'
    this.emit(ctl)
    const root = ctl.root
    const res = await this.host.git.merge(root, ctl.run.integrationBranch!, `Hive: ${ctl.run.goal}`)
    if (!res.ok) return this.fail(ctl, new Error(`Final merge failed: ${res.conflicts}. Resolve it in the Git panel.`))
    this.host.feed({
      actor: 'architect',
      actorType: 'agent',
      kind: 'agent.merge',
      files: [...new Set(ctl.run.tasks.flatMap((t) => t.files))],
      summary: `merged run "${ctl.run.goal}" into ${ctl.run.baseBranch}`
    })
    await this.cleanup(ctl)
    ctl.run.phase = 'done'
    ctl.run.agents.forEach((a) => (a.status = 'idle'))
    this.log(ctl, 'architect', undefined, 'Done. Click Run to try it.')
    this.emit(ctl)
  }

  private async cleanup(ctl: RunCtl, deleteBranches = true) {
    const root = ctl.root
    for (const t of ctl.run.tasks) {
      if (t.worktree) await this.host.git.removeWorktree(root, t.worktree).catch(() => {})
      if (deleteBranches && t.branch) await this.host.git.deleteBranch(root, t.branch).catch(() => {})
    }
    if (ctl.intWorktree) await this.host.git.removeWorktree(root, ctl.intWorktree).catch(() => {})
    if (deleteBranches && ctl.run.integrationBranch) await this.host.git.deleteBranch(root, ctl.run.integrationBranch).catch(() => {})
  }

  // ---------- controls ----------

  pause(runId: string, agent: string) {
    const ctl = this.get(runId)
    ctl.paused.add(agent)
    this.setAgent(ctl, agent, { status: 'paused' })
    this.emit(ctl)
  }

  resume(runId: string, agent: string) {
    const ctl = this.get(runId)
    ctl.paused.delete(agent)
    this.setAgent(ctl, agent, { status: 'working' })
    ctl.waiters.get(`pause:${agent}`)?.(true)
    // Resuming a taken-over task hands it back to review.
    for (const t of ctl.run.tasks) {
      if (t.owner === agent && ctl.takenOver.has(t.id)) {
        ctl.takenOver.delete(t.id)
        ctl.waiters.get(`human:${t.id}`)?.(true)
      }
    }
    this.emit(ctl)
    this.pump(ctl)
  }

  stop(runId: string) {
    const ctl = this.get(runId)
    this.cancel(ctl, 'Stopped by user.', false)
  }

  reassign(runId: string, taskId: string, modelId: string) {
    const ctl = this.get(runId)
    const model = this.host.models().find((m) => m.id === modelId)
    const task = ctl.run.tasks.find((t) => t.id === taskId)
    if (!model || !task) return
    const worker = ctl.workerPool.find((w) => w.name === task.owner)
    if (worker) {
      worker.model = model
      this.setAgent(ctl, worker.name, { modelId: model.id, modelName: model.name })
    }
    this.log(ctl, 'architect', taskId, `Reassigned to ${model.name} (takes effect on the next step).`)
    this.emit(ctl)
  }

  takeOver(runId: string, taskId: string): { worktree: string } {
    const ctl = this.get(runId)
    const task = ctl.run.tasks.find((t) => t.id === taskId)
    if (!task?.worktree) throw new Error('That task has no worktree yet.')
    ctl.takenOver.add(taskId)
    task.status = 'blocked'
    if (task.owner) this.setAgent(ctl, task.owner, { status: 'paused' })
    this.log(ctl, task.owner ?? 'you', taskId, 'Taken over by hand. Edit the files, then press Resume to send it to review.')
    this.emit(ctl)
    return { worktree: task.worktree }
  }

  private waitForHuman(ctl: RunCtl, task: AgentTask) {
    if (!ctl.takenOver.has(task.id)) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => ctl.waiters.set(`human:${task.id}`, resolve))
  }

  private waitWhilePaused(ctl: RunCtl, agent: string) {
    if (!ctl.paused.has(agent)) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => ctl.waiters.set(`pause:${agent}`, resolve))
  }

  // ---------- helpers ----------

  private async chat(
    ctl: RunCtl,
    agent: string,
    taskId: string | undefined,
    model: InstalledModel,
    messages: ChatMessage[],
    tools?: ToolSpec[]
  ): Promise<ChatResult> {
    const release = await this.guard.acquire(model, ctl.abort.signal)
    try {
      this.setAgent(ctl, agent, { status: agent === 'architect' || agent.startsWith('lead') ? 'thinking' : 'working' })
      // A worker's call answered by a stand-in model: the task card shows the model that really did the work.
      const onModel = (m: InstalledModel) => {
        const task = taskId && agent !== 'architect' && !agent.startsWith('lead') ? ctl.run.tasks.find((t) => t.id === taskId) : undefined
        if (!task || task.model === m.name) return
        task.model = m.name
        ctl.actualModel.set(task.id, m)
        this.log(ctl, agent, taskId, `${model.name} is not available; now using ${m.name}.`)
        this.emit(ctl)
      }
      const call = () => (isCliSource(model.source) ? this.askCli(ctl, model, messages, tools, onModel) : this.host.chat(model, messages, tools, { signal: ctl.abort.signal, onModel }))
      const res = await withRetry(call, ctl.abort.signal, (e, n) =>
        this.log(ctl, agent, taskId, `model request failed (${(e as Error).message}); retrying ${n}/3…`)
      )
      if (res.tokensPerSec) this.setAgent(ctl, agent, { tokensPerSec: res.tokensPerSec })
      const visible = stripThinking(res.text).trim()
      if (visible) this.log(ctl, agent, taskId, visible.length > 600 ? visible.slice(0, 600) + '…' : visible)
      return res
    } finally {
      release()
    }
  }

  private get(runId: string): RunCtl {
    const c = this.runs.get(runId)
    if (!c) throw new Error(`Unknown run ${runId}`)
    return c
  }

  private setAgent(ctl: RunCtl, name: string, patch: Partial<AgentInfo>) {
    const a = ctl.run.agents.find((x) => x.name === name)
    if (a) Object.assign(a, patch)
  }

  private log(ctl: RunCtl, agent: string, taskId: string | undefined, line: string) {
    if (taskId) ctl.run.tasks.find((t) => t.id === taskId)?.log.push(`[${agent}] ${line}`)
    this.host.log(ctl.run.id, agent, taskId, line)
  }

  private emit(ctl: RunCtl) {
    this.host.emit(structuredClone(ctl.run))
  }

  private fail(ctl: RunCtl, e: unknown) {
    if (ctl.run.phase === 'cancelled') return
    ctl.run.phase = 'failed'
    ctl.run.error = (e as Error)?.message ?? String(e)
    ctl.run.agents.forEach((a) => (a.status = 'stopped'))
    this.log(ctl, 'architect', undefined, `Run failed: ${ctl.run.error}`)
    this.emit(ctl)
  }

  private cancel(ctl: RunCtl, reason: string, deleteBranches = true) {
    ctl.abort.abort()
    ctl.run.phase = 'cancelled'
    ctl.run.error = reason
    ctl.run.agents.forEach((a) => (a.status = 'stopped'))
    for (const t of ctl.run.tasks) if (!['merged', 'failed'].includes(t.status)) t.status = 'cancelled'
    for (const w of ctl.waiters.values()) w(false)
    this.cleanup(ctl, deleteBranches).catch(() => {})
    this.log(ctl, 'architect', undefined, reason)
    this.emit(ctl)
  }
}

/**
 * The router: give every worker agent its own work. Valid owners picked by the Architect are kept
 * unless that would leave other workers idle; tasks that can start right away are spread first.
 */
export function routeTasks(tasks: { owner?: string; dependsOn: string[] }[], workers: string[]) {
  const load = new Map(workers.map((w) => [w, 0]))
  const ready = tasks.filter((t) => t.dependsOn.length === 0)
  const later = tasks.filter((t) => t.dependsOn.length > 0)
  for (const group of [ready, later]) {
    for (const t of group) {
      const min = Math.min(...load.values())
      const keep = t.owner && load.has(t.owner) && load.get(t.owner)! === min
      if (!keep) t.owner = [...load.entries()].find(([, n]) => n === min)![0]
      load.set(t.owner!, load.get(t.owner!)! + 1)
    }
  }
}

/**
 * Local models serve parallel agents from one queue; a queued request can outlive fetch's header
 * timeout or hit a dropped connection. Retry those (not real errors like 400s) with backoff.
 */
export async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, onRetry?: (e: unknown, n: number) => void, tries = 3): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await fn()
    } catch (e) {
      const msg = String((e as Error)?.message ?? e) + String((e as { cause?: { code?: string } })?.cause?.code ?? '')
      const transient = /fetch failed|ECONNRESET|ECONNREFUSED|socket|terminated|UND_ERR|timeout|\(5\d\d\)/i.test(msg)
      if (signal.aborted || !transient || n > tries) throw e
      onRetry?.(e, n)
      await new Promise((r) => setTimeout(r, 2000 * n))
    }
  }
}

/** The file content in a reply that pasted it instead of calling write_file. */
export function fileFromReply(text: string, file: string): string | null {
  const ext = file.split('.').pop()!.toLowerCase()
  const lang: Record<string, string[]> = { html: ['html', 'htm'], js: ['javascript', 'js'], css: ['css'], py: ['python', 'py'], json: ['json'], ts: ['typescript', 'ts'] }
  const blocks = [...text.matchAll(/```([\w.+-]*)\s*\n([\s\S]*?)```/g)].map((m) => ({ tag: m[1].toLowerCase(), body: m[2] }))
  const match = blocks.find((b) => b.tag === file.toLowerCase() || (lang[ext] ?? [ext]).includes(b.tag)) ?? (blocks.length === 1 ? blocks[0] : undefined)
  if (match && match.body.trim().length > 20) return match.body
  if (ext === 'html' && /^\s*(<!doctype html|<html)/i.test(text) && /<\/html>/i.test(text)) return text.slice(text.search(/<!doctype html|<html/i), text.search(/<\/html>/i) + 7)
  return null
}

/** Current contents of the task's files, so small models edit instead of overwriting blindly. */
/** Sizes (chars, from bytes) of existing project files, for task size estimates. Unreadable files are skipped. */
async function fileSizes(root: string, files: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  await Promise.all(files.map(async (f) => {
    try {
      out[f] = (await fsp.stat(path.join(root, f))).size
    } catch {}
  }))
  return out
}

/** Tokens the worker prompt itself takes (task, rules, tool list), before any file context. */
const PROMPT_TOKENS = 900

/** Text of the files that exist (missing or larger than maxChars are skipped). */
async function readTexts(root: string, files: string[], maxChars = Infinity): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of files) {
    try {
      const text = await fsp.readFile(path.join(root, f), 'utf8')
      if (text.length <= maxChars) out[f] = text
    } catch {}
  }
  return out
}

function summarizeArgs(args: Record<string, unknown>): string {
  if (typeof args.path === 'string') return args.path
  if (typeof args.command === 'string') return args.command
  if (typeof args.query === 'string') return `"${args.query}"`
  return ''
}

/** Keep the system prompt, the first user message and the last ~16 messages; shorten old tool output. */
function trimHistory(messages: ChatMessage[]) {
  const keepTail = 16
  if (messages.length <= keepTail + 2) return
  for (let i = 2; i < messages.length - keepTail; i++) {
    const m = messages[i]
    if (m.role === 'tool' && m.content.length > 300) m.content = m.content.slice(0, 300) + '\n…(older output trimmed)'
    if (m.role === 'assistant' && m.toolCalls) {
      for (const c of m.toolCalls) {
        if (typeof c.arguments.content === 'string' && (c.arguments.content as string).length > 300) {
          c.arguments = { ...c.arguments, content: '(file content written earlier, trimmed)' }
        }
        for (const k of ['find', 'replace']) {
          if (typeof c.arguments[k] === 'string' && (c.arguments[k] as string).length > 300) c.arguments = { ...c.arguments, [k]: '(edit text, trimmed)' }
        }
      }
    }
  }
}

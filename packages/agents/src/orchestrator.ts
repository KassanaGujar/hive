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
import { rankTeam, extractJson, stripThinking } from '@hive/models'
import { classifyCommand } from './policy'
import { allSettled, enforceFileOwnership, normalizePlan, planToTasks, readyTasks, starvedTasks } from './scheduler'
import { architectPlanPrompt, leadReviewPrompt, workerSystemPrompt } from './prompts'
import { AGENT_TOOLS, executeTool, listFiles } from './tools'
import { ResourceGuard } from './guard'

export const MAX_STEPS = 40
export const MAX_REVIEW_ROUNDS = 3
export const COMMAND_TIMEOUT_MS = 5 * 60 * 1000

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
}

export interface OrchestratorHost {
  projectRoot(): string
  models(): InstalledModel[]
  tierOverrides(): Record<string, Tier>
  chat(
    model: InstalledModel,
    messages: ChatMessage[],
    tools: ToolSpec[] | undefined,
    opts: { signal: AbortSignal; onText?: (t: string) => void }
  ): Promise<ChatResult>
  git: GitOps
  exec(cwd: string, command: string, timeoutMs: number, signal: AbortSignal): Promise<{ code: number; output: string }>
  requestApproval(req: ApprovalRequest): Promise<boolean>
  emit(run: AgentRun): void
  log(runId: string, agent: string, taskId: string | undefined, line: string): void
  feed(ev: Omit<FeedEvent, 'id' | 'at'>): void
  memoryBudgetGB(): number
}

const WORKER_NAMES = ['bee', 'wasp', 'ant', 'moth', 'beetle', 'cricket', 'firefly', 'mantis']

interface RunCtl {
  run: AgentRun
  abort: AbortController
  paused: Set<string>
  takenOver: Set<string>
  team: { architect: InstalledModel; leads: InstalledModel[]; workers: InstalledModel[] }
  workerPool: { name: string; model: InstalledModel; busy: boolean }[]
  intWorktree?: string
  waiters: Map<string, (ok: boolean) => void>
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
      this.runs.set(run.id, { run, abort: new AbortController(), paused: new Set(), takenOver: new Set(), team: null as any, workerPool: [], waiters: new Map() })
    }
  }

  team() {
    return rankTeam(this.host.models(), this.host.tierOverrides())
  }

  async start(goal: string, presetTasks?: { title: string; description: string }[]): Promise<string> {
    const t = this.team()
    if (!t.architect) throw new Error('No models installed. Download a model in the Model store first.')
    const team = { architect: t.architect, leads: t.leads, workers: t.workers }
    const id = `run-${Date.now().toString(36)}`
    // Always at least 2 worker agents (they share models when few are installed).
    const nWorkers = Math.max(2, team.workers.length)
    const workerPool = Array.from({ length: nWorkers }, (_, i) => ({
      name: WORKER_NAMES[i % WORKER_NAMES.length] + (i >= WORKER_NAMES.length ? `-${i}` : ''),
      model: team.workers[i % team.workers.length],
      busy: false
    }))
    const agents: AgentInfo[] = [
      { name: 'architect', role: 'architect', modelId: team.architect.id, modelName: team.architect.name, status: 'thinking' },
      ...team.leads.slice(0, 2).map((m, i) => ({ name: `lead${i ? '-' + (i + 1) : ''}`, role: 'lead' as const, modelId: m.id, modelName: m.name, status: 'idle' as const })),
      ...workerPool.map((w) => ({ name: w.name, role: 'worker' as const, modelId: w.model.id, modelName: w.model.name, status: 'idle' as const }))
    ]
    const run: AgentRun = { id, goal, phase: 'planning', tasks: [], agents, baseBranch: '', createdAt: Date.now() }
    const ctl: RunCtl = { run, abort: new AbortController(), paused: new Set(), takenOver: new Set(), team, workerPool, waiters: new Map() }
    this.runs.set(id, ctl)
    this.emit(ctl)
    this.plan(ctl, presetTasks).catch((e) => this.fail(ctl, e))
    return id
  }

  // ---------- planning ----------

  private async plan(ctl: RunCtl, presetTasks?: { title: string; description: string }[]) {
    const { run } = ctl
    const files = (await listFiles(this.host.projectRoot(), '.', 300)).join('\n')
    const workers = ctl.workerPool.map((w) => w.name)
    let prompt = architectPlanPrompt(run.goal, files, workers)
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
    const plan = enforceFileOwnership(normalizePlan(run.goal, raw))
    // Round-robin owners across worker agents when the architect didn't pick valid ones.
    plan.tasks.forEach((t, i) => {
      if (!t.owner || !workers.includes(t.owner)) t.owner = workers[i % workers.length]
    })
    run.plan = plan
    run.tasks = planToTasks(run.id, plan)
    run.phase = 'awaiting-plan-approval'
    this.setAgent(ctl, 'architect', { status: 'waiting' })
    this.log(ctl, 'architect', undefined, `Plan ready: ${plan.tasks.length} task(s). Waiting for your approval.`)
    this.emit(ctl)
  }

  async approvePlan(runId: string, approved: boolean) {
    const ctl = this.get(runId)
    if (ctl.run.phase !== 'awaiting-plan-approval') return
    if (!approved) return this.cancel(ctl, 'Plan rejected.')
    const root = this.host.projectRoot()
    ctl.run.baseBranch = await this.host.git.ensureRepo(root)
    const integration = `hive/run-${ctl.run.id.replace(/^run-/, '')}`
    ctl.run.integrationBranch = integration
    ctl.intWorktree = path.join(root, '.hive', 'worktrees', ctl.run.id, '_integration')
    await this.host.git.addWorktree(root, ctl.intWorktree, integration, ctl.run.baseBranch)
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
      const worker =
        ctl.workerPool.find((w) => !w.busy && w.name === task.owner && !ctl.paused.has(w.name)) ??
        ctl.workerPool.find((w) => !w.busy && !ctl.paused.has(w.name))
      if (!worker) break
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
      run.phase = 'awaiting-merge-approval'
      this.log(ctl, 'architect', undefined, `All tasks settled (${merged} merged). Approve the final merge into ${run.baseBranch}.`)
    }
    this.emit(ctl)
  }

  private async runTask(ctl: RunCtl, task: AgentTask, worker: { name: string; model: InstalledModel }) {
    const root = this.host.projectRoot()
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
      const review = await this.review(ctl, task)
      if (review.approved) {
        task.reviewNotes = review.notes
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
    const files = (await listFiles(wt, '.', 300)).join('\n')
    const owned = await ownedFileContents(wt, task.files)
    const messages: ChatMessage[] = [
      { role: 'system', content: workerSystemPrompt(task, files, notes) + owned },
      { role: 'user', content: notes ? 'Apply the reviewer notes, then call report_done.' : 'Start the task.' }
    ]
    let nudges = 0
    for (let step = 1; step <= MAX_STEPS; step++) {
      await this.waitWhilePaused(ctl, worker.name)
      if (ctl.abort.signal.aborted) throw new Error('Run stopped')
      if (ctl.takenOver.has(task.id)) return 'Finished by hand.'
      const res = await this.chat(ctl, worker.name, task.id, worker.model, messages, AGENT_TOOLS)
      const text = stripThinking(res.text)
      messages.push({ role: 'assistant', content: text, toolCalls: res.toolCalls })
      if (!res.toolCalls?.length) {
        if (++nudges > 3) return text.slice(0, 500) || 'Finished.'
        messages.push({ role: 'user', content: 'Use the tools to do the work (write_file etc). When finished, call report_done.' })
        continue
      }
      for (const call of res.toolCalls) {
        this.log(ctl, worker.name, task.id, `→ ${call.name} ${summarizeArgs(call.arguments)}`)
        const result = await executeTool(
          {
            root: wt,
            runCommand: (cmd) => this.runCommand(ctl, worker.name, task, wt, cmd)
          },
          call.name,
          call.arguments
        )
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
    const lead = ctl.team.leads[0] ?? ctl.team.architect
    const leadName = ctl.run.agents.find((a) => a.role === 'lead')?.name ?? 'lead'
    this.setAgent(ctl, leadName, { status: 'thinking', currentTaskId: task.id })
    this.log(ctl, leadName, task.id, `Reviewing "${task.title}" (round ${task.attempts})`)
    if (!task.diff?.trim()) {
      this.setAgent(ctl, leadName, { status: 'idle', currentTaskId: undefined })
      return { approved: false, notes: 'No files were changed. Write the code for this task with write_file.' }
    }
    const res = await this.chat(ctl, leadName, task.id, lead, [
      { role: 'system', content: 'You are a strict but fair code reviewer. Answer with JSON only.' },
      { role: 'user', content: leadReviewPrompt(task, task.diff) }
    ])
    this.setAgent(ctl, leadName, { status: 'idle', currentTaskId: undefined })
    const j = extractJson<{ approved?: unknown; notes?: unknown }>(res.text)
    if (!j) return { approved: true, notes: 'Reviewer reply unreadable; approved by default.' }
    return { approved: j.approved === true || j.approved === 'true', notes: String(j.notes ?? '') }
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

  async approveMerge(runId: string, approved: boolean) {
    const ctl = this.get(runId)
    if (ctl.run.phase !== 'awaiting-merge-approval') return
    if (!approved) return this.cancel(ctl, 'Final merge rejected. Branches are kept so you can inspect them.', false)
    ctl.run.phase = 'merging'
    this.emit(ctl)
    const root = this.host.projectRoot()
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
    const root = this.host.projectRoot()
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
      const res = await this.host.chat(model, messages, tools, { signal: ctl.abort.signal })
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

/** Current contents of the task's files, so small models edit instead of overwriting blindly. */
async function ownedFileContents(root: string, files: string[]): Promise<string> {
  let out = ''
  for (const f of files.slice(0, 6)) {
    const r = await executeTool({ root, runCommand: async () => '' }, 'read_file', { path: f })
    if (r.output.startsWith('Error')) continue
    out += `\n\nCurrent ${f}:\n\`\`\`\n${r.output.slice(0, 6000)}\n\`\`\``
  }
  return out ? `\n\nThese files already exist. Keep what works and build on it; write the COMPLETE file when you change it.${out}` : ''
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
      }
    }
  }
}

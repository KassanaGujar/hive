import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Eye, FileDiff, FolderOpen, Hand, Pause, Play, Square, X } from 'lucide-react'
import type { AgentInfo, AgentRun, AgentTask, InstalledModel, Tier } from '@hive/shared'
import { invoke, on, timeAgo } from '../lib/api'
import { useStore } from '../store'
import { openModelStore, openPreview, refreshModels, runProject } from '../lib/actions'

type Team = { architect?: InstalledModel; leads: InstalledModel[]; workers: InstalledModel[] }

const PHASE: Record<AgentRun['phase'], string> = {
  planning: 'The architect is writing the plan',
  'awaiting-plan-approval': 'Plan ready. Approve it to start the workers',
  working: 'Agents are building',
  merging: 'Merging',
  'awaiting-merge-approval': 'Finished. Try it, then merge it into your project',
  done: 'Merged into your project',
  failed: 'Stopped with a problem',
  cancelled: 'Stopped'
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'waiting',
  ready: 'waiting',
  running: 'writing',
  review: 'in review',
  'changes-requested': 'fixing',
  approved: 'approved',
  merged: 'done',
  failed: 'failed',
  cancelled: 'skipped',
  blocked: 'you took over'
}
const STATUS_CLS: Record<string, string> = {
  running: 'text-accent',
  review: 'text-wing',
  'changes-requested': 'text-warn',
  approved: 'text-ok',
  merged: 'text-ok',
  failed: 'text-bad',
  blocked: 'text-warn'
}

/** Project-relative path of an agent's working folder. */
const relDir = (abs: string) => {
  const root = useStore.getState().root ?? ''
  return abs.slice(root.length + 1).replace(/\\/g, '/')
}

export function AgentsPanel() {
  const runs = useStore((s) => s.runs)
  const models = useStore((s) => s.models)
  const approvals = useStore((s) => s.approvals)
  const follow = useStore((s) => s.followAgents)
  const toast = useStore((s) => s.toast)
  const [team, setTeam] = useState<Team | null>(null)
  const [goal, setGoal] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [offload, setOffload] = useState<string | null>(null)
  useEffect(() => {
    invoke('models:offload').then(setOffload).catch(() => {})
    return on('models:offload', setOffload)
  }, [])

  const loadTeam = () => invoke('agents:team').then(setTeam)
  useEffect(() => {
    refreshModels().then(loadTeam)
    invoke('agents:runs').then((r) => r.forEach((x) => useStore.getState().upsertRun(x)))
    return on('agents:log', ({ runId, agent, line }) => setLogs((l) => ({ ...l, [runId]: [...(l[runId] ?? []), `${agent}: ${line}`].slice(-400) })))
  }, [])
  useEffect(() => {
    loadTeam()
  }, [models.length])

  const run = runs.find((r) => r.id === selected) ?? runs[0]
  const active = run && !['done', 'failed', 'cancelled'].includes(run.phase)

  const start = async () => {
    if (!goal.trim()) return
    try {
      const id = await invoke('agents:start', goal.trim())
      setSelected(id)
      setGoal('')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const guard = (p: Promise<unknown>) => p.catch((e) => toast(e.message, 'error'))

  if (!models.length)
    return (
      <div className="flex flex-col gap-3 p-4">
        <span className="pane-title">AI team</span>
        <div className="text-muted">The team needs at least one model. One model can play every role; more models make a stronger team.</div>
        <button className="btn-primary self-start" onClick={openModelStore}>
          Get a model
        </button>
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-2 px-3">
        <span className="pane-title flex-1">AI team</span>
        <label className="flex items-center gap-1.5 text-[11.5px] text-muted" title="Open each file in the editor as an agent writes it">
          <input type="checkbox" className="accent-[var(--accent)]" checked={follow} onChange={(e) => useStore.getState().set({ followAgents: e.target.checked })} />
          <Eye size={12} /> Follow along
        </label>
        {runs.length > 1 && (
          <select className="input !w-36 !py-1" value={run?.id} onChange={(e) => setSelected(e.target.value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.goal.slice(0, 28)} ({timeAgo(r.createdAt)})
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-6">
        {/* the comb: live agents during a run, otherwise the team the models would form */}
        <Comb agents={active || run?.phase === 'done' ? run!.agents : teamAsAgents(team)} />
        {!active && team && <TierEditor team={team} onChange={() => refreshModels().then(loadTeam)} />}

        <div className="my-3">
          <textarea
            className="input h-[68px] resize-none !text-[13px]"
            placeholder="What should the team build? For example: a to-do web app with dark mode"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.ctrlKey && e.key === 'Enter' && start()}
          />
          <button className="btn-primary mt-1.5 w-full justify-center !py-1.5" disabled={!goal.trim()} onClick={start}>
            Start building
          </button>
        </div>

        {offload && active && (
          <div className="card mb-2 border-warn/60 p-3 text-[12px]" role="alert">
            <b>Running slowly.</b> {offload}
          </div>
        )}

        {approvals.map((a) => (
          <div key={a.id} className="card mb-2 border-warn/60 p-3">
            <div className="mb-1 text-[12px]">
              <b>{a.agent}</b> wants to run a command that {a.reason}:
            </div>
            <pre className="mb-2 overflow-x-auto rounded-md bg-bg p-2 font-mono text-[11px]">{a.command}</pre>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => answer(a.id, true)}>
                <Check size={12} /> Allow once
              </button>
              <button className="btn" onClick={() => answer(a.id, false)}>
                <X size={12} /> Deny
              </button>
            </div>
          </div>
        ))}

        {run && <RunView run={run} logs={logs[run.id] ?? []} models={models} guard={guard} />}
      </div>
    </div>
  )
}

function answer(id: string, ok: boolean) {
  invoke('agents:approveCommand', id, ok)
  const s = useStore.getState()
  s.set({ approvals: s.approvals.filter((a) => a.id !== id) })
}

function teamAsAgents(team: Team | null): AgentInfo[] {
  if (!team?.architect) return []
  const mk = (name: string, role: AgentInfo['role'], m: InstalledModel): AgentInfo => ({ name, role, modelId: m.id, modelName: m.name, status: 'idle' })
  const workers = ['bee', 'wasp', 'ant']
  return [
    mk('architect', 'architect', team.architect),
    mk('lead', 'lead', team.leads[0] ?? team.architect),
    ...workers.map((w, i) => mk(w, 'worker', team.workers[i % Math.max(team.workers.length, 1)] ?? team.architect!))
  ]
}

// ---------- the honeycomb ----------

const HEX = 'M30 2 L56 17 L56 47 L30 62 L4 47 L4 17 Z'
/** "Qwen2.5 Coder 7B (…)" → "Qwen2.5 7B": enough to recognise the model inside a cell. */
const shortModel = (n: string) => {
  const words = n.replace(/\(.*\)/, '').trim().split(/\s+/)
  const s = words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : words.join(' ')
  return s.length > 11 ? s.slice(0, 10) + '…' : s
}

/** One wax cell per agent. Honey rises while it works; the outline pulses while it waits for you. */
function Cell({ a, x, y }: { a: AgentInfo; x: number; y: number }) {
  const busy = a.status === 'working' || a.status === 'thinking'
  const waiting = a.status === 'waiting' || a.status === 'paused'
  const tone = a.role === 'worker' ? 'var(--accent)' : 'var(--wing)'
  const id = `clip-${a.name}`
  return (
    <g transform={`translate(${x} ${y})`} className={busy ? 'cell-working' : waiting ? 'cell-waiting' : ''}>
      <title>{`${a.name} (${a.role}), ${a.modelName}: ${a.status}${a.currentTaskId ? `, on ${a.currentTaskId}` : ''}`}</title>
      <clipPath id={id}>
        <path d={HEX} />
      </clipPath>
      <path d={HEX} fill="var(--panel2)" />
      {busy && (
        <g clipPath={`url(#${id})`}>
          <rect className="cell-fill" x="0" y="0" width="60" height="64" fill={tone} opacity="0.38" />
        </g>
      )}
      <path d={HEX} fill="none" stroke={a.status === 'stopped' ? 'var(--bad)' : busy || waiting ? tone : 'var(--line)'} strokeWidth={busy || waiting ? 2.2 : 1.5} strokeDasharray={waiting ? '5 4' : undefined} strokeLinejoin="round" />
      <text x="30" y="30" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--fg)" style={{ fontFamily: 'var(--font-display)' }}>
        {a.name}
      </text>
      <text x="30" y="42" textAnchor="middle" fontSize="7.5" fill={busy ? 'var(--fg)' : 'var(--muted)'}>
        {busy ? (a.tokensPerSec ? `${Math.round(a.tokensPerSec)} tok/s` : a.status) : a.status === 'idle' ? shortModel(a.modelName) : a.status}
      </text>
    </g>
  )
}

function Comb({ agents }: { agents: AgentInfo[] }) {
  if (!agents.length) return null
  const top = agents.filter((a) => a.role !== 'worker')
  const workers = agents.filter((a) => a.role === 'worker')
  const W = 54 // horizontal pitch
  const width = Math.max(top.length, workers.length + 0.5) * W + 10
  // planners sit on the top row, workers nest half a cell over on the row below
  return (
    <div className="flex justify-center py-1">
      {/* drawn 1.3x: at 1x the model name in each cell was 7.5 px, too small to read */}
      <svg width={width * 1.3} height={(workers.length ? 116 : 68) * 1.3} style={{ maxWidth: '100%', height: 'auto' }} viewBox={`0 0 ${width} ${workers.length ? 116 : 68}`} role="img" aria-label="AI team status">
        {top.map((a, i) => (
          <Cell key={a.name} a={a} x={(width - top.length * W) / 2 + i * W - 3} y={2} />
        ))}
        {workers.map((a, i) => (
          <Cell key={a.name} a={a} x={(width - workers.length * W) / 2 + i * W - 3} y={49} />
        ))}
      </svg>
    </div>
  )
}

function TierEditor({ team, onChange }: { team: Team; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)
  const col = (title: string, tier: Tier, list: InstalledModel[]) => (
    <div
      className="min-h-14 flex-1 rounded-lg bg-panel2 p-1.5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async () => {
        if (!drag) return
        await invoke('models:setTier', drag, tier)
        setDrag(null)
        onChange()
      }}
    >
      <div className="mb-1 text-[10.5px] font-semibold text-muted">{title}</div>
      {list.map((m) => (
        <div key={m.id + title} draggable onDragStart={() => setDrag(m.id)} className="mb-1 cursor-grab truncate rounded-md bg-bg px-1.5 py-0.5 text-[11px]" title={`${m.name}: drag to another column`}>
          {m.name}
        </div>
      ))}
    </div>
  )
  return (
    <div className="mb-1">
      <button className="mx-auto flex items-center gap-1 text-[11.5px] text-muted hover:text-fg" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Who plays which role
      </button>
      {open && (
        <div className="mt-1.5 flex gap-1.5">
          {col('Architect', 'top', team.architect ? [team.architect] : [])}
          {col('Reviewers', 'lead', team.leads)}
          {col('Workers', 'worker', team.workers)}
        </div>
      )}
    </div>
  )
}

function RunView({ run, logs, models, guard }: { run: AgentRun; logs: string[]; models: InstalledModel[]; guard: (p: Promise<unknown>) => void }) {
  const logEnd = useRef<HTMLDivElement>(null)
  const [showLog, setShowLog] = useState(false)
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' })
  }, [logs.length, showLog])
  const active = !['done', 'failed', 'cancelled'].includes(run.phase)
  const merged = run.tasks.filter((t) => t.status === 'merged').length
  const canTry = !!run.previewDir && merged > 0 && run.phase !== 'done'

  const tryIt = async () => {
    window.dispatchEvent(new CustomEvent('hive:saveAll'))
    const st = await invoke('run:start', run.previewDir)
    if (st.status === 'failed' && st.message) useStore.getState().toast(st.message, 'error')
    if (st.previewUrl) openPreview(st.previewUrl)
    useStore.getState().set({ bottomOpen: true })
  }
  const browse = (dir: string, label: string) => useStore.getState().set({ explorerRoot: { dir, label }, side: 'explorer' })

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-3">
        <div className="mb-1.5 font-medium leading-snug">{run.goal}</div>
        <div className={`text-[12px] ${run.phase === 'failed' ? 'text-bad' : run.phase === 'done' ? 'text-ok' : 'text-accent'}`}>
          {PHASE[run.phase]}
          {run.error && `: ${run.error}`}
        </div>
        {run.tasks.length > 0 && run.phase !== 'awaiting-plan-approval' && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel2">
            <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${(merged / run.tasks.length) * 100}%` }} />
          </div>
        )}

        {run.phase === 'awaiting-plan-approval' && run.plan && (
          <div className="mt-3">
            {run.plan.summary && <div className="mb-2 text-muted">{run.plan.summary}</div>}
            <ol className="mb-3 flex flex-col gap-2">
              {run.plan.tasks.map((t, i) => (
                <li key={t.id} className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel2 text-[10.5px] font-semibold">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="font-medium">
                      {t.title} <span className="font-normal text-wing">for {t.owner}</span>
                    </div>
                    {t.files.length > 0 && <div className="truncate font-mono text-[10.5px] text-muted">{t.files.join(', ')}</div>}
                    {t.dependsOn.length > 0 && <div className="text-[10.5px] text-muted">after {t.dependsOn.join(', ')}</div>}
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => guard(invoke('agents:approvePlan', run.id, true))}>
                Approve plan
              </button>
              <button className="btn" onClick={() => guard(invoke('agents:approvePlan', run.id, false))}>
                Reject
              </button>
            </div>
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap gap-2">
          {canTry && (
            <>
              <button className={run.phase === 'awaiting-merge-approval' ? 'btn-primary' : 'btn'} onClick={tryIt} title="Run the combined result without touching your project">
                <Play size={12} /> Try it
              </button>
              <button className="btn" onClick={() => browse(run.previewDir!, 'the combined result')}>
                <FolderOpen size={12} /> Open the files
              </button>
            </>
          )}
          {run.phase === 'awaiting-merge-approval' && (
            <>
              <button className="btn-primary" onClick={() => guard(invoke('agents:approveMerge', run.id, true))}>
                Merge into {run.baseBranch}
              </button>
              <button className="btn" onClick={() => guard(invoke('agents:approveMerge', run.id, false))}>
                Discard
              </button>
            </>
          )}
          {run.phase === 'done' && (
            <button className="btn-primary" onClick={runProject}>
              <Play size={12} /> Run it
            </button>
          )}
          {run.resumable && (
            <button className="btn-primary" onClick={() => guard(invoke('agents:resumeRun', run.id))}>
              <Play size={12} /> Resume
            </button>
          )}
          {active && run.phase !== 'awaiting-plan-approval' && (
            <button className="btn" onClick={() => guard(invoke('agents:stop', run.id))}>
              <Square size={11} className="text-bad" /> Stop the team
            </button>
          )}
        </div>
      </div>

      {run.tasks.length > 0 && run.phase !== 'awaiting-plan-approval' && (
        <div>
          <div className="label mb-1.5">Tasks</div>
          {run.tasks.map((t) => (
            <TaskRow key={t.id} run={run} t={t} models={models} guard={guard} browse={browse} />
          ))}
        </div>
      )}

      <div>
        <button className="label mb-1 flex items-center gap-1 hover:text-fg" onClick={() => setShowLog(!showLog)}>
          {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Activity log
        </button>
        {showLog && (
          <div className="max-h-72 overflow-auto rounded-lg bg-bg p-2 font-mono text-[10.5px] leading-snug text-muted">
            {logs.length === 0 ? <div>Nothing yet.</div> : logs.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
            <div ref={logEnd} />
          </div>
        )}
      </div>
    </div>
  )
}

function TaskRow({ run, t, models, guard, browse }: { run: AgentRun; t: AgentTask; models: InstalledModel[]; guard: (p: Promise<unknown>) => void; browse: (dir: string, label: string) => void }) {
  const [open, setOpen] = useState(false)
  const live = ['running', 'review', 'changes-requested', 'blocked'].includes(t.status)
  const showDiff = () => useStore.getState().openTab({ id: `taskdiff:${run.id}:${t.id}`, kind: 'diff', title: `${t.id} changes`, path: `${t.id}.diff`, original: '', modified: t.diff ?? '' })
  const takeOver = async () => {
    try {
      const { worktree } = await invoke('agents:takeOver', run.id, t.id)
      browse(relDir(worktree), `${t.owner}'s files`)
      useStore.getState().toast(`${t.owner} is paused. Edit the files, then press Resume to send them to review.`)
    } catch (e) {
      useStore.getState().toast((e as Error).message, 'error')
    }
  }
  return (
    <div className={`mb-1.5 rounded-lg border ${live ? 'border-accent/40' : 'border-line'}`}>
      <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {t.size && (
              <span
                className="mr-1.5 inline-block rounded border border-line px-1 text-[9.5px] font-semibold text-muted"
                title={`Router estimate: ${t.size} task${t.estimate ? `, about ${t.estimate} tokens to write` : ''}`}
              >
                {t.size === 'small' ? 'S' : t.size === 'medium' ? 'M' : 'L'}
              </span>
            )}
            {t.title}
          </span>
          <span className="block truncate text-[10.5px] text-muted">
            {t.owner}
            {t.model && <span> · {t.model}</span>}
            {t.files.length > 0 && <span className="font-mono"> {t.files.join(', ')}</span>}
          </span>
        </span>
        <span className={`shrink-0 text-[11px] font-medium ${STATUS_CLS[t.status] ?? 'text-muted'}`}>
          {STATUS_TEXT[t.status] ?? t.status}
          {t.attempts > 1 ? `, round ${t.attempts}` : ''}
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-2.5 text-[11.5px]">
          <div className="mb-1.5 whitespace-pre-wrap text-muted">{t.description.split('\n')[0]}</div>
          {t.reviewNotes && <div className="mb-1.5 text-warn">Reviewer: {t.reviewNotes}</div>}
          <div className="flex flex-wrap gap-1.5">
            {t.worktree && !['merged', 'cancelled'].includes(t.status) && (
              <button className="btn" onClick={() => browse(relDir(t.worktree!), `${t.owner}'s files`)}>
                <FolderOpen size={11} /> Open files
              </button>
            )}
            {t.diff && (
              <button className="btn" onClick={showDiff}>
                <FileDiff size={11} /> Changes
              </button>
            )}
            {['running', 'review', 'changes-requested'].includes(t.status) && (
              <button className="btn" onClick={takeOver}>
                <Hand size={11} /> Take over
              </button>
            )}
            {t.status === 'blocked' && t.owner && (
              <button className="btn-primary" onClick={() => guard(invoke('agents:resume', run.id, t.owner!))}>
                <Play size={11} /> Resume
              </button>
            )}
            {live && t.owner && t.status !== 'blocked' && (
              <button className="btn" onClick={() => guard(invoke('agents:pause', run.id, t.owner!))}>
                <Pause size={11} /> Pause
              </button>
            )}
            {!['merged', 'failed', 'cancelled'].includes(t.status) && (
              <select className="input !w-auto !py-1" defaultValue="" onChange={(e) => e.target.value && guard(invoke('agents:reassign', run.id, t.id, e.target.value))}>
                <option value="">Give to another model</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {t.log.length > 0 && <div className="mt-2 max-h-40 overflow-auto rounded-md bg-bg p-1.5 font-mono text-[10px] whitespace-pre-wrap text-muted">{t.log.slice(-60).join('\n')}</div>}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, FileDiff, Hand, Pause, Play, Square, X } from 'lucide-react'
import type { AgentRun, AgentTask, InstalledModel, Tier } from '@hive/shared'
import { invoke, on, timeAgo } from '../lib/api'
import { useStore } from '../store'
import { openModelStore, refreshModels, runProject } from '../lib/actions'

type Team = { architect?: InstalledModel; leads: InstalledModel[]; workers: InstalledModel[] }

const PHASE: Record<AgentRun['phase'], string> = {
  planning: 'Architect is writing the plan…',
  'awaiting-plan-approval': 'Plan ready — approve it to start the workers',
  working: 'Agents are working',
  merging: 'Merging…',
  'awaiting-merge-approval': 'All done — approve the final merge',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped'
}

const STATUS_CLS: Record<string, string> = {
  running: 'text-accent',
  review: 'text-accent',
  'changes-requested': 'text-warn',
  approved: 'text-ok',
  merged: 'text-ok',
  failed: 'text-bad',
  cancelled: 'text-muted',
  blocked: 'text-warn',
  pending: 'text-muted'
}

export function AgentsPanel() {
  const runs = useStore((s) => s.runs)
  const models = useStore((s) => s.models)
  const approvals = useStore((s) => s.approvals)
  const toast = useStore((s) => s.toast)
  const [team, setTeam] = useState<Team | null>(null)
  const [goal, setGoal] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, string[]>>({})

  const loadTeam = () => invoke('agents:team').then(setTeam)
  useEffect(() => {
    refreshModels().then(loadTeam)
    invoke('agents:runs').then((r) => r.forEach((x) => useStore.getState().upsertRun(x)))
    return on('agents:log', ({ runId, agent, line }) =>
      setLogs((l) => ({ ...l, [runId]: [...(l[runId] ?? []), `${agent}: ${line}`].slice(-400) }))
    )
  }, [])
  useEffect(() => {
    loadTeam()
  }, [models.length])

  const run = runs.find((r) => r.id === selected) ?? runs[0]

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
        <span className="label">Agents</span>
        <div className="text-muted">The agent team needs at least one model. With one model it plays every role; more models make a stronger team.</div>
        <button className="btn-primary self-start" onClick={openModelStore}>
          Open Model store
        </button>
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center px-3">
        <span className="label flex-1">Agents</span>
        {runs.length > 1 && (
          <select className="input w-44" value={run?.id} onChange={(e) => setSelected(e.target.value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.goal.slice(0, 40)} · {timeAgo(r.createdAt)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-6">
        {team && <TeamView team={team} onChange={() => refreshModels().then(loadTeam)} />}

        <div className="my-3">
          <textarea
            className="input h-16 resize-none text-[13px]"
            placeholder='Describe what to build, e.g. "Make a to-do web app with dark mode"'
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.ctrlKey && e.key === 'Enter' && start()}
          />
          <button className="btn-primary mt-1 w-full justify-center" disabled={!goal.trim()} onClick={start}>
            Start the team
          </button>
        </div>

        {approvals.map((a) => (
          <div key={a.id} className="card mb-2 border-warn/60 p-3">
            <div className="mb-1 text-[12px]">
              <b>{a.agent}</b> wants to run a command that {a.reason}:
            </div>
            <pre className="mb-2 overflow-x-auto rounded bg-bg p-2 font-mono text-[11px]">{a.command}</pre>
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

function TeamView({ team, onChange }: { team: Team; onChange: () => void }) {
  const [drag, setDrag] = useState<string | null>(null)
  const col = (title: string, tier: Tier, list: InstalledModel[]) => (
    <div
      className="min-h-14 flex-1 rounded-md bg-panel2 p-1.5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async () => {
        if (!drag) return
        await invoke('models:setTier', drag, tier)
        setDrag(null)
        onChange()
      }}
    >
      <div className="mb-1 text-[10px] font-semibold text-muted uppercase">{title}</div>
      {list.map((m) => (
        <div key={m.id + title} draggable onDragStart={() => setDrag(m.id)} className="mb-1 cursor-grab truncate rounded bg-bg px-1.5 py-0.5 text-[11px]" title={`${m.name} — drag to change tier`}>
          {m.name}
        </div>
      ))}
    </div>
  )
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted">Team (drag models between tiers)</div>
      <div className="flex gap-1.5">
        {col('Architect', 'top', team.architect ? [team.architect] : [])}
        {col('Leads', 'lead', team.leads)}
        {col('Workers', 'worker', team.workers)}
      </div>
    </div>
  )
}

function RunView({ run, logs, models, guard }: { run: AgentRun; logs: string[]; models: InstalledModel[]; guard: (p: Promise<unknown>) => void }) {
  const logEnd = useRef<HTMLDivElement>(null)
  const [showLog, setShowLog] = useState(true)
  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [logs.length])
  const active = !['done', 'failed', 'cancelled'].includes(run.phase)

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-3">
        <div className="mb-1 text-[11px] text-muted">Goal</div>
        <div className="mb-2 font-medium">{run.goal}</div>
        <div className={`text-[12px] ${run.phase === 'failed' ? 'text-bad' : run.phase === 'done' ? 'text-ok' : 'text-accent'}`}>
          {PHASE[run.phase]}
          {run.error && ` — ${run.error}`}
        </div>
        {run.phase === 'awaiting-plan-approval' && run.plan && (
          <div className="mt-2">
            {run.plan.summary && <div className="mb-2 text-muted">{run.plan.summary}</div>}
            <ol className="mb-2 list-decimal pl-5">
              {run.plan.tasks.map((t) => (
                <li key={t.id} className="mb-1">
                  <b>{t.title}</b> <span className="text-muted">→ {t.owner}</span>
                  <div className="text-[11px] text-muted">{t.description}</div>
                  {t.files.length > 0 && <div className="font-mono text-[10px] text-muted">{t.files.join(', ')}</div>}
                  {t.dependsOn.length > 0 && <div className="text-[10px] text-muted">after: {t.dependsOn.join(', ')}</div>}
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
        {run.phase === 'awaiting-merge-approval' && (
          <div className="mt-2 flex gap-2">
            <button className="btn-primary" onClick={() => guard(invoke('agents:approveMerge', run.id, true))}>
              Merge into {run.baseBranch}
            </button>
            <button className="btn" onClick={() => guard(invoke('agents:approveMerge', run.id, false))}>
              Don't merge
            </button>
          </div>
        )}
        {run.phase === 'done' && (
          <button className="btn-primary mt-2" onClick={runProject}>
            <Play size={12} /> Run it
          </button>
        )}
        {active && run.phase !== 'awaiting-plan-approval' && (
          <button className="btn mt-2" onClick={() => guard(invoke('agents:stop', run.id))}>
            <Square size={12} className="text-bad" /> Stop all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2">
        {run.agents.map((a) => (
          <div key={a.name} className="card flex items-center gap-2 p-2">
            <span className={`h-2 w-2 rounded-full ${a.status === 'working' || a.status === 'thinking' ? 'animate-pulse bg-accent' : a.status === 'waiting' ? 'bg-warn' : a.status === 'paused' ? 'bg-warn' : a.status === 'stopped' ? 'bg-bad' : 'bg-muted'}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <b>{a.name}</b> <span className="text-[11px] text-muted">{a.role}</span>
              </div>
              <div className="truncate text-[11px] text-muted">
                {a.modelName} · {a.status}
                {a.currentTaskId && ` · ${a.currentTaskId}`}
                {a.tokensPerSec ? ` · ${a.tokensPerSec} tok/s` : ''}
              </div>
            </div>
            {active && a.role === 'worker' && (
              a.status === 'paused' ? (
                <button className="btn-ghost" title="Resume" onClick={() => guard(invoke('agents:resume', run.id, a.name))}>
                  <Play size={13} />
                </button>
              ) : (
                <button className="btn-ghost" title="Pause" onClick={() => guard(invoke('agents:pause', run.id, a.name))}>
                  <Pause size={13} />
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {run.tasks.length > 0 && (
        <div>
          <div className="label mb-1">Tasks</div>
          {run.tasks.map((t) => (
            <TaskRow key={t.id} run={run} t={t} models={models} guard={guard} />
          ))}
        </div>
      )}

      <div>
        <button className="label mb-1 flex items-center gap-1" onClick={() => setShowLog(!showLog)}>
          {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Live log
        </button>
        {showLog && (
          <div className="max-h-72 overflow-auto rounded-md bg-bg p-2 font-mono text-[10.5px] leading-snug text-muted">
            {logs.length === 0 ? <div>No activity yet.</div> : logs.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
            <div ref={logEnd} />
          </div>
        )}
      </div>
    </div>
  )
}

function TaskRow({ run, t, models, guard }: { run: AgentRun; t: AgentTask; models: InstalledModel[]; guard: (p: Promise<unknown>) => void }) {
  const [open, setOpen] = useState(false)
  const showDiff = () =>
    useStore.getState().openTab({ id: `taskdiff:${run.id}:${t.id}`, kind: 'diff', title: `${t.id} diff`, path: `${t.id}.diff`, original: '', modified: t.diff ?? '' })
  const takeOver = async () => {
    try {
      const { worktree } = await invoke('agents:takeOver', run.id, t.id)
      useStore.getState().toast(`Edit the files in ${worktree}, then press Resume on ${t.owner}.`, 'info', { label: 'Open folder', run: () => invoke('shell:openPath', worktree) })
    } catch (e) {
      useStore.getState().toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="mb-1 rounded-md border border-line">
      <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex-1 truncate">{t.title}</span>
        <span className={`text-[11px] ${STATUS_CLS[t.status] ?? ''}`}>
          {t.status}
          {t.attempts > 1 ? ` (round ${t.attempts})` : ''}
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-2 text-[11px]">
          <div className="mb-1 text-muted">
            {t.owner} · {t.model ?? 'not started'}
            {t.branch && (
              <>
                {' '}
                · <span className="font-mono">{t.branch}</span>
              </>
            )}
          </div>
          <div className="mb-1">{t.description}</div>
          {t.reviewNotes && <div className="mb-1 text-warn">Review: {t.reviewNotes}</div>}
          <div className="flex flex-wrap gap-1">
            {t.diff && (
              <button className="btn" onClick={showDiff}>
                <FileDiff size={11} /> Diff
              </button>
            )}
            {['running', 'review', 'changes-requested'].includes(t.status) && (
              <button className="btn" onClick={takeOver}>
                <Hand size={11} /> Take over
              </button>
            )}
            {!['merged', 'failed', 'cancelled'].includes(t.status) && (
              <select className="input w-auto" defaultValue="" onChange={(e) => e.target.value && guard(invoke('agents:reassign', run.id, t.id, e.target.value))}>
                <option value="">Reassign…</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {t.log.length > 0 && <div className="mt-2 max-h-40 overflow-auto rounded bg-bg p-1.5 font-mono text-[10px] whitespace-pre-wrap text-muted">{t.log.slice(-60).join('\n')}</div>}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Minus, Plus, RefreshCw } from 'lucide-react'
import { makeFeedEvent } from '@hive/collab'
import type { GitCommit, GitStatus } from '@hive/shared'
import { invoke, on, timeAgo } from '../lib/api'
import { useStore, ask, actorName } from '../store'
import { session } from '../collab/session'

export function GitPanel() {
  const [st, setSt] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitCommit[]>([])
  const [msg, setMsg] = useState('')
  const toast = useStore((s) => s.toast)

  const refresh = useCallback(async () => {
    try {
      const s = await invoke('git:status')
      setSt(s)
      if (s.isRepo) setLog(await invoke('git:log', 30))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }, [toast])

  useEffect(() => {
    refresh()
    let t: ReturnType<typeof setTimeout>
    return on('fs:changed', () => {
      clearTimeout(t)
      t = setTimeout(refresh, 500)
    })
  }, [refresh])

  const guard = (fn: () => Promise<unknown>) => () => fn().then(refresh).catch((e) => toast(e.message, 'error'))

  if (!st) return <div className="p-3 text-muted">Loading…</div>
  if (!st.isRepo)
    return (
      <div className="flex flex-col gap-2 p-3">
        <span className="label">Source control</span>
        <div className="text-muted">This folder isn't a git repository yet.</div>
        <button className="btn-primary self-start" onClick={guard(() => invoke('git:init'))}>
          Initialise git
        </button>
      </div>
    )

  const staged = st.files.filter((f) => f.index !== ' ' && f.index !== '?')
  const changed = st.files.filter((f) => f.workingDir !== ' ' || f.index === '?')

  const openDiff = async (path: string, isStaged: boolean) => {
    const original = await invoke('git:show', path, 'HEAD')
    const modified = await invoke('fs:read', path).catch(() => '')
    useStore.getState().openTab({ id: `diff:${path}`, kind: 'diff', title: `${path.split('/').pop()} (${isStaged ? 'staged' : 'changes'})`, path, original, modified })
  }

  const commit = guard(async () => {
    if (!msg.trim()) return
    if (staged.length === 0) await invoke('git:stage', [])
    const hash = await invoke('git:commit', msg.trim())
    session()?.pushFeed(makeFeedEvent({ actor: actorName(), kind: 'git.commit', files: (staged.length ? staged : changed).map((f) => f.path), summary: `committed "${msg.trim()}" (${hash.slice(0, 7)})` }))
    setMsg('')
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-1 px-3">
        <span className="label flex-1">Source control</span>
        <button className="btn-ghost" onClick={refresh} title="Refresh">
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="flex flex-col gap-2 px-3 pb-2">
        <div className="flex items-center gap-2">
          <select className="input flex-1" value={st.branch} onChange={(e) => guard(() => invoke('git:checkout', e.target.value))()}>
            {[...new Set([st.branch, ...st.branches])].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <button
            className="btn"
            onClick={guard(async () => {
              const b = await ask('New branch name', '', 'feature/dark-mode')
              if (b) await invoke('git:checkout', b, true)
            })}
          >
            + Branch
          </button>
        </div>
        <textarea className="input h-16 resize-none" placeholder="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.ctrlKey && e.key === 'Enter' && commit()} />
        <button className="btn-primary justify-center" disabled={!msg.trim() || st.files.length === 0} onClick={commit}>
          Commit {staged.length ? `${staged.length} staged` : st.files.length ? `all ${st.files.length}` : ''}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-6">
        {staged.length > 0 && <Section title="Staged" files={staged.map((f) => f.path)} action={<Minus size={12} />} onAction={(p) => guard(() => invoke('git:unstage', [p]))()} onOpen={(p) => openDiff(p, true)} code={(p) => staged.find((f) => f.path === p)!.index} />}
        <Section title="Changes" files={changed.map((f) => f.path)} action={<Plus size={12} />} onAction={(p) => guard(() => invoke('git:stage', [p]))()} onOpen={(p) => openDiff(p, false)} code={(p) => { const f = changed.find((x) => x.path === p)!; return f.index === '?' ? 'U' : f.workingDir }} />
        <div className="label mt-3 px-3">History</div>
        {log.map((c) => (
          <div key={c.hash} className="px-3 py-1">
            <div className="truncate">{c.message}</div>
            <div className="text-[11px] text-muted">
              {c.hash.slice(0, 7)} · {c.author} · {timeAgo(new Date(c.date).getTime())}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Section(p: { title: string; files: string[]; action: React.ReactNode; onAction: (path: string) => void; onOpen: (path: string) => void; code: (path: string) => string }) {
  return (
    <div>
      <div className="label px-3 py-1">
        {p.title} ({p.files.length})
      </div>
      {p.files.map((f) => (
        <div key={f} className="group flex items-center gap-2 px-3 py-0.5 hover:bg-panel2">
          <button className="flex-1 truncate text-left" onClick={() => p.onOpen(f)} title={f}>
            {f}
          </button>
          <span className="font-mono text-[10px] text-warn">{p.code(f)}</span>
          <button className="btn-ghost opacity-0 group-hover:opacity-100" onClick={() => p.onAction(f)}>
            {p.action}
          </button>
        </div>
      ))}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Bot, FilePen, FilePlus, FileText, FileX, GitCommit, Play, UserRound, XCircle } from 'lucide-react'
import type { FeedEvent } from '@hive/shared'

/** Drawn icon per kind of change (no emoji). */
function FeedIcon({ kind }: { kind: FeedEvent['kind'] }) {
  const Icon = kind === 'file.deleted' ? FileX : kind === 'file.created' ? FilePlus : kind.startsWith('file.') ? FilePen : kind === 'git.commit' ? GitCommit : kind.startsWith('agent.') ? Bot : kind === 'run.failed' ? XCircle : kind.startsWith('run.') ? Play : kind.startsWith('member.') ? UserRound : FileText
  const tone = kind.startsWith('agent.') ? 'text-wing' : kind === 'run.failed' || kind === 'file.deleted' ? 'text-bad' : 'text-muted'
  return <Icon size={13} className={tone} />
}
import { timeAgo } from '../lib/api'
import { useStore } from '../store'

const FILTERS: [string, (e: FeedEvent) => boolean][] = [
  ['All', () => true],
  ['Files', (e) => e.kind.startsWith('file.')],
  ['Agents', (e) => e.actorType === 'agent'],
  ['Git', (e) => e.kind === 'git.commit' || e.kind === 'agent.merge'],
  ['Runs', (e) => e.kind.startsWith('run.')],
  ['People', (e) => e.kind.startsWith('member.')]
]

/** Timeline of every change by every person and agent. */
export function FeedPanel() {
  const feed = useStore((s) => s.feed)
  const [filter, setFilter] = useState(0)
  const [, tick] = useState(0)
  useEffect(() => {
    useStore.getState().set({ unread: 0 })
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])
  const list = feed.filter(FILTERS[filter][1])

  const open = (ev: FeedEvent) => {
    const s = useStore.getState()
    if (ev.diff) s.openTab({ id: `feed:${ev.id}`, kind: 'diff', title: `${ev.actor}: ${ev.files[0] ?? ev.kind}`, path: ev.files[0] ?? 'change.diff', original: '', modified: ev.diff })
    else if (ev.files[0] && ev.kind !== 'file.deleted') s.openFile(ev.files[ev.kind === 'file.renamed' ? 1 : 0])
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center px-3">
        <span className="pane-title flex-1">History</span>
        <span className="text-[11px] text-muted">{list.length} events</span>
      </div>
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {FILTERS.map(([name], i) => (
          <button key={name} onClick={() => setFilter(i)} className={`rounded-full px-2 py-0.5 text-[11px] ${filter === i ? 'bg-accent text-accent-fg' : 'bg-panel2 text-muted'}`}>
            {name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-6">
        {list.length === 0 && <div className="p-2 text-muted">Nothing yet. Every edit, commit, agent merge and run shows up here.</div>}
        {list.map((ev) => (
          <button key={ev.id} onClick={() => open(ev)} className="mb-1 block w-full rounded-md px-2 py-1.5 text-left hover:bg-panel2">
            <div className="flex items-start gap-2">
              <span className="flex w-4 justify-center pt-0.5"><FeedIcon kind={ev.kind} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <b className={ev.actorType === 'agent' ? 'text-accent' : ''}>{ev.actor}</b> {ev.summary}
                </div>
                <div className="text-[10.5px] text-muted">
                  {timeAgo(ev.at)}
                  {ev.syncedLate && <span className="ml-1 rounded bg-warn/15 px-1 text-warn">synced late</span>}
                  {ev.files.length > 1 && ev.kind !== 'file.renamed' && ` · ${ev.files.length} files`}
                </div>
                {ev.diff && (
                  <pre className="mt-1 max-h-20 overflow-hidden rounded bg-bg p-1 font-mono text-[10px] leading-tight">
                    {ev.diff
                      .split('\n')
                      .filter((l) => /^[+-][^+-]/.test(l))
                      .slice(0, 6)
                      .map((l, i) => (
                        <div key={i} className={l.startsWith('+') ? 'text-ok' : 'text-bad'}>
                          {l.slice(0, 80)}
                        </div>
                      ))}
                  </pre>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Bot, Boxes, Code2, Files, GitBranch, History, MessageSquare, MessagesSquare, Moon, Play, RotateCw, Search, Square, Sun, Users } from 'lucide-react'
import { useStore, type Page } from '../store'
import { invoke, on } from '../lib/api'
import { closeProject, newProjectFlow, openFolderFlow, openPreview, refreshModels, runProject } from '../lib/actions'
import { Explorer } from '../components/Explorer'
import { SearchPanel } from '../components/SearchPanel'
import { GitPanel } from '../components/GitPanel'
import { EditorArea } from '../components/EditorArea'
import { TerminalPanel } from '../components/TerminalPanel'
import { ChatPanel } from '../panels/ChatPanel'
import { AgentsPanel } from '../panels/AgentsPanel'
import { FeedPanel } from '../panels/FeedPanel'
import { TeamPanel } from '../panels/TeamPanel'
import { ChatRoom } from './ChatRoom'
import { LiveGrid } from '../components/LiveGrid'
import { ModelStore } from './ModelStore'
import icon from '../assets/icon.png'
import { Avatar } from '../components/Avatar'

export function Workspace() {
  const s = useStore()
  // Sized to the window: fixed 260 + 380 px panels left a 1024 px window with a sliver of editor, a wrapped top bar
  // and a scrolling tab strip; a 240 px terminal hid half the Models list and the Planning room.
  const [sideW, setSideW] = useState(() => clamp(Math.round(window.innerWidth * 0.17), 190, 260))
  const [rightW, setRightW] = useState(() => clamp(Math.round(window.innerWidth * 0.26), 290, 380))
  const [bottomH, setBottomH] = useState(() => clamp(Math.round(window.innerHeight * 0.2), 120, 200))
  useEffect(() => {
    // keep at least ~440 px for the editor when the window shrinks
    const fit = () => {
      const spare = window.innerWidth - 88 - 440
      setSideW((w) => Math.max(160, Math.min(w, Math.round(spare * 0.4))))
      setRightW((w) => Math.max(260, Math.min(w, Math.round(spare * 0.6))))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    const off = on('menu:action', ({ action }) => {
      const st = useStore.getState()
      if (action === 'run') runProject()
      else if (action === 'stop') invoke('run:stop')
      else if (action === 'openFolder') openFolderFlow()
      else if (action === 'newProject') newProjectFlow()
      else if (action === 'search') st.set({ side: 'search' })
      else if (action === 'toggleTerminal') st.set({ bottomOpen: !st.bottomOpen })
      else if (action === 'save') window.dispatchEvent(new CustomEvent('hive:saveAll'))
    })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault()
        if (e.shiftKey) invoke('run:stop')
        else runProject()
      }
    }
    window.addEventListener('keydown', key)
    // Ollama can be slow to answer right after launch; keep the model list fresh.
    refreshModels()
    const poll = setInterval(() => document.hasFocus() && refreshModels(), 20000)
    return () => {
      clearInterval(poll)
      off()
      window.removeEventListener('keydown', key)
    }
  }, [])

  const pendingApprovals = s.approvals.length
  const activeRuns = s.runs.filter((r) => ['planning', 'working', 'merging', 'awaiting-plan-approval', 'awaiting-merge-approval'].includes(r.phase)).length
  const go = (page: Page) => s.set({ page, unread: page === 'history' ? 0 : s.unread })

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* One rail, one page at a time: every part of Hive is a click away and no page carries another's job. */}
        <nav className="rail" aria-label="Pages">
          <img src={icon} alt="Hive" className="mb-3 h-7 w-7" />
          <RailItem icon={<Code2 />} label="Code" page="code" current={s.page} go={go} />
          <RailItem icon={<MessagesSquare />} label="Chat" page="chat" current={s.page} go={go} />
          <RailItem icon={<Bot />} label="AI team" page="team" current={s.page} go={go} badge={pendingApprovals || activeRuns} />
          <RailItem icon={<Boxes />} label="Models" page="models" current={s.page} go={go} />
          <RailItem icon={<History />} label="History" page="history" current={s.page} go={go} badge={s.unread} />
          <RailItem icon={<Users />} label="People" page="people" current={s.page} go={go} />
          <div className="flex-1" />
          <button
            className="rail-item"
            aria-label="Switch light or dark"
            title="Switch light or dark"
            onClick={async () => s.set({ settings: await invoke('settings:set', { theme: s.settings?.theme === 'dark' ? 'light' : 'dark' }) })}
          >
            {s.settings?.theme === 'dark' ? <Sun /> : <Moon />}
          </button>
        </nav>

        {s.page === 'code' && (
          <>
            {s.side && (
              <>
                <div className="flex min-w-0 flex-col border-r border-line bg-panel" style={{ width: sideW }}>
                  <div className="flex shrink-0 gap-1 border-b border-line px-2 pt-2" role="tablist" aria-label="Side panel">
                    <SideTab label="Files" icon={<Files size={14} />} on={s.side === 'explorer'} pick={() => s.set({ side: 'explorer' })} />
                    <SideTab label="Search" icon={<Search size={14} />} on={s.side === 'search'} pick={() => s.set({ side: 'search' })} />
                    <SideTab label="Git" icon={<GitBranch size={14} />} on={s.side === 'git'} pick={() => s.set({ side: 'git' })} />
                  </div>
                  {s.side === 'explorer' && <Explorer />}
                  {s.side === 'search' && <SearchPanel />}
                  {s.side === 'git' && <GitPanel />}
                </div>
                <Resizer dir="x" onDrag={(d) => setSideW((w) => clamp(w + d, 160, 600))} />
              </>
            )}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <TopBar />
              <div className="editor-pane-host min-h-0 flex-1">{s.codeView === 'live' ? <LiveGrid /> : <EditorArea />}</div>
              {s.bottomOpen && (
                <>
                  <Resizer dir="y" onDrag={(d) => setBottomH((h) => clamp(h - d, 100, 700))} />
                  <div className="shrink-0 overflow-hidden border-t border-line" style={{ height: bottomH }}>
                    <TerminalPanel />
                  </div>
                </>
              )}
            </div>

            {s.right === 'chat' && (
              <>
                <Resizer dir="x" onDrag={(d) => setRightW((w) => clamp(w - d, 280, 800))} />
                <div className="flex min-w-0 flex-col border-l border-line bg-panel" style={{ width: rightW }}>
                  <ChatPanel />
                </div>
              </>
            )}
          </>
        )}
        {s.page === 'chat' && (
          <div className="editor-pane-host min-w-0 flex-1">
            <ChatRoom />
          </div>
        )}
        {s.page === 'team' && <FullPage title="AI team"><AgentsPanel /></FullPage>}
        {s.page === 'models' && (
          <div className="min-w-0 flex-1 overflow-hidden">
            <ModelStore />
          </div>
        )}
        {s.page === 'history' && <FullPage title="History"><FeedPanel /></FullPage>}
        {s.page === 'people' && <FullPage title="People"><TeamPanel /></FullPage>}
      </div>
      <StatusBar />
    </div>
  )
}

function RailItem({ icon, label, page, current, go, badge }: { icon: React.ReactNode; label: string; page: Page; current: Page; go: (p: Page) => void; badge?: number }) {
  const on = page === current
  return (
    <button className="rail-item" aria-current={on ? 'page' : undefined} onClick={() => go(page)}>
      {icon}
      <span className="rail-label">{label}</span>
      {!!badge && <span className="rail-badge">{badge}</span>}
    </button>
  )
}

function SideTab({ label, icon, on, pick }: { label: string; icon: React.ReactNode; on: boolean; pick: () => void }) {
  return (
    <button role="tab" aria-selected={on} onClick={pick} className={`-mb-px flex items-center gap-1.5 border-b-2 px-2 pb-1.5 text-[12px] font-semibold ${on ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
      {icon}
      {label}
    </button>
  )
}

/** A page that is one panel: a bold heading and the panel, at a readable width. */
function FullPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 overflow-auto bg-bg">
      <div className="mx-auto flex h-full max-w-[880px] flex-col px-8 pt-8">
        <h1 className="display mb-4 text-[30px] leading-none">{title}</h1>
        <div className="full-page min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

function TopBar() {
  const run = useStore((s) => s.run)
  const root = useStore((s) => s.root)!
  const running = run.status === 'running'
  const settings = useStore((s) => s.settings)
  const safe = settings?.safeRun
  const askOpen = useStore((s) => s.right === 'chat')
  const codeView = useStore((s) => s.codeView)
  const liveCount = useStore((s) => s.live.length)
  const setSafe = async (patch: Partial<NonNullable<typeof safe>>) =>
    useStore.setState({ settings: await invoke('settings:set', { safeRun: { on: false, ...safe, ...patch } }) })
  return (
    <div className="flex h-10 items-center gap-2 border-b border-line bg-panel px-3">
      <button className="display min-w-0 truncate rounded-md px-1 text-[14px] font-semibold text-fg hover:bg-panel2" onClick={closeProject} title={`${root} (click to close this project)`}>
        {root.split(/[\\/]/).pop()}
      </button>
      <div className="seg shrink-0" role="group" aria-label="Code view">
        <button aria-pressed={codeView === 'live'} onClick={() => useStore.getState().set({ codeView: 'live' })} title="Every file the AI team is writing, with their cursors">
          Live{liveCount ? ` (${liveCount})` : ''}
        </button>
        <button aria-pressed={codeView === 'files'} onClick={() => useStore.getState().set({ codeView: 'files' })} title="Your files and tabs">
          Files
        </button>
      </div>
      <div className="min-w-2 flex-1" />
      {run.previewUrl && (
        <button className="btn" onClick={() => openPreview(run.previewUrl!)}>
          Preview
        </button>
      )}
      <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] text-muted" title="Safe mode: Node programs can only touch this project's files, can't start other programs, and get no network. Every program stops after 10 minutes. Applies from the next Run.">
        <input type="checkbox" checked={!!safe?.on} onChange={(e) => setSafe({ on: e.target.checked })} /> Safe mode
      </label>
      {safe?.on && (
        <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] text-muted" title="Let programs use the network while safe mode is on (needed for servers and online APIs).">
          <input type="checkbox" checked={!!safe.allowNetwork} onChange={(e) => setSafe({ allowNetwork: e.target.checked })} /> Network
        </label>
      )}
      <button className={askOpen ? 'btn border-accent text-fg' : 'btn'} aria-pressed={askOpen} onClick={() => useStore.getState().set({ right: askOpen ? null : 'chat' })} title="Ask AI about this code">
        <MessageSquare size={13} /> Ask AI
      </button>
      {running ? (
        <>
          <button className="btn" onClick={() => invoke('run:restart')} title="Restart">
            <RotateCw size={13} /> Restart
          </button>
          <button className="btn" onClick={() => invoke('run:stop')} title="Stop (Shift+F5)">
            <Square size={13} className="text-bad" /> Stop
          </button>
        </>
      ) : (
        <button className="btn-primary" onClick={runProject} title="Run (F5)">
          <Play size={13} /> Run
        </button>
      )}
    </div>
  )
}

function StatusBar() {
  const s = useStore()
  const statusText =
    s.collabStatus === 'solo' ? 'Solo' : s.collabStatus === 'online' ? `Live · ${s.members.filter((m) => m.online).length} online` : s.collabStatus === 'connecting' ? 'Connecting…' : s.collabStatus === 'offline' ? 'Offline — changes will sync' : 'Sync error'
  const dot = s.collabStatus === 'online' ? 'bg-ok' : s.collabStatus === 'solo' ? 'bg-muted' : s.collabStatus === 'error' ? 'bg-bad' : 'bg-warn'
  return (
    <div className="flex h-7 items-center gap-4 border-t border-line bg-panel px-3 text-[11.5px] text-muted">
      <button className="flex items-center gap-1.5 hover:text-fg" onClick={() => s.set({ page: 'people' })} title={s.collabError}>
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {statusText}
      </button>
      <span>
        Run: <span className={s.run.status === 'running' ? 'text-ok' : s.run.status === 'failed' ? 'text-bad' : ''}>{s.run.status}</span>
      </span>
      <span>{s.models.length} model{s.models.length === 1 ? '' : 's'}</span>
      {Object.values(s.pulls).filter((p) => p.state === 'downloading').map((p) => (
        <span key={p.pullName}>
          ↓ {p.pullName} {p.total ? Math.round((p.completed / p.total) * 100) : 0}%
        </span>
      ))}
      <div className="flex-1" />
      <span className="flex items-center gap-1.5">
        <Avatar name={s.settings?.profile?.name} color={s.settings?.profile?.color} avatar={s.settings?.profile?.avatar} size={14} />
        {s.settings?.profile?.name}
      </span>
    </div>
  )
}

export function Resizer({ dir, onDrag }: { dir: 'x' | 'y'; onDrag: (delta: number) => void }) {
  return (
    <div
      className={`${dir === 'x' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'} shrink-0 bg-transparent hover:bg-accent/40`}
      onMouseDown={(e) => {
        e.preventDefault()
        let last = dir === 'x' ? e.clientX : e.clientY
        const move = (ev: MouseEvent) => {
          const cur = dir === 'x' ? ev.clientX : ev.clientY
          onDrag(cur - last)
          last = cur
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
    />
  )
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

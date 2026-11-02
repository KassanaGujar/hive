import { useEffect, useState } from 'react'
import { Bot, Boxes, Files, GitBranch, History, LayoutList, MessageSquare, Moon, Play, RotateCw, Search, Square, Sun, Users } from 'lucide-react'
import { useStore, type RightPanel, type SidePanel } from '../store'
import { invoke, on } from '../lib/api'
import { closeProject, newProjectFlow, openFolderFlow, openModelStore, openPlanning, openPreview, refreshModels, runProject } from '../lib/actions'
import { Explorer } from '../components/Explorer'
import { SearchPanel } from '../components/SearchPanel'
import { GitPanel } from '../components/GitPanel'
import { EditorArea } from '../components/EditorArea'
import { TerminalPanel } from '../components/TerminalPanel'
import { ChatPanel } from '../panels/ChatPanel'
import { AgentsPanel } from '../panels/AgentsPanel'
import { FeedPanel } from '../panels/FeedPanel'
import { TeamPanel } from '../panels/TeamPanel'

export function Workspace() {
  const s = useStore()
  const [sideW, setSideW] = useState(260)
  const [rightW, setRightW] = useState(380)
  const [bottomH, setBottomH] = useState(240)

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

  const toggleSide = (p: SidePanel) => s.set({ side: s.side === p ? null : p })
  const toggleRight = (p: RightPanel) => s.set({ right: s.right === p ? null : p, unread: p === 'changes' ? 0 : s.unread })
  const pendingApprovals = s.approvals.length
  const activeRuns = s.runs.filter((r) => ['planning', 'working', 'merging', 'awaiting-plan-approval', 'awaiting-merge-approval'].includes(r.phase)).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* activity bar */}
        <div className="flex w-11 flex-col items-center gap-1 border-r border-line bg-panel py-2">
          <Act icon={<Files size={18} />} label="Explorer" active={s.side === 'explorer'} onClick={() => toggleSide('explorer')} />
          <Act icon={<Search size={18} />} label="Search" active={s.side === 'search'} onClick={() => toggleSide('search')} />
          <Act icon={<GitBranch size={18} />} label="Git" active={s.side === 'git'} onClick={() => toggleSide('git')} />
          <Act icon={<Boxes size={18} />} label="Model store" onClick={openModelStore} />
          <Act icon={<LayoutList size={18} />} label="Planning room" onClick={openPlanning} />
          <div className="flex-1" />
          <Act
            icon={s.settings?.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            label="Toggle theme"
            onClick={async () => s.set({ settings: await invoke('settings:set', { theme: s.settings?.theme === 'dark' ? 'light' : 'dark' }) })}
          />
        </div>

        {s.side && (
          <>
            <div className="flex min-w-0 flex-col border-r border-line bg-panel" style={{ width: sideW }}>
              {s.side === 'explorer' && <Explorer />}
              {s.side === 'search' && <SearchPanel />}
              {s.side === 'git' && <GitPanel />}
            </div>
            <Resizer dir="x" onDrag={(d) => setSideW((w) => clamp(w + d, 160, 600))} />
          </>
        )}

        {/* centre */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="min-h-0 flex-1">
            <EditorArea />
          </div>
          {s.bottomOpen && (
            <>
              <Resizer dir="y" onDrag={(d) => setBottomH((h) => clamp(h - d, 100, 700))} />
              <div className="border-t border-line" style={{ height: bottomH }}>
                <TerminalPanel />
              </div>
            </>
          )}
        </div>

        {s.right && (
          <>
            <Resizer dir="x" onDrag={(d) => setRightW((w) => clamp(w - d, 280, 800))} />
            <div className="flex min-w-0 flex-col border-l border-line bg-panel" style={{ width: rightW }}>
              {s.right === 'chat' && <ChatPanel />}
              {s.right === 'agents' && <AgentsPanel />}
              {s.right === 'changes' && <FeedPanel />}
              {s.right === 'team' && <TeamPanel />}
            </div>
          </>
        )}
        <div className="flex w-11 flex-col items-center gap-1 border-l border-line bg-panel py-2">
          <Act icon={<MessageSquare size={18} />} label="AI chat" active={s.right === 'chat'} onClick={() => toggleRight('chat')} />
          <Act icon={<Bot size={18} />} label="Agents" active={s.right === 'agents'} badge={pendingApprovals || activeRuns || 0} onClick={() => toggleRight('agents')} />
          <Act icon={<History size={18} />} label="Changes" active={s.right === 'changes'} badge={s.unread} onClick={() => toggleRight('changes')} />
          <Act icon={<Users size={18} />} label="Team" active={s.right === 'team'} onClick={() => toggleRight('team')} />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}

function TopBar() {
  const run = useStore((s) => s.run)
  const root = useStore((s) => s.root)!
  const running = run.status === 'running'
  return (
    <div className="flex h-9 items-center gap-2 border-b border-line bg-panel px-2">
      <button className="btn-ghost text-[12px] font-semibold text-fg" onClick={closeProject} title="Close project">
        {root.split(/[\\/]/).pop()}
      </button>
      <div className="flex-1" />
      {run.previewUrl && (
        <button className="btn" onClick={() => openPreview(run.previewUrl!)}>
          Preview
        </button>
      )}
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
    <div className="flex h-6 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-muted">
      <button className="flex items-center gap-1.5 hover:text-fg" onClick={() => s.set({ right: 'team' })} title={s.collabError}>
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
      <span>
        {s.settings?.profile?.avatar} {s.settings?.profile?.name}
      </span>
    </div>
  )
}

function Act({ icon, label, active, onClick, badge }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; badge?: number }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`relative flex h-9 w-9 items-center justify-center rounded-md ${active ? 'bg-panel2 text-accent' : 'text-muted hover:text-fg'}`}
    >
      {icon}
      {!!badge && <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-[9px] font-bold text-accent-fg">{badge}</span>}
    </button>
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

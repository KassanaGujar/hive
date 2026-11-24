import { create } from 'zustand'
import type {
  AgentRun,
  ApprovalRequest,
  FeedEvent,
  FileNode,
  InstalledModel,
  PullProgress,
  RunState,
  Settings
} from '@hive/shared'
import type { MemberInfo } from '@hive/collab'

export type Tab =
  | { id: string; kind: 'file'; path: string; title: string }
  | {
      id: string
      kind: 'diff'
      title: string
      path: string
      original: string
      modified: string
      /** proposal = AI-suggested change with Accept/Reject buttons */
      proposal?: boolean
    }
  | { id: string; kind: 'preview'; title: string; url: string }
  | { id: string; kind: 'models'; title: string }
  | { id: string; kind: 'planning'; title: string }

export interface Group {
  tabs: string[]
  active: string | null
}

export type SidePanel = 'explorer' | 'search' | 'git'
export type RightPanel = 'chat' | 'agents' | 'changes' | 'team'
/** Top-level pages of a project, one job each (the rail on the left). */
export type Page = 'code' | 'chat' | 'team' | 'models' | 'history' | 'people'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'ok' | 'error'
  action?: { label: string; run: () => void }
}

interface State {
  settings: Settings | null
  root: string | null
  tree: FileNode[]
  tabs: Record<string, Tab>
  groups: Group[]
  focusedGroup: number
  dirty: Set<string>
  page: Page
  side: SidePanel | null
  right: RightPanel | null
  bottomOpen: boolean
  run: RunState
  models: InstalledModel[]
  pulls: Record<string, PullProgress>
  feed: FeedEvent[]
  unread: number
  runs: AgentRun[]
  approvals: ApprovalRequest[]
  members: MemberInfo[]
  collabStatus: 'solo' | 'connecting' | 'online' | 'offline' | 'error'
  collabError?: string
  toasts: Toast[]
  reveal: { path: string; line: number; col?: number; nonce: number } | null
  chatModel: string | null
  /** When set, the Explorer shows an agent's working folder instead of the project. */
  explorerRoot: { dir: string; label: string } | null
  /** Open files in the editor as agents write them. */
  followAgents: boolean
  ask: { title: string; initial: string; placeholder?: string; resolve: (v: string | null) => void } | null

  set: (patch: Partial<State>) => void
  openTab: (tab: Tab, group?: number) => void
  openFile: (path: string, at?: { line: number; col?: number }, group?: number) => void
  closeTab: (id: string) => void
  activate: (id: string, group: number) => void
  splitRight: () => void
  setDirty: (path: string, dirty: boolean) => void
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void
  dismissToast: (id: number) => void
  upsertRun: (run: AgentRun) => void
  addFeed: (ev: FeedEvent, countUnread?: boolean) => void
}

let toastId = 0

export const useStore = create<State>((set, get) => ({
  settings: null,
  root: null,
  tree: [],
  tabs: {},
  groups: [{ tabs: [], active: null }],
  focusedGroup: 0,
  dirty: new Set(),
  page: 'code',
  side: 'explorer',
  right: null,
  bottomOpen: true,
  run: { status: 'idle' },
  models: [],
  pulls: {},
  feed: [],
  unread: 0,
  runs: [],
  approvals: [],
  members: [],
  collabStatus: 'solo',
  toasts: [],
  reveal: null,
  chatModel: null,
  explorerRoot: null,
  followAgents: true,
  ask: null,

  set: (patch) => set(patch),

  openTab: (tab, group) => {
    const s = get()
    const gi = group ?? s.focusedGroup
    const groups = s.groups.map((g) => ({ ...g, tabs: [...g.tabs] }))
    // Already open somewhere? focus it there.
    const where = groups.findIndex((g) => g.tabs.includes(tab.id))
    if (where >= 0 && group === undefined) {
      groups[where].active = tab.id
      set({ tabs: { ...s.tabs, [tab.id]: tab }, groups, focusedGroup: where })
      return
    }
    const g = groups[Math.min(gi, groups.length - 1)]
    if (!g.tabs.includes(tab.id)) g.tabs.push(tab.id)
    g.active = tab.id
    set({ tabs: { ...s.tabs, [tab.id]: tab }, groups, focusedGroup: groups.indexOf(g) })
  },

  openFile: (path, at, group) => {
    const name = path.split('/').pop() ?? path
    // files inside an agent's working folder are labelled with the task they belong to
    const agentTask = /^\.hive\/worktrees\/[^/]+\/([^/]+)\//.exec(path)?.[1]
    const title = agentTask ? `${name} (${agentTask === '_integration' ? 'combined' : agentTask})` : name
    get().openTab({ id: `file:${path}`, kind: 'file', path, title }, group)
    if (at) set({ reveal: { path, line: at.line, col: at.col, nonce: Date.now() } })
  },

  closeTab: (id) => {
    const s = get()
    let groups = s.groups.map((g) => {
      if (!g.tabs.includes(id)) return g
      const idx = g.tabs.indexOf(id)
      const tabs = g.tabs.filter((t) => t !== id)
      return { tabs, active: g.active === id ? tabs[Math.min(idx, tabs.length - 1)] ?? null : g.active }
    })
    if (groups.length > 1) groups = groups.filter((g) => g.tabs.length > 0)
    if (groups.length === 0) groups = [{ tabs: [], active: null }]
    const stillOpen = groups.some((g) => g.tabs.includes(id))
    const tabs = { ...s.tabs }
    if (!stillOpen) delete tabs[id]
    set({ groups, tabs, focusedGroup: Math.min(s.focusedGroup, groups.length - 1) })
  },

  activate: (id, group) => {
    const groups = get().groups.map((g, i) => (i === group ? { ...g, active: id } : g))
    set({ groups, focusedGroup: group })
  },

  splitRight: () => {
    const s = get()
    if (s.groups.length >= 2) return
    const active = s.groups[s.focusedGroup].active
    set({ groups: [...s.groups, { tabs: active ? [active] : [], active }], focusedGroup: 1 })
  },

  setDirty: (path, dirty) => {
    // unchanged: keep the same Set so nothing re-renders (this runs on every keystroke)
    if (get().dirty.has(path) === dirty) return
    const d = new Set(get().dirty)
    if (dirty) d.add(path)
    else d.delete(path)
    set({ dirty: d })
  },

  toast: (text, kind = 'info', action) => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, kind, action }].slice(-5) })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  upsertRun: (run) => {
    const runs = get().runs.filter((r) => r.id !== run.id)
    set({ runs: [run, ...runs].sort((a, b) => b.createdAt - a.createdAt) })
  },

  addFeed: (ev, countUnread = false) => {
    const s = get()
    const i = s.feed.findIndex((f) => f.id === ev.id)
    const feed = i >= 0 ? s.feed.map((f) => (f.id === ev.id ? ev : f)) : [ev, ...s.feed]
    feed.sort((a, b) => b.at - a.at)
    set({ feed: feed.slice(0, 1000), unread: countUnread && i < 0 && s.page !== 'history' ? s.unread + 1 : s.unread })
  }
}))

export const actorName = () => useStore.getState().settings?.profile?.name ?? 'me'

/** In-app replacement for window.prompt (which Electron doesn't support). */
export function ask(title: string, initial = '', placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => useStore.getState().set({ ask: { title, initial, placeholder, resolve } }))
}

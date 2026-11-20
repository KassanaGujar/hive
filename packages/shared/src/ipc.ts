import type {
  AgentRun,
  ApprovalRequest,
  Catalog,
  ChatChunk,
  ChatMessage,
  FeedEvent,
  FileNode,
  GitCommit,
  GitStatus,
  Hardware,
  InstalledModel,
  CustomProvider,
  HfFile,
  HfModel,
  OpenRouterModel,
  PullProgress,
  RunState,
  SearchMatch,
  Settings,
  Tier,
  ToolSpec
} from './types'

/**
 * Every renderer → main call. Keys are IPC channels; values are the handler signature.
 * The preload bridge only exposes `invoke(channel, ...args)` for channels in this map.
 */
export interface IpcContract {
  // app / settings
  'app:info': () => { version: string; platform: string; userData: string }
  'settings:get': () => Settings
  'settings:set': (patch: Partial<Settings>) => Settings
  'secrets:set': (key: string, value: string) => void
  'secrets:has': (key: string) => boolean
  'secrets:delete': (key: string) => void
  'dialog:openFolder': () => string | null
  'shell:openExternal': (url: string) => void
  'shell:openPath': (absPath: string) => void
  'relay:startLocal': () => { port: number; urls: string[] }
  'relay:stopLocal': () => void
  'relay:status': () => { running: boolean; port?: number; urls: string[] }
  'notify': (title: string, body: string) => void
  'updater:check': () => { available: boolean; version?: string; error?: string }
  'updater:install': () => void

  // project / files
  'project:open': (dir: string) => { root: string; tree: FileNode[] }
  'project:create': (parentDir: string, name: string, opts?: { empty?: boolean }) => string
  'project:current': () => string | null
  /** Close the open project: stops its run and terminals and its file watcher. */
  'project:close': () => void
  /** Rename a project's folder; returns the new path. */
  'project:rename': (dir: string, newName: string) => string
  /** Move a project's folder to the Recycle Bin / Trash and forget it. */
  'project:delete': (dir: string) => void
  /** Drop a project from the recent list without touching its files. */
  'project:forget': (dir: string) => void
  'fs:tree': () => FileNode[]
  /** Tree of a sub-folder (e.g. an agent's working folder); paths stay relative to the project root. */
  'fs:treeAt': (rel: string) => FileNode[]
  'fs:read': (rel: string) => string
  'fs:write': (rel: string, content: string, actor?: string) => void
  'fs:create': (rel: string, type: 'file' | 'dir') => void
  'fs:rename': (from: string, to: string) => void
  'fs:delete': (rel: string) => void
  'fs:search': (query: string, opts?: { regex?: boolean; caseSensitive?: boolean }) => SearchMatch[]
  'fs:hashTree': () => Record<string, string>

  // terminals
  'term:create': (opts?: { cwd?: string; command?: string; title?: string }) => string
  'term:write': (id: string, data: string) => void
  'term:resize': (id: string, cols: number, rows: number) => void
  'term:kill': (id: string) => void

  // git
  'git:status': () => GitStatus
  'git:init': () => void
  'git:stage': (paths: string[]) => void
  'git:unstage': (paths: string[]) => void
  'git:commit': (message: string) => string
  'git:checkout': (branch: string, create?: boolean) => void
  'git:log': (limit?: number) => GitCommit[]
  'git:diff': (path?: string, staged?: boolean) => string
  'git:show': (rel: string, ref?: string) => string

  // run
  'run:start': (dir?: string) => RunState
  'run:stop': () => RunState
  'run:restart': () => RunState
  'run:state': () => RunState
  'run:preview': (url: string) => void

  // models
  'hw:scan': () => Hardware
  'catalog:get': () => Catalog
  'ollama:status': () => { installed: boolean; running: boolean; version?: string }
  'ollama:install': () => { ok: boolean; message: string }
  'ollama:start': () => boolean
  'ollama:pull': (pullName: string) => void
  'ollama:pause': (pullName: string) => void
  'ollama:cancel': (pullName: string) => void
  'ollama:delete': (pullName: string) => void
  'ollama:pulls': () => PullProgress[]
  'models:installed': () => InstalledModel[]
  'models:setTier': (id: string, tier: Tier | null) => void
  'models:testKey': (provider: string, key: string) => { ok: boolean; message: string }
  'models:cliAgents': () => { source: 'claude-code' | 'codex'; name: string; version: string | null; enabled: boolean; installUrl: string }[]
  'models:setCliAgent': (source: 'claude-code' | 'codex', on: boolean) => void
  'models:connectHosted': (catalogId: string, connected: boolean) => void
  /** Plain warning when a loaded local model is mostly on the processor (very slow), else null. */
  'models:offload': () => string | null
  // the big library (live)
  'library:searchHF': (query: string) => HfModel[]
  'library:hfFiles': (repo: string) => HfFile[]
  'library:openrouter': () => OpenRouterModel[]
  // your own keys (paid or self-hosted providers)
  'custom:list': () => CustomProvider[]
  'custom:save': (p: { id?: string; name: string; baseUrl: string; key?: string }) => { ok: boolean; message: string; id: string; models: string[] }
  'custom:models': (id: string) => string[]
  'custom:setModels': (id: string, models: string[]) => void
  'custom:remove': (id: string) => void
  /** Starts a streaming chat; chunks arrive on 'chat:chunk' with the returned stream id. */
  'chat:stream': (modelId: string, messages: ChatMessage[], tools?: ToolSpec[]) => string
  'chat:abort': (streamId: string) => void
  'chat:once': (modelId: string, messages: ChatMessage[]) => string

  // agents
  'agents:start': (goal: string, plan?: { title: string; description: string }[], prd?: string) => string
  'agents:runs': () => AgentRun[]
  'agents:approvePlan': (runId: string, approved: boolean) => void
  'agents:approveMerge': (runId: string, approved: boolean) => void
  'agents:approveCommand': (approvalId: string, approved: boolean) => void
  'agents:approvals': () => ApprovalRequest[]
  'agents:pause': (runId: string, agent: string) => void
  'agents:resume': (runId: string, agent: string) => void
  'agents:stop': (runId: string) => void
  'agents:resumeRun': (runId: string) => void
  'agents:reassign': (runId: string, taskId: string, modelId: string) => void
  'agents:takeOver': (runId: string, taskId: string) => { worktree: string }
  'agents:team': () => { architect?: InstalledModel; leads: InstalledModel[]; workers: InstalledModel[] }

  // setup
  'setup:git': () => { installed: boolean; version?: string }
  'setup:installGit': () => { ok: boolean; message: string }

  // feed (local history; shared feed lives in Yjs)
  'feed:list': (limit?: number) => FeedEvent[]
  'feed:add': (ev: FeedEvent) => void
}

/** Main → renderer push events. */
export interface IpcEvents {
  'fs:changed': { kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }
  'term:data': { id: string; data: string }
  'term:exit': { id: string; code: number }
  'run:state': RunState
  'ollama:progress': PullProgress
  'chat:chunk': { streamId: string; chunk: ChatChunk; error?: string }
  'agents:update': AgentRun
  'agents:log': { runId: string; agent: string; taskId?: string; line: string }
  /** An agent just wrote this file (path relative to the project root). */
  'agents:file': { runId: string; agent: string; taskId: string; path: string }
  'agents:approval': ApprovalRequest
  /** A loaded local model went mostly onto the processor (message) or back onto the GPU (null). */
  'models:offload': string | null
  'feed:event': FeedEvent
  'updater:ready': { version: string; manual?: boolean }
  'app:openInvite': { link: string }
  'menu:action': { action: string }
}

export type IpcChannel = keyof IpcContract
export type IpcEventName = keyof IpcEvents

export interface HiveBridge {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: Parameters<IpcContract[C]>
  ): Promise<Awaited<ReturnType<IpcContract[C]>>>
  on<E extends IpcEventName>(event: E, cb: (payload: IpcEvents[E]) => void): () => void
}

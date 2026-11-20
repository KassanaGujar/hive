// Shared domain types used by main, renderer, packages and the relay.

export type Tier = 'top' | 'lead' | 'worker'
export type ModelSource = 'ollama' | 'openrouter' | 'groq' | 'hf' | 'custom' | 'claude-code' | 'codex'
/** Sources that appear in the built-in free catalog. */
export type CatalogSource = Exclude<ModelSource, 'custom' | 'claude-code' | 'codex'>

export interface CatalogEntry {
  id: string
  name: string
  family: string
  source: ModelSource
  /** Ollama pull name, e.g. "qwen2.5-coder:7b" */
  pullName?: string
  /** Model id at a hosted endpoint, e.g. "qwen/qwen3-coder:free" */
  endpointModel?: string
  sizeGB: number
  minRamGB: number
  minVramGB: number
  contextTokens: number
  tier: Tier
  codingScore: number
  /** Required. Entries without free: true are ignored. */
  free: true
  keyUrl?: string
  description?: string
  /** Provider caps on the free tier, e.g. Groq tokens per minute. */
  limits?: ModelLimits
}

export interface Catalog {
  version: number
  updated: string
  providers: Record<Exclude<CatalogSource, 'ollama'>, HostedProvider>
  models: CatalogEntry[]
}

export interface HostedProvider {
  name: string
  baseUrl: string
  keyUrl: string
  /** Endpoint that lists models; used to test a pasted key. */
  testPath: string
}

export type FitLabel = 'runs-well' | 'slow' | 'too-big'

export interface Hardware {
  totalRamGB: number
  freeRamGB: number
  gpuName: string | null
  vramGB: number
  freeDiskGB: number
  cpuCores: number
  platform: NodeJS.Platform | string
}

/** A model the user can actually call right now. */
export interface InstalledModel {
  id: string // catalog id, or "ollama:<name>" for models not in the catalog
  name: string
  source: ModelSource
  model: string // name passed to the chat endpoint
  tier: Tier
  codingScore: number
  sizeGB: number
  minRamGB: number
  contextTokens: number
  limits?: ModelLimits
}

/** Provider caps for one model (Groq free tier: tokens per minute). Unknown = no cap. */
export interface ModelLimits {
  inputPerMinute?: number
  outputPerMinute?: number
  maxOutput?: number
}

export interface PullProgress {
  pullName: string
  status: string
  completed: number
  total: number
  state: 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'
  error?: string
}

/** A provider the user added with their own key (paid, or self-hosted). OpenAI-compatible. */
export interface CustomProvider {
  id: string
  name: string
  baseUrl: string
  /** model names the user switched on */
  models: string[]
}

export interface HfModel {
  id: string
  downloads: number
  likes: number
  gated: boolean
}

export interface HfFile {
  file: string
  quant: string
  sizeGB: number
  /** what Ollama pulls: hf.co/<repo>:<quant> */
  pullName: string
}

export interface OpenRouterModel {
  id: string
  name: string
  contextTokens: number
  /** US dollars per million tokens */
  priceIn: number
  priceOut: number
  free: boolean
}

// ---------- chat / model layer ----------

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: Role
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}

export interface ChatChunk {
  text?: string
  toolCalls?: ToolCall[]
  done?: boolean
  tokensPerSec?: number
}

// ---------- feed ----------

export type FeedKind =
  | 'file.created'
  | 'file.edited'
  | 'file.renamed'
  | 'file.deleted'
  | 'git.commit'
  | 'agent.merge'
  | 'agent.task'
  | 'run.started'
  | 'run.failed'
  | 'run.stopped'
  | 'member.joined'
  | 'member.left'
  | 'plan.updated'

export interface FeedEvent {
  id: string
  at: number
  actor: string
  actorType: 'person' | 'agent'
  kind: FeedKind
  files: string[]
  diffRef?: string
  /** Short unified diff preview (truncated). */
  diff?: string
  summary: string
  syncedLate?: boolean
}

// ---------- agents ----------

export type AgentRole = 'architect' | 'lead' | 'worker'

export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'review'
  | 'changes-requested'
  | 'approved'
  | 'merged'
  | 'failed'
  | 'blocked'
  | 'cancelled'

export interface PlanTask {
  id: string
  title: string
  description: string
  files: string[]
  dependsOn: string[]
  owner?: string // agent name
  acceptance?: string
}

export interface AgentPlan {
  goal: string
  summary: string
  tasks: PlanTask[]
}

export interface AgentTask extends PlanTask {
  runId: string
  status: TaskStatus
  attempts: number
  branch?: string
  worktree?: string
  model?: string
  reviewNotes?: string
  diff?: string
  log: string[]
  /** The router's size estimate (small / medium / large) and the tokens it expects the task to write. */
  size?: 'small' | 'medium' | 'large'
  estimate?: number
}

export interface AgentInfo {
  name: string
  role: AgentRole
  modelId: string
  modelName: string
  status: 'idle' | 'thinking' | 'working' | 'waiting' | 'paused' | 'stopped'
  currentTaskId?: string
  tokensPerSec?: number
}

export type RunPhase =
  | 'planning'
  | 'awaiting-plan-approval'
  | 'working'
  | 'merging'
  | 'awaiting-merge-approval'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface AgentRun {
  id: string
  goal: string
  phase: RunPhase
  plan?: AgentPlan
  tasks: AgentTask[]
  agents: AgentInfo[]
  baseBranch: string
  integrationBranch?: string
  /** Folder (relative to the project) holding the combined result so far — runnable before merging. */
  previewDir?: string
  error?: string
  createdAt: number
}

export interface ApprovalRequest {
  id: string
  runId: string
  agent: string
  taskId: string
  command: string
  reason: string
}

// ---------- run code ----------

export interface RunConfig {
  kind: string
  command: string
  cwd: string
  env?: Record<string, string>
  port?: number
  /** For static html: served by Hive's built-in server */
  staticDir?: string
  requires?: { tool: string; downloadUrl: string }
}

export interface RunState {
  status: 'idle' | 'running' | 'exited' | 'failed'
  config?: RunConfig
  terminalId?: string
  previewUrl?: string
  exitCode?: number
  message?: string
}

// ---------- git ----------

export interface GitStatus {
  isRepo: boolean
  branch: string
  branches: string[]
  files: { path: string; index: string; workingDir: string }[]
  ahead: number
  behind: number
}

export interface GitCommit {
  hash: string
  date: string
  message: string
  author: string
}

// ---------- files ----------

export interface FileNode {
  name: string
  path: string // relative, forward slashes
  type: 'file' | 'dir'
  children?: FileNode[]
}

export interface SearchMatch {
  path: string
  line: number
  col: number
  text: string
}

// ---------- settings ----------

export interface Profile {
  name: string
  avatar: string // emoji
  color: string
}

export interface Settings {
  profile: Profile | null
  theme: 'dark' | 'light'
  setupComplete: boolean
  recentProjects: string[]
  tierOverrides: Record<string, Tier>
  relayUrl: string
  catalogUrl: string
  autosave: boolean
  /** Coding-agent CLIs (Claude Code, Codex) the user turned on, so Hive can use their own subscription. */
  cliAgents?: string[]
}

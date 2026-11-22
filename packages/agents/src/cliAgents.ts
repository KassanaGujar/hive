import type { AgentTask, ChatMessage, ModelSource } from '@hive/shared'

/**
 * Coding-agent CLIs the user already pays for (Claude Code, Codex). Hive runs the official CLI in the task's
 * worktree and the CLI signs in with the user's own subscription. Hive never sees or stores a token, and no free
 * daily quota applies. The CLI is a whole agent with its own tools, so it does a task in one call instead of
 * Hive's tool loop; Hive still owns the plan, the worktree, the checks and the merge.
 */
export type CliSource = Extract<ModelSource, 'claude-code' | 'codex'>

export const CLI_SOURCES: CliSource[] = ['claude-code', 'codex']
export const isCliSource = (s: string): s is CliSource => (CLI_SOURCES as string[]).includes(s)

export interface CliInvocation {
  command: string
  args: string[]
  /** Sent on stdin: long prompts break Windows command lines. */
  input: string
}

export type CliMode = 'task' | 'ask' | 'look'

/**
 * Which model a call uses. '' = the account's default. 'auto' (Claude Code) sizes it to the job so small calls don't
 * spend a big model's usage: planning and other no-tool questions on Haiku, building and play-testing on Sonnet.
 * Anything else (haiku, sonnet, opus or a full model id) is passed through.
 */
export function resolveCliModel(source: CliSource, mode: CliMode, model?: string): string | undefined {
  if (!model) return undefined
  if (model !== 'auto') return model
  if (source !== 'claude-code') return undefined
  return mode === 'ask' ? 'haiku' : 'sonnet'
}

/**
 * The command that runs one task (mode "task": may edit files in cwd), answers one prompt (mode "ask": no tools), or
 * looks at files in cwd such as screenshots (mode "look": Read only). None can run shell commands: Hive runs the
 * checks itself after the agent stops.
 */
export function cliInvocation(source: CliSource, mode: CliMode, prompt: string, model?: string): CliInvocation {
  const use = resolveCliModel(source, mode, model)
  if (source === 'claude-code') {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'project']
    if (mode === 'task') args.push('--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep', '--disallowedTools', 'Bash,WebFetch,WebSearch')
    else if (mode === 'look') args.push('--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,Glob,Grep,WebFetch,WebSearch')
    else args.push('--disallowedTools', 'Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch')
    if (use) args.push('--model', use)
    return { command: 'claude', args, input: prompt }
  }
  // codex exec: "-" reads the prompt from stdin; workspace-write keeps edits inside the worktree.
  const args = ['exec', '--skip-git-repo-check', '--sandbox', mode === 'task' ? 'workspace-write' : 'read-only', '--json']
  if (use) args.push('--model', use)
  args.push('-')
  return { command: 'codex', args, input: prompt }
}

export interface CliOutcome {
  ok: boolean
  /** The agent's final message (a task summary, or the answer). */
  text: string
  error?: string
  costUsd?: number
}

/** Read what the CLI printed. Claude Code prints one JSON result; Codex prints JSON lines, the last agent message wins. */
export function parseCliOutput(source: CliSource, code: number, stdout: string, stderr: string): CliOutcome {
  if (source === 'claude-code') {
    const line = stdout.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'))
    let j: { is_error?: boolean; result?: unknown; subtype?: string; total_cost_usd?: number } | null = null
    try {
      j = line ? JSON.parse(line) : null
    } catch {
      j = null
    }
    if (!j) return { ok: false, text: '', error: firstLine(stderr || stdout) || `claude exited with code ${code}` }
    const text = typeof j.result === 'string' ? j.result : ''
    if (j.is_error || code !== 0) return { ok: false, text, error: text || j.subtype || `claude exited with code ${code}`, costUsd: j.total_cost_usd }
    return { ok: true, text, costUsd: j.total_cost_usd }
  }
  let text = ''
  let error: string | undefined
  for (const l of stdout.split(/\r?\n/)) {
    if (!l.trim().startsWith('{')) continue
    try {
      const ev = JSON.parse(l)
      const item = ev.item ?? ev.msg ?? ev
      if ((item.type === 'agent_message' || item.item_type === 'agent_message' || item.type === 'assistant_message') && typeof (item.text ?? item.message) === 'string') text = item.text ?? item.message
      if (ev.type === 'error' || item.type === 'error') error = String(item.message ?? ev.message ?? 'codex error')
    } catch {
      /* not JSON */
    }
  }
  if (code !== 0 || error) return { ok: false, text, error: error ?? (firstLine(stderr) || `codex exited with code ${code}`) }
  return { ok: true, text }
}

/** Errors that mean the subscription itself is used up or signed out: move to another model, like a free quota. */
export function cliErrorKind(error: string): 'quota' | 'signed-out' | null {
  if (/usage limit|rate.?limit|limit reached|quota|too many requests|429/i.test(error)) return 'quota'
  if (/not (logged|signed) in|login|authenticat|unauthori[sz]ed|401|invalid api key/i.test(error)) return 'signed-out'
  return null
}

const firstLine = (s: string) => s.trim().split(/\r?\n/)[0]?.slice(0, 300) ?? ''

/** The brief for one task. File ownership is enforced afterwards too: edits to other files are undone. */
export function cliTaskPrompt(task: Pick<AgentTask, 'title' | 'description' | 'files'>, notes?: string, prd?: string): string {
  const files = task.files.length ? task.files.join(', ') : '(choose sensible file names)'
  return [
    `You are one worker on a team building a project. Do this one task in the current directory, then stop.`,
    ``,
    `Task: ${task.title}`,
    task.description,
    ``,
    `Files you own: ${files}`,
    `Only create or edit these files. Other workers own the rest; changes to any other file are thrown away.`,
    `Write complete, working code (no placeholders or TODOs). Do not run shell commands: Hive runs the project checks after you finish.`,
    notes ? `\nThe last attempt was sent back. Fix this:\n${notes}` : '',
    prd ? `\nProject plan for context:\n${prd.slice(0, 8000)}` : '',
    `\nWhen done, reply with a one-paragraph summary of what you wrote.`
  ].join('\n')
}

/** Planning and review calls as one prompt: CLIs take a single message, not a chat history. */
export function flattenMessages(messages: ChatMessage[]): string {
  return messages.map((m) => (m.role === 'system' ? m.content : `${m.role.toUpperCase()}:\n${m.content}`)).join('\n\n')
}

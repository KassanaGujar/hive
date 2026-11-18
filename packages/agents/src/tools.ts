import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ToolSpec } from '@hive/shared'

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'list_files',
    description: 'List files in the project (recursive, skips node_modules/.git).',
    parameters: { type: 'object', properties: { dir: { type: 'string', description: 'folder, default "."' } } }
  },
  {
    name: 'read_file',
    description: 'Read a text file.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the full new content. Creates folders as needed.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Change part of an existing file: replaces the exact text "find" (must appear once) with "replace". Use this instead of rewriting a whole file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, find: { type: 'string', description: 'exact text copied from the file' }, replace: { type: 'string' } },
      required: ['path', 'find', 'replace']
    }
  },
  {
    name: 'search',
    description: 'Search file contents for a plain-text query. Returns path:line: text.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the project folder (PowerShell on Windows, bash elsewhere). 5 minute timeout. Risky commands wait for the user to approve.',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
  },
  {
    name: 'report_done',
    description: 'Call when the task is finished. Give a short summary of what you built.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }
  }
]

const SKIP = new Set(['node_modules', '.git', '.hive', 'dist', 'out', 'build', '__pycache__', '.venv', 'target'])

/** Resolve a model-supplied path and refuse anything that escapes the root. */
export function safeResolve(root: string, rel: string): string {
  const cleaned = String(rel ?? '').replace(/^[/\\]+/, '')
  const abs = path.resolve(root, cleaned || '.')
  const r = path.resolve(root)
  if (abs !== r && !abs.startsWith(r + path.sep)) throw new Error(`Path "${rel}" is outside the project folder`)
  return abs
}

export async function listFiles(root: string, dir = '.', limit = 400): Promise<string[]> {
  const out: string[] = []
  const start = safeResolve(root, dir)
  async function walk(abs: string) {
    if (out.length >= limit) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const p = path.join(abs, e.name)
      if (e.isDirectory()) await walk(p)
      else out.push(path.relative(root, p).replace(/\\/g, '/'))
      if (out.length >= limit) return
    }
  }
  await walk(start)
  return out.sort()
}

export async function searchFiles(root: string, query: string, limit = 60): Promise<string[]> {
  const files = await listFiles(root, '.', 2000)
  const hits: string[] = []
  for (const f of files) {
    let text: string
    try {
      const abs = safeResolve(root, f)
      const st = await fs.stat(abs)
      if (st.size > 500_000) continue
      text = await fs.readFile(abs, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(query)) {
        hits.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}

export interface ToolContext {
  root: string
  runCommand(command: string): Promise<string>
  onWrite?(rel: string): void
  /** The task's only file, used when a model forgets to say which file it is writing. */
  defaultPath?: string
  /** Files this task owns; writes elsewhere are refused (other agents own them). Empty = any. */
  allowedPaths?: string[]
}

const PATH_KEYS = ['path', 'file', 'filename', 'file_path', 'filepath', 'file_name', 'name', 'f', 'target']
const CONTENT_KEYS = ['content', 'contents', 'text', 'code', 'data', 'body', 'source', 'file_content', 'file_contents', 's', 'html', 'css', 'js', 'javascript', 'value']

/** Small models vary argument names ({"file": …, "code": …}); map them to path/content. */
export function normalizeWriteArgs(args: Record<string, any>, defaultPath?: string): { path?: string; content?: string } {
  const pick = (keys: string[]) => keys.map((k) => args?.[k]).find((v) => typeof v === 'string' && v.length > 0)
  let content = pick(CONTENT_KEYS)
  const p = PATH_KEYS.map((k) => args?.[k]).find((v) => typeof v === 'string' && v.length > 0 && v.length < 260 && v !== content)
  if (typeof content === 'string') content = stripFence(content)
  // "./", ".", "src/" and the like name a folder, not a file
  const usable = p && !/^\.?\/?$/.test(p.trim()) && !/[\\/]$/.test(p.trim()) ? p.trim().replace(/^\.\//, '') : undefined
  return { path: usable ?? defaultPath, content }
}

/** A model sometimes wraps file content in a markdown fence or a <script> wrapper meant for chat. */
function stripFence(s: string): string {
  const m = /^\s*```[\w.-]*\s*\n([\s\S]*?)\n?```\s*$/.exec(s)
  return m ? m[1] : s
}

export interface ToolResult {
  output: string
  done?: { summary: string }
}

/** Writes are limited to the task's own files; other agents own the rest. Returns the refusal, or null. */
function notOwned(ctx: ToolContext, p: string): string | null {
  const norm = (f: string) => f.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase()
  if (!ctx.allowedPaths?.length || ctx.allowedPaths.some((a) => norm(a) === norm(p))) return null
  return `Error: you only own ${ctx.allowedPaths.join(', ')}. ${p} belongs to another agent — do not write it. Write ${ctx.allowedPaths[0]} instead.`
}

export async function executeTool(ctx: ToolContext, name: string, args: Record<string, any>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'list_files': {
        const files = await listFiles(ctx.root, args.dir ?? '.')
        return { output: files.join('\n') || '(no files)' }
      }
      case 'read_file': {
        const text = await fs.readFile(safeResolve(ctx.root, args.path), 'utf8')
        return { output: text.length > 30000 ? text.slice(0, 30000) + '\n…(truncated)' : text }
      }
      case 'write_file': {
        const w = normalizeWriteArgs(args, ctx.defaultPath)
        if (typeof w.content !== 'string') return { output: 'Error: write_file needs "path" and "content" (the full file text)' }
        if (!w.path) return { output: 'Error: write_file needs "path" (which file to write)' }
        const refused = notOwned(ctx, w.path)
        if (refused) return { output: refused }
        const abs = safeResolve(ctx.root, w.path)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, w.content, 'utf8')
        ctx.onWrite?.(w.path)
        return { output: `Wrote ${w.path} (${w.content.length} chars)` }
      }
      case 'edit_file': {
        const p = typeof args.path === 'string' && args.path.trim() ? args.path.trim().replace(/^\.\//, '') : ctx.defaultPath
        const find = typeof args.find === 'string' ? args.find : ''
        const replace = typeof args.replace === 'string' ? args.replace : ''
        if (!p || !find) return { output: 'Error: edit_file needs "path", "find" (exact text from the file) and "replace"' }
        const refused = notOwned(ctx, p)
        if (refused) return { output: refused }
        const abs = safeResolve(ctx.root, p)
        const text = await fs.readFile(abs, 'utf8')
        const count = text.split(find).length - 1
        if (count === 0) return { output: `Error: text not found in ${p}; read_file it and copy the exact text` }
        if (count > 1) return { output: `Error: text appears ${count} times in ${p}; include more surrounding lines so it matches once` }
        await fs.writeFile(abs, text.replace(find, () => replace), 'utf8')
        ctx.onWrite?.(p)
        return { output: `Edited ${p} (${find.length} → ${replace.length} chars)` }
      }
      case 'search': {
        const hits = await searchFiles(ctx.root, String(args.query ?? ''))
        return { output: hits.join('\n') || 'No matches' }
      }
      case 'run_command': {
        const out = await ctx.runCommand(String(args.command ?? ''))
        return { output: out.length > 12000 ? out.slice(-12000) : out }
      }
      case 'report_done':
        return { output: 'ok', done: { summary: String(args.summary ?? '') } }
      default:
        return { output: `Error: unknown tool "${name}"` }
    }
  } catch (e: any) {
    return { output: `Error: ${e?.message ?? e}` }
  }
}

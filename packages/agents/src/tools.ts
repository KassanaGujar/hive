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
}

export interface ToolResult {
  output: string
  done?: { summary: string }
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
        if (typeof args.content !== 'string') return { output: 'Error: content must be a string' }
        const abs = safeResolve(ctx.root, args.path)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, args.content, 'utf8')
        ctx.onWrite?.(String(args.path))
        return { output: `Wrote ${args.path} (${args.content.length} chars)` }
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

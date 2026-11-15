import { shell } from 'electron'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'chokidar'
import { IGNORED_DIRS } from '@hive/editor'
import type { FileNode, SearchMatch } from '@hive/shared'
import { toPosix } from '@hive/shared'
import { emit } from './ipc'
import { getSettings, setSettings } from './store'

let root: string | null = null
let watcher: FSWatcher | null = null
/** Content hashes of writes Hive itself made, so the watcher doesn't echo them back. */
const selfWrites = new Map<string, string>()

export const MAX_TREE_NODES = 20000

export function projectRoot(): string {
  if (!root) throw new Error('No project is open.')
  return root
}

export function currentProject() {
  return root
}

/** Resolve a project-relative path, refusing anything outside the project. */
export function abs(rel: string): string {
  const r = projectRoot()
  const p = path.resolve(r, rel.replace(/^[/\\]+/, ''))
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error(`"${rel}" is outside the project`)
  return p
}

const relOf = (p: string) => toPosix(path.relative(projectRoot(), p))
const hash = (s: string | Buffer) => createHash('sha1').update(s).digest('hex')

function ignored(p: string) {
  const parts = toPosix(p).split('/')
  return parts.some((x) => IGNORED_DIRS.has(x))
}

export async function openProject(dir: string) {
  const resolved = path.resolve(dir)
  const st = await fs.stat(resolved)
  if (!st.isDirectory()) throw new Error('Not a folder')
  root = resolved
  await watcher?.close()
  watcher = watch(resolved, {
    ignoreInitial: true,
    ignored: (p: string) => p !== resolved && ignored(path.relative(resolved, p)),
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 }
  })
  watcher.on('all', async (event, p) => {
    if (!root) return
    const rel = relOf(p)
    if (event === 'change' || event === 'add') {
      const mine = selfWrites.get(rel)
      if (mine) {
        try {
          if (hash(await fs.readFile(p)) === mine) return
        } catch {
          /* fall through */
        }
      }
    }
    emit('fs:changed', { kind: event as 'add', path: rel })
  })
  const recents = [resolved, ...getSettings().recentProjects.filter((x) => x !== resolved)].slice(0, 10)
  setSettings({ recentProjects: recents })
  return { root: resolved, tree: await tree() }
}

export async function createProject(parent: string, name: string, empty = false) {
  const safe = name.trim().replace(/[<>:"/\\|?*]+/g, '-') || 'my-project'
  const dir = path.join(parent, safe)
  if (existsSync(dir)) throw new Error(`A folder named "${safe}" already exists there.`)
  await fs.mkdir(dir, { recursive: true })
  if (!empty) await fs.writeFile(
    path.join(dir, 'README.md'),
    `# ${safe}\n\nMade with Hive. Open the Agents panel and describe what to build, or start coding.\n`
  )
  return dir
}

export async function closeProject() {
  await watcher?.close()
  watcher = null
  root = null
}

async function closeIfOpen(dir: string) {
  if (root && path.resolve(dir) === root) await closeProject()
}

/** Windows keeps a folder locked for a moment after the last process in it exits: retry briefly. */
async function retryBusy<T>(fn: () => Promise<T>, tries = 12): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= tries || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(code ?? '') && !/abort/i.test(String(e))) throw e
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

export function forgetProject(dir: string) {
  const resolved = path.resolve(dir)
  setSettings({ recentProjects: getSettings().recentProjects.filter((x) => path.resolve(x) !== resolved) })
}

export async function renameProject(dir: string, newName: string) {
  const from = path.resolve(dir)
  const safe = newName.trim().replace(/[<>:"/\\|?*]+/g, '-')
  if (!safe) throw new Error('Type a name for the project.')
  const to = path.join(path.dirname(from), safe)
  if (to === from) return from
  if (existsSync(to)) throw new Error(`A folder named "${safe}" already exists there.`)
  if (!existsSync(from)) throw new Error('That project folder no longer exists.')
  await closeIfOpen(from)
  try {
    await retryBusy(() => fs.rename(from, to))
  } catch (e) {
    throw new Error(`Couldn't rename the folder. Close anything using it (terminals, other apps) and try again. (${(e as NodeJS.ErrnoException).code ?? e})`)
  }
  setSettings({ recentProjects: getSettings().recentProjects.map((x) => (path.resolve(x) === from ? to : x)) })
  return to
}

export async function deleteProject(dir: string) {
  const resolved = path.resolve(dir)
  await closeIfOpen(resolved)
  if (existsSync(resolved)) {
    try {
      await retryBusy(() => shell.trashItem(resolved))
    } catch (e) {
      throw new Error(`Couldn't move the folder to the bin. Close anything using it and try again. (${(e as Error).message})`)
    }
  }
  forgetProject(resolved)
}

/** Tree of a sub-folder of the project (an agent's working folder). Paths stay project-relative. */
export async function treeAt(rel: string): Promise<FileNode[]> {
  return tree(abs(rel))
}

export async function tree(start?: string): Promise<FileNode[]> {
  const r = projectRoot()
  let count = 0
  async function walk(dir: string): Promise<FileNode[]> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    const out: FileNode[] = []
    for (const e of entries) {
      if (count++ > MAX_TREE_NODES) break
      if (e.name === '.hive' || e.name === '.git') continue // Hive/git internals
      const p = path.join(dir, e.name)
      const rel = toPosix(path.relative(r, p))
      if (e.isDirectory()) {
        // Ignored folders are shown but not expanded (node_modules can be huge).
        out.push({ name: e.name, path: rel, type: 'dir', children: IGNORED_DIRS.has(e.name) ? [] : await walk(p) })
      } else out.push({ name: e.name, path: rel, type: 'file' })
    }
    return out
  }
  return walk(start ?? r)
}

export async function readFile(rel: string) {
  const p = abs(rel)
  const st = await fs.stat(p)
  if (st.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB; open it in another app.')
  const buf = await fs.readFile(p)
  if (buf.subarray(0, 8000).includes(0)) throw new Error('Binary file')
  return buf.toString('utf8')
}

export async function writeFile(rel: string, content: string) {
  const p = abs(rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  selfWrites.set(toPosix(rel), hash(content))
  await fs.writeFile(p, content, 'utf8')
}

export async function create(rel: string, type: 'file' | 'dir') {
  const p = abs(rel)
  if (existsSync(p)) throw new Error(`${rel} already exists`)
  if (type === 'dir') await fs.mkdir(p, { recursive: true })
  else {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, '')
  }
}

export async function rename(from: string, to: string) {
  const dst = abs(to)
  if (existsSync(dst)) throw new Error(`${to} already exists`)
  await fs.mkdir(path.dirname(dst), { recursive: true })
  await fs.rename(abs(from), dst)
}

/** Deletes go to the OS recycle bin / trash. */
export async function remove(rel: string) {
  await shell.trashItem(abs(rel))
}

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|css|scss|less|html|htm|py|go|rs|java|c|h|cpp|hpp|cc|cs|rb|php|sh|ps1|yml|yaml|xml|sql|toml|ini|kt|swift|lua|dart|vue|svelte|env|gitignore)$/i

export async function listTextFiles(limit = 5000): Promise<string[]> {
  const r = projectRoot()
  const out: string[] = []
  async function walk(dir: string) {
    if (out.length >= limit) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (TEXT_EXT.test(e.name) || !e.name.includes('.')) out.push(toPosix(path.relative(r, p)))
      if (out.length >= limit) return
    }
  }
  await walk(r)
  return out
}

/** Run fn over items with at most `limit` in flight (file I/O is much faster in parallel). */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

async function readSmall(rel: string, max: number): Promise<string | null> {
  try {
    const p = abs(rel)
    const st = await fs.stat(p)
    if (st.size > max) return null
    return await fs.readFile(p, 'utf8')
  } catch {
    return null
  }
}

export async function search(query: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}): Promise<SearchMatch[]> {
  if (!query) return []
  const flags = opts.caseSensitive ? '' : 'i'
  const re = new RegExp(opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  const files = await listTextFiles()
  const perFile = await pool(files, 32, async (rel) => {
    const text = await readSmall(rel, 1024 * 1024)
    if (text === null || !re.test(text)) return []
    const hits: SearchMatch[] = []
    const lines = text.split('\n')
    for (let i = 0; i < lines.length && hits.length < 200; i++) {
      const m = re.exec(lines[i])
      if (m) hits.push({ path: rel, line: i + 1, col: m.index + 1, text: lines[i].slice(0, 300) })
    }
    return hits
  })
  return perFile.flat().slice(0, 2000)
}

/** sha256 of every shared text file; used for the join-time full-tree check. */
export async function hashTree(): Promise<Record<string, string>> {
  const files = await listTextFiles()
  const hashes = await pool(files, 32, async (rel) => {
    const text = await readSmall(rel, 512 * 1024)
    return text === null ? null : createHash('sha256').update(text).digest('hex')
  })
  const out: Record<string, string> = {}
  files.forEach((rel, i) => {
    if (hashes[i]) out[rel] = hashes[i]!
  })
  return out
}

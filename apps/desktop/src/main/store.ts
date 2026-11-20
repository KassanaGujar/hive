import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  DEFAULT_CATALOG_URL,
  DEFAULT_RELAY_URL,
  type AgentRun,
  type FeedEvent,
  type Settings
} from '@hive/shared'

/**
 * Local storage: SQLite via Node's built-in node:sqlite (no native rebuild), falling back to a
 * JSON file if this Electron build doesn't expose it.
 */
interface Backend {
  get(key: string): string | undefined
  set(key: string, value: string): void
  del(key: string): void
  feedAdd(project: string, ev: FeedEvent): void
  feedList(project: string, limit: number): FeedEvent[]
  runSave(project: string, run: AgentRun): void
  runList(project: string): AgentRun[]
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** The data file can't be opened (still locked by a Hive that is closing, disk error, …). */
export class StoreBusyError extends Error {}

/**
 * Open the SQLite store. Returns null only when this Electron has no node:sqlite at all. A file that
 * is merely busy (e.g. the previous Hive is still shutting down) is retried; it must never fall back
 * to an empty store, or the user's settings, keys and history would seem to vanish.
 */
function sqliteBackend(file: string): Backend | null {
  let DatabaseSync: new (f: string) => any
  try {
    DatabaseSync = createRequire(__filename)('node:sqlite').DatabaseSync
  } catch (e) {
    console.warn('[store] node:sqlite unavailable, using JSON store:', (e as Error).message)
    return null
  }
  let db: any
  let lastErr: unknown
  for (let attempt = 0; attempt < 40 && !db; attempt++) {
    try {
      const d = new DatabaseSync(file)
      d.exec('PRAGMA busy_timeout = 5000;')
      d.exec('PRAGMA journal_mode = WAL;')
      d.prepare('SELECT 1').get()
      db = d
    } catch (e) {
      lastErr = e
      sleepSync(250) // up to ~10 s for a closing Hive to let go of the file
    }
  }
  if (!db) throw new StoreBusyError(`Hive's data file is in use or unreadable (${(lastErr as Error)?.message ?? lastErr}).`)
  {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feed (id TEXT PRIMARY KEY, project TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS feed_project_at ON feed(project, at);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL);
    `)
    const q = {
      get: db.prepare('SELECT value FROM kv WHERE key = ?'),
      set: db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      del: db.prepare('DELETE FROM kv WHERE key = ?'),
      feedAdd: db.prepare('INSERT OR REPLACE INTO feed (id, project, at, json) VALUES (?, ?, ?, ?)'),
      feedList: db.prepare('SELECT json FROM feed WHERE project = ? ORDER BY at DESC LIMIT ?'),
      runSave: db.prepare('INSERT OR REPLACE INTO runs (id, project, at, json) VALUES (?, ?, ?, ?)'),
      runList: db.prepare('SELECT json FROM runs WHERE project = ? ORDER BY at DESC LIMIT 50')
    }
    return {
      get: (k) => (q.get.get(k) as { value: string } | undefined)?.value,
      set: (k, v) => void q.set.run(k, v),
      del: (k) => void q.del.run(k),
      feedAdd: (p, ev) => void q.feedAdd.run(ev.id, p, ev.at, JSON.stringify(ev)),
      feedList: (p, n) => (q.feedList.all(p, n) as { json: string }[]).map((r) => JSON.parse(r.json)),
      runSave: (p, r) => void q.runSave.run(r.id, p, r.createdAt, JSON.stringify(r)),
      runList: (p) => (q.runList.all(p) as { json: string }[]).map((r) => JSON.parse(r.json))
    }
  }
}

function jsonBackend(file: string): Backend {
  let data: { kv: Record<string, string>; feed: Record<string, FeedEvent[]>; runs: Record<string, AgentRun[]> } = {
    kv: {},
    feed: {},
    runs: {}
  }
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    /* new */
  }
  let timer: NodeJS.Timeout | undefined
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      writeFileSync(file + '.tmp', JSON.stringify(data))
      renameSync(file + '.tmp', file)
    }, 300)
  }
  return {
    get: (k) => data.kv[k],
    set: (k, v) => ((data.kv[k] = v), save()),
    del: (k) => (delete data.kv[k], save()),
    feedAdd: (p, ev) => {
      const list = (data.feed[p] ??= [])
      const i = list.findIndex((x) => x.id === ev.id)
      if (i >= 0) list[i] = ev
      else list.push(ev)
      if (list.length > 2000) list.splice(0, list.length - 2000)
      save()
    },
    feedList: (p, n) => [...(data.feed[p] ?? [])].sort((a, b) => b.at - a.at).slice(0, n),
    runSave: (p, r) => {
      const list = (data.runs[p] ??= [])
      const i = list.findIndex((x) => x.id === r.id)
      if (i >= 0) list[i] = r
      else list.push(r)
      save()
    },
    runList: (p) => [...(data.runs[p] ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
  }
}

let backend: Backend

export function initStore() {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  backend = sqliteBackend(path.join(dir, 'hive.sqlite')) ?? jsonBackend(path.join(dir, 'hive.json'))
}

export const store = {
  get<T>(key: string, fallback: T): T {
    const v = backend.get(key)
    if (v === undefined) return fallback
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    backend.set(key, JSON.stringify(value))
  },
  del(key: string) {
    backend.del(key)
  },
  feedAdd: (project: string, ev: FeedEvent) => backend.feedAdd(project, ev),
  feedList: (project: string, limit = 200) => backend.feedList(project, limit),
  runSave: (project: string, run: AgentRun) => backend.runSave(project, run),
  runList: (project: string) => backend.runList(project)
}

// ---------- settings ----------

const DEFAULT_SETTINGS: Settings = {
  profile: null,
  theme: 'dark',
  setupComplete: false,
  recentProjects: [],
  tierOverrides: {},
  relayUrl: DEFAULT_RELAY_URL,
  catalogUrl: DEFAULT_CATALOG_URL,
  autosave: true,
  cliAgents: []
}

export function getSettings(): Settings {
  const stored = store.get<Partial<Settings>>('settings', {})
  if (stored.relayUrl === 'ws://localhost:4455') delete stored.relayUrl // pre-Cloudflare default
  return { ...DEFAULT_SETTINGS, ...stored }
}

export function setSettings(patch: Partial<Settings>): Settings {
  // Store only what the user changed, so new defaults (e.g. the relay URL) reach existing installs.
  const stored = store.get<Partial<Settings>>('settings', {})
  const next: Partial<Settings> = { ...stored, ...patch }
  for (const k of Object.keys(next) as (keyof Settings)[]) {
    if (JSON.stringify(next[k]) === JSON.stringify(DEFAULT_SETTINGS[k])) delete next[k]
  }
  // Old builds saved the localhost relay as if chosen; treat it as "not set".
  if (next.relayUrl === 'ws://localhost:4455' && !patch.relayUrl) delete next.relayUrl
  store.set('settings', next)
  return { ...DEFAULT_SETTINGS, ...next }
}

// ---------- secrets (free API keys), encrypted with the OS keychain ----------

export const secrets = {
  set(key: string, value: string) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available on this machine.')
    store.set(`secret:${key}`, safeStorage.encryptString(value).toString('base64'))
  },
  get(key: string): string | undefined {
    const b64 = store.get<string | null>(`secret:${key}`, null)
    if (!b64) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'))
    } catch {
      return undefined
    }
  },
  has: (key: string) => !!store.get<string | null>(`secret:${key}`, null),
  delete: (key: string) => store.del(`secret:${key}`)
}

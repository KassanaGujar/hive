import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { PullProgress } from '@hive/shared'
import { emit } from './ipc'
import { store } from './store'
import { whichSync, which, clearWhichCache } from './terminal'

export const OLLAMA_URL = 'http://127.0.0.1:11434'

const MAC_APPS = ['/Applications/Ollama.app', path.join(os.homedir(), 'Applications/Ollama.app')]

const pulls = new Map<string, PullProgress>()
const controllers = new Map<string, AbortController>()

function ollamaExe(): string | null {
  const found = whichSync('ollama')
  if (found) return found
  const candidates =
    process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe')]
      : process.platform === 'darwin'
        ? [...MAC_APPS.map((a) => path.join(a, 'Contents/Resources/ollama')), '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama']
        : ['/usr/local/bin/ollama', '/usr/bin/ollama']
  return candidates.find((c) => existsSync(c)) ?? null
}

async function fetchJson(url: string, init?: RequestInit & { timeoutMs?: number }) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), init?.timeoutMs ?? 4000)
  try {
    const res = await fetch(url, { ...init, signal: init?.signal ?? ctl.signal })
    if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

export async function status() {
  try {
    const v = await fetchJson(`${OLLAMA_URL}/api/version`, { timeoutMs: 1500 })
    return { installed: true, running: true, version: v.version as string }
  } catch {
    return { installed: !!ollamaExe(), running: false }
  }
}

export async function start(): Promise<boolean> {
  await which('ollama')
  if ((await status()).running) return true
  const exe = ollamaExe()
  if (!exe) return false
  const macApp = process.platform === 'darwin' ? MAC_APPS.find((a) => existsSync(a)) : undefined
  // On Mac, launching the app starts its server and menu-bar icon the normal way.
  const child = macApp
    ? spawn('open', ['-g', '-a', macApp], { detached: true, stdio: 'ignore' })
    : spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if ((await status()).running) return true
  }
  return false
}

/** Silent per-user install. Windows: official OllamaSetup.exe with /VERYSILENT (Inno Setup). */
export async function install(): Promise<{ ok: boolean; message: string }> {
  if (ollamaExe()) return { ok: true, message: 'Ollama is already installed.' }
  if (process.platform === 'darwin') return installMac()
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Install Ollama with: curl -fsSL https://ollama.com/install.sh | sh  — then come back.' }
  }
  const file = path.join(app.getPath('temp'), 'OllamaSetup.exe')
  try {
    const res = await fetch('https://ollama.com/download/OllamaSetup.exe')
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(file))
    await new Promise<void>((resolve, reject) => {
      const p = spawn(file, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { windowsHide: true })
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`installer exited with ${code}`))))
      p.on('error', reject)
    })
    clearWhichCache()
    await unlink(file).catch(() => {})
    await start()
    return { ok: true, message: 'Ollama installed.' }
  } catch (e) {
    return { ok: false, message: `Could not install Ollama automatically (${(e as Error).message}). Get it from https://ollama.com/download` }
  }
}

/** Mac: official Ollama.app zip → ~/Applications (no admin password), then launch it. */
async function installMac(): Promise<{ ok: boolean; message: string }> {
  const dir = path.join(os.homedir(), 'Applications')
  const zip = path.join(app.getPath('temp'), 'Ollama-darwin.zip')
  try {
    const res = await fetch('https://ollama.com/download/Ollama-darwin.zip')
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(zip))
    await mkdir(dir, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      // ditto keeps the app bundle's symlinks and code signature intact
      const p = spawn('ditto', ['-xk', zip, dir])
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unzip failed (${code})`))))
      p.on('error', reject)
    })
    await unlink(zip).catch(() => {})
    clearWhichCache()
    if (!(await start())) throw new Error('Ollama was installed but did not start')
    return { ok: true, message: 'Ollama installed.' }
  } catch (e) {
    return { ok: false, message: `Could not install Ollama automatically (${(e as Error).message}). Get it from https://ollama.com/download` }
  }
}

/**
 * Models Ollama has. While Ollama is busy generating it can take longer than the timeout to answer; then the
 * last good list is used, so a model that is installed is never reported as missing mid-conversation.
 */
let lastLocal: { name: string; size: number }[] = []
export async function listLocal(): Promise<{ name: string; size: number }[]> {
  try {
    const j = await fetchJson(`${OLLAMA_URL}/api/tags`, { timeoutMs: 15000 })
    lastLocal = (j.models ?? []).map((m: any) => ({ name: m.name as string, size: m.size as number }))
    return lastLocal
  } catch {
    return lastLocal
  }
}

function saveState() {
  store.set(
    'pulls',
    [...pulls.values()].filter((p) => p.state === 'downloading' || p.state === 'paused')
  )
}

function update(p: PullProgress) {
  pulls.set(p.pullName, p)
  emit('ollama:progress', p)
}

/**
 * Stream /api/pull. Ollama keeps partial blobs, so pausing is just aborting the request and
 * resuming is pulling again — which also makes downloads survive an app restart.
 */
export async function pull(pullName: string) {
  if (controllers.has(pullName)) return
  if (!(await start())) {
    update({ pullName, status: 'Ollama is not running', completed: 0, total: 0, state: 'error', error: 'Ollama is not installed or would not start.' })
    return
  }
  const ctl = new AbortController()
  controllers.set(pullName, ctl)
  const prev = pulls.get(pullName)
  update({ pullName, status: 'starting', completed: prev?.completed ?? 0, total: prev?.total ?? 0, state: 'downloading' })
  saveState()
  let lastEmit = 0
  try {
    const res = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      body: JSON.stringify({ model: pullName, stream: true }),
      signal: ctl.signal
    })
    if (!res.ok || !res.body) throw new Error(`pull failed (${res.status}) ${await res.text().catch(() => '')}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    // Track the biggest layer — that's the model weights and dominates the time.
    let total = 0
    let completed = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        const j = JSON.parse(line)
        if (j.error) throw new Error(j.error)
        if (j.total && j.total >= total) {
          total = j.total
          completed = j.completed ?? 0
        }
        const now = Date.now()
        if (now - lastEmit > 250 || j.status === 'success') {
          lastEmit = now
          update({ pullName, status: j.status, completed, total, state: j.status === 'success' ? 'done' : 'downloading' })
        }
      }
    }
    update({ pullName, status: 'success', completed: total, total, state: 'done' })
  } catch (e) {
    const cur = pulls.get(pullName)!
    if (ctl.signal.aborted) {
      // pause or cancel set the state already
    } else update({ ...cur, state: 'error', error: (e as Error).message })
  } finally {
    controllers.delete(pullName)
    saveState()
  }
}

export function pause(pullName: string) {
  const cur = pulls.get(pullName)
  if (cur) update({ ...cur, state: 'paused', status: 'paused' })
  controllers.get(pullName)?.abort()
  saveState()
}

export async function cancel(pullName: string) {
  const cur = pulls.get(pullName)
  controllers.get(pullName)?.abort()
  if (cur) update({ ...cur, state: 'cancelled', status: 'cancelled', completed: 0 })
  pulls.delete(pullName)
  saveState()
  // Remove any partially registered model; Ollama prunes unused blobs on its next start.
  await remove(pullName).catch(() => {})
}

export async function remove(pullName: string) {
  const res = await fetch(`${OLLAMA_URL}/api/delete`, { method: 'DELETE', body: JSON.stringify({ model: pullName }) })
  if (!res.ok && res.status !== 404) throw new Error(`delete failed (${res.status})`)
}

export function listPulls(): PullProgress[] {
  return [...pulls.values()]
}

/** On launch: resume downloads that were running when Hive closed; show paused ones as paused. */
export async function resumePulls() {
  const saved = store.get<PullProgress[]>('pulls', [])
  for (const p of saved) {
    pulls.set(p.pullName, p)
    if (p.state === 'downloading') pull(p.pullName)
  }
}

export const ollamaBaseUrl = `${OLLAMA_URL}/v1`
export const homedir = os.homedir

import { onExitSoon } from './ptyExit'
import os from 'node:os'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn as spawnChild, execFile } from 'node:child_process'
import type { IPty } from '@lydell/node-pty'
import { emit } from './ipc'
import { currentProject } from './project'

// node-pty is loaded lazily so a missing native binary never stops Hive from starting.
let ptyMod: typeof import('@lydell/node-pty') | null = null
function pty() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ptyMod ??= require('@lydell/node-pty')
  return ptyMod!
}

const terms = new Map<string, { p: IPty; onExit?: (code: number) => void; buffer: string }>()
let counter = 0

export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const pwsh = whichSync('pwsh')
    return { file: pwsh ?? 'powershell.exe', args: ['-NoLogo'] }
  }
  return { file: process.env.SHELL || (existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash'), args: ['-l'] }
}

/**
 * Args to run one command and exit. On Windows this uses cmd.exe: Windows PowerShell 5.1 can take 10+ s just to
 * start on some PCs (measured 14 s here), and cmd understands `a && b` natively. Interactive terminals stay PowerShell.
 */
export function shellCommandArgs(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  return { file: defaultShell().file, args: ['-lc', command] }
}

/*
 * Tool lookups (`where` / `which`) run asynchronously and are cached. A synchronous lookup used to freeze
 * the whole main process for up to 4 s on a busy PC, stalling every window's calls.
 */
// found tools stay cached; "not found" expires after a minute so a freshly installed tool is picked up
const whichCache = new Map<string, string | null>()
const missingSince = new Map<string, number>()
const whichPending = new Map<string, Promise<string | null>>()

export function which(tool: string): Promise<string | null> {
  const cached = whichCache.get(tool)
  if (cached) return Promise.resolve(cached)
  if (cached === null && Date.now() - (missingSince.get(tool) ?? 0) < 60_000) return Promise.resolve(null)
  const pending = whichPending.get(tool)
  if (pending) return pending
  const p = new Promise<string | null>((resolve) => {
    execFile(process.platform === 'win32' ? 'where.exe' : 'which', [tool], { encoding: 'utf8', timeout: 8000, windowsHide: true }, (err, out) => {
      const found = err ? null : (String(out).split(/\r?\n/).find(Boolean) ?? null)
      whichCache.set(tool, found)
      if (!found) missingSince.set(tool, Date.now())
      whichPending.delete(tool)
      resolve(found)
    })
  })
  whichPending.set(tool, p)
  return p
}

/** Cached answer only (never blocks). Call `which()`/`prefetchTools()` first for a fresh answer. */
export function whichSync(tool: string): string | null {
  return whichCache.get(tool) ?? null
}

export const RUNTIME_TOOLS = ['pwsh', 'git', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'python', 'python3', 'py', 'go', 'cargo', 'java', 'mvn', 'gcc', 'g++', 'ollama', 'winget']
export async function prefetchTools(tools: string[] = RUNTIME_TOOLS) {
  await Promise.all(tools.map(which))
}

export function clearWhichCache() {
  whichCache.clear()
}

export function createTerminal(opts: { cwd?: string; command?: string; env?: Record<string, string>; onExit?: (code: number) => void } = {}): string {
  const id = `t${++counter}`
  const cwd = opts.cwd ?? currentProject() ?? os.homedir()
  const { file, args } = opts.command ? shellCommandArgs(opts.command) : defaultShell()
  const p = pty().spawn(file, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd,
    env: { ...process.env, ...opts.env, FORCE_COLOR: '1', TERM: 'xterm-256color' } as Record<string, string>,
    useConpty: true
  })
  const entry = { p, onExit: opts.onExit, buffer: '' }
  terms.set(id, entry)
  p.onData((data) => {
    entry.buffer = (entry.buffer + data).slice(-20000)
    emit('term:data', { id, data })
  })
  // Run's status follows the real exit; the terminal itself closes once node-pty has flushed the last output.
  if (entry.onExit) onExitSoon(p, (code) => entry.onExit?.(code))
  p.onExit(({ exitCode }) => {
    emit('term:exit', { id, code: exitCode })
    terms.delete(id)
  })
  return id
}

export function writeTerminal(id: string, data: string) {
  terms.get(id)?.p.write(data)
}

/** Show a line from Hive itself in a terminal (not sent to the program). */
export function printTerminal(id: string, text: string) {
  const entry = terms.get(id)
  const data = `\x1b[36m[Hive] ${text}\x1b[0m\r\n`
  if (entry) entry.buffer = (entry.buffer + data).slice(-20000)
  emit('term:data', { id, data })
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  try {
    terms.get(id)?.p.resize(Math.max(cols, 2), Math.max(rows, 2))
  } catch {
    /* exited */
  }
}

export function killTerminal(id: string) {
  const t = terms.get(id)
  if (!t) return
  if (process.platform === 'win32') {
    // Kill the whole tree (dev servers spawn children).
    try {
      spawnChild('taskkill', ['/pid', String(t.p.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      t.p.kill()
    }
  } else {
    // A pty child leads its own process group: signal the group so dev servers die too.
    try {
      process.kill(-t.p.pid, 'SIGTERM')
      setTimeout(() => {
        try {
          process.kill(-t.p.pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }, 1500)
    } catch {
      t.p.kill()
    }
  }
}

export function terminalBuffer(id: string) {
  return terms.get(id)?.buffer ?? ''
}

export function killAllTerminals() {
  for (const id of terms.keys()) killTerminal(id)
}

/** Kill every terminal and wait (up to 5 s) until their processes have exited. */
export async function killAllTerminalsAndWait() {
  const ids = [...terms.keys()]
  if (!ids.length) return
  const exited = ids.map((id) => new Promise<void>((resolve) => {
    const t = terms.get(id)
    if (!t) return resolve()
    t.p.onExit(() => resolve())
  }))
  ids.forEach(killTerminal)
  await Promise.race([Promise.all(exited), new Promise((r) => setTimeout(r, 5000))])
}

/** Run a command without a terminal and capture output (used by agents). */
export function execCapture(cwd: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const { file, args } = shellCommandArgs(command)
    const unix = process.platform !== 'win32'
    // detached on unix → own process group, so a timeout/stop kills everything it started
    const child = spawnChild(file, args, { cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, windowsHide: true, detached: unix })
    let output = ''
    const add = (d: Buffer) => {
      output = (output + d.toString()).slice(-60000)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const kill = () => {
      if (process.platform === 'win32' && child.pid) spawnChild('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
    const timer = setTimeout(() => {
      output += `\n[Hive] Command timed out after ${Math.round(timeoutMs / 60000)} minutes and was stopped.`
      kill()
    }, timeoutMs)
    signal?.addEventListener('abort', kill)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output: stripAnsi(output) })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, output: String(e.message) })
    })
  })
}

export function stripAnsi(s: string) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '')
}

export const userHome = () => os.homedir()
export const joinPath = path.join

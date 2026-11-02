import os from 'node:os'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn as spawnChild, execFileSync } from 'node:child_process'
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

/** Args to run one command and exit, in the user's shell. */
export function shellCommandArgs(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const sh = defaultShell().file
    // `cmd && cmd` works in PowerShell 7 but not 5.1; translate for 5.1.
    const isPwsh7 = /pwsh/i.test(sh)
    const cmd = isPwsh7 ? command : command.replace(/\s*&&\s*/g, '; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ')
    return { file: sh, args: ['-NoLogo', '-NoProfile', '-Command', cmd] }
  }
  return { file: defaultShell().file, args: ['-lc', command] }
}

const whichCache = new Map<string, string | null>()
export function whichSync(tool: string): string | null {
  if (whichCache.has(tool)) return whichCache.get(tool)!
  let found: string | null = null
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [tool], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 })
    found = out.split(/\r?\n/).find(Boolean) ?? null
  } catch {
    found = null
  }
  whichCache.set(tool, found)
  return found
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
  p.onExit(({ exitCode }) => {
    emit('term:exit', { id, code: exitCode })
    entry.onExit?.(exitCode)
    terms.delete(id)
  })
  return id
}

export function writeTerminal(id: string, data: string) {
  terms.get(id)?.p.write(data)
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
  } else t.p.kill()
}

export function terminalBuffer(id: string) {
  return terms.get(id)?.buffer ?? ''
}

export function killAllTerminals() {
  for (const id of terms.keys()) killTerminal(id)
}

/** Run a command without a terminal and capture output (used by agents). */
export function execCapture(cwd: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const { file, args } = shellCommandArgs(command)
    const child = spawnChild(file, args, { cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, windowsHide: true })
    let output = ''
    const add = (d: Buffer) => {
      output = (output + d.toString()).slice(-60000)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const kill = () => {
      if (process.platform === 'win32' && child.pid) spawnChild('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGKILL')
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

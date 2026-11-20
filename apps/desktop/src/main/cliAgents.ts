import { execFile, spawn } from 'node:child_process'
import type { InstalledModel } from '@hive/shared'
import type { CliInvocation, CliSource } from '@hive/agents'
import { getSettings, setSettings } from './store'

/**
 * Coding-agent CLIs the user already pays for. Hive only starts the official CLI; the CLI signs in with the user's
 * own account. Off until the user turns one on in the Model store (it spends their subscription's usage).
 * HIVE_CLI_AGENTS=claude-code,codex turns them on for QA runs.
 */
const NAMES: Record<CliSource, { name: string; command: string; install: string }> = {
  'claude-code': { name: 'Claude Code', command: 'claude', install: 'https://docs.claude.com/en/docs/claude-code/setup' },
  codex: { name: 'Codex', command: 'codex', install: 'https://github.com/openai/codex' }
}

const win = process.platform === 'win32'
const fromEnv = (process.env.HIVE_CLI_AGENTS ?? '').split(',').map((x) => x.trim()).filter(Boolean)

/** Without these, a Hive started from inside a Claude Code session would make the CLI refuse to start nested. */
function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k]
  return env
}

let detected: Promise<Record<CliSource, string | null>> | null = null

/** Installed CLI versions (null = not installed). Cached; pass fresh to look again. */
export function detectCliAgents(fresh = false) {
  if (!detected || fresh) {
    detected = Promise.all(
      (Object.keys(NAMES) as CliSource[]).map(
        (s) =>
          new Promise<[CliSource, string | null]>((resolve) => {
            // shell on Windows: npm installs codex as codex.cmd, which execFile cannot start directly
            execFile(NAMES[s].command, ['--version'], { timeout: 15000, windowsHide: true, shell: win, env: cliEnv() }, (err, out) =>
              resolve([s, err ? null : out.trim().split(/\r?\n/)[0] || 'installed'])
            )
          })
      )
    ).then((pairs) => Object.fromEntries(pairs) as Record<CliSource, string | null>)
  }
  return detected
}

export function enabledCliAgents(): CliSource[] {
  return [...new Set([...(getSettings().cliAgents ?? []), ...fromEnv])].filter((s): s is CliSource => s in NAMES)
}

export async function listCliAgents() {
  const versions = await detectCliAgents(true)
  const on = enabledCliAgents()
  return (Object.keys(NAMES) as CliSource[]).map((s) => ({ source: s, name: NAMES[s].name, version: versions[s], enabled: on.includes(s), installUrl: NAMES[s].install }))
}

export function setCliAgent(source: CliSource, on: boolean) {
  const cur = new Set(getSettings().cliAgents ?? [])
  if (on) cur.add(source)
  else cur.delete(source)
  setSettings({ cliAgents: [...cur] })
}

/** Team members for the CLIs that are turned on and installed. */
export async function cliModels(): Promise<InstalledModel[]> {
  const on = enabledCliAgents()
  if (!on.length) return []
  const versions = await detectCliAgents()
  const overrides = getSettings().tierOverrides
  return on
    .filter((s) => versions[s])
    .map((s) => {
      const id = `cli:${s}`
      return { id, name: `${NAMES[s].name} (your subscription)`, source: s, model: '', tier: overrides[id] ?? 'top', codingScore: 92, sizeGB: 0, minRamGB: 0, contextTokens: 200000 }
    })
}

/** Run one CLI call; stops the whole process tree on abort or timeout. */
export function runCli(inv: CliInvocation, cwd: string, signal: AbortSignal, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(inv.command, inv.args, { cwd, env: cliEnv(), windowsHide: true, shell: win, detached: !win })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout = (stdout + d.toString()).slice(-2_000_000)))
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-60_000)))
    const kill = () => {
      if (win && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
    const timer = setTimeout(() => {
      stderr += `\n[Hive] ${inv.command} timed out after ${Math.round(timeoutMs / 60000)} minutes and was stopped.`
      kill()
    }, timeoutMs)
    signal.addEventListener('abort', kill, { once: true })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', kill)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(inv.input)
  })
}

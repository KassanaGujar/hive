import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { clearWhichCache, which } from './terminal'

const run = promisify(execFile)

export async function gitStatus(): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await run('git', ['--version'], { timeout: 5000 })
    return { installed: true, version: stdout.trim().replace(/^git version /, '') }
  } catch {
    return { installed: false }
  }
}

/**
 * Silent per-user git install. Windows uses winget (built into Windows 10 1809+/11);
 * when winget is missing we point the user at the official download.
 */
export async function installGit(): Promise<{ ok: boolean; message: string }> {
  if ((await gitStatus()).installed) return { ok: true, message: 'git is already installed.' }
  if (process.platform === 'darwin') {
    spawn('xcode-select', ['--install'], { detached: true, stdio: 'ignore' }).unref()
    return { ok: false, message: 'macOS will ask to install developer tools (includes git). Click Install, then press Check again.' }
  }
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Install git with your package manager (for example: sudo apt install git), then press Check again.' }
  }
  if (!(await which('winget'))) {
    return { ok: false, message: 'Download Git for Windows from https://git-scm.com/download/win, install it, then press Check again.' }
  }
  try {
    await run(
      'winget',
      ['install', '--id', 'Git.Git', '-e', '--silent', '--scope', 'user', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
      { timeout: 10 * 60 * 1000, windowsHide: true }
    )
  } catch (e) {
    // winget returns non-zero for "already installed" too; re-check below.
    console.warn('[setup] winget git:', (e as Error).message)
  }
  // winget updates PATH for new processes only; add the default per-user location for this one.
  const local = `${process.env.LOCALAPPDATA}\\Programs\\Git\\cmd`
  if (!process.env.PATH?.includes(local)) process.env.PATH = `${process.env.PATH};${local}`
  clearWhichCache()
  const s = await gitStatus()
  return s.installed
    ? { ok: true, message: `git ${s.version} installed.` }
    : { ok: false, message: 'git install did not finish. Download it from https://git-scm.com/download/win.' }
}

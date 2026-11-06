import { execFileSync } from 'node:child_process'
import os from 'node:os'

/**
 * macOS/Linux apps started from Finder/Dock get a minimal PATH (/usr/bin:/bin…), so node, python3,
 * brew tools and ollama aren't found. Ask the user's login shell for its real PATH once at startup.
 * Windows GUI apps already inherit the full PATH.
 */
export function fixPath() {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__HIVE_PATH__%s__HIVE_PATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } // oh-my-zsh
    })
    const m = /__HIVE_PATH__(.*)__HIVE_PATH__/s.exec(out)
    if (m?.[1]) process.env.PATH = m[1]
  } catch {
    /* fall back to common locations below */
  }
  const extra =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`, '/Applications/Ollama.app/Contents/Resources']
      : ['/usr/local/bin', `${os.homedir()}/.local/bin`]
  const parts = new Set((process.env.PATH ?? '').split(':').filter(Boolean))
  for (const p of extra) parts.add(p)
  process.env.PATH = [...parts].join(':')
}

/** What safe mode can enforce for one command. Node's permission model covers files, child processes and network. */
export type SafeLimit = 'files' | 'processes' | 'network' | 'time'

/**
 * Safe mode for Run. A command that starts `node` (alone, or after `&&`, as in "npm install && node index.js") gets
 * Node's permission flags: read and write only inside the project, no child processes, no network unless allowed.
 * Anything else (python, npm run dev, nodemon…) can't be wrapped this way, so only the time limit applies to it.
 */
export function safeCommand(command: string, root: string, opts: { allowNetwork: boolean }): { command: string; limits: SafeLimit[] } {
  const flags = `--permission --allow-fs-read="${root}" --allow-fs-write="${root}"${opts.allowNetwork ? ' --allow-net' : ''}`
  let wrapped = false
  const out = command
    .split(/(\s*&&\s*)/)
    .map((part) => {
      const m = /^node(\.exe)?\s+(.*)$/i.exec(part)
      if (!m || /--permission\b/.test(m[2])) return part
      wrapped = true
      return `node${m[1] ?? ''} ${flags} ${m[2]}`
    })
    .join('')
  if (!wrapped) return { command, limits: ['time'] }
  return { command: out, limits: opts.allowNetwork ? ['files', 'processes', 'time'] : ['files', 'processes', 'network', 'time'] }
}

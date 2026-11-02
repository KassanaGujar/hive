/**
 * Command safety gate for agent shell commands. Anything risky is held for the user's approval:
 * deleting outside the worktree, installing packages, network access, pushing, or system changes.
 */
export type Verdict = { action: 'allow' } | { action: 'approve'; reason: string } | { action: 'block'; reason: string }

const RULES: { re: RegExp; reason: string; block?: boolean }[] = [
  // catastrophic → refuse outright
  { re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME|[a-z]:\\?)(\s|$)/i, reason: 'deletes a whole drive or home folder', block: true },
  { re: /\b(format|mkfs|diskpart|bcdedit|shutdown|reboot|halt)\b/i, reason: 'system-level command', block: true },
  { re: /\breg(\.exe)?\s+(add|delete)\b/i, reason: 'edits the Windows registry', block: true },

  // installs
  { re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b/i, reason: 'installs packages' },
  { re: /\bnpx\s/i, reason: 'downloads and runs a package (npx)' },
  { re: /\b(pip3?|python3?\s+-m\s+pip|uv|poetry)\s+(install|add)\b/i, reason: 'installs Python packages' },
  { re: /\b(cargo\s+(add|install)|go\s+(get|install)|gem\s+install|composer\s+(require|install)|dotnet\s+add)\b/i, reason: 'installs packages' },
  { re: /\b(winget|choco|scoop|apt(-get)?|brew|dnf|yum|pacman|snap)\b/i, reason: 'installs system software' },

  // network
  { re: /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|ssh|scp|sftp|ftp|nc|ncat|telnet)\b/i, reason: 'uses the network' },
  { re: /\bgit\s+(clone|fetch|pull|push|remote|submodule)\b/i, reason: 'uses the network (git)' },
  { re: /\bgit\s+push\b/i, reason: 'pushes code' },

  // privilege / env escapes
  { re: /\b(sudo|runas|Start-Process\b.*-Verb\s+RunAs)\b/i, reason: 'asks for admin rights' },
  { re: /\b(Set-ExecutionPolicy|setx|chmod\s+777|chown)\b/i, reason: 'changes system or permission settings' },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|branch\s+-D|worktree)\b/i, reason: 'rewrites git state' }
]

const DELETE = /\b(rm|rmdir|del|erase|rd|Remove-Item|ri|unlink|shred)\b/i

/** True if any path-looking argument points outside the worktree. */
function touchesOutside(command: string): boolean {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return tokens.some((raw) => {
    const t = raw.replace(/^["']|["']$/g, '')
    return (
      /^(\/|\\|~|[a-z]:)/i.test(t) || // absolute or home
      /(^|[\\/])\.\.([\\/]|$)/.test(t) || // parent traversal
      /^\$(env:)?(HOME|USERPROFILE|APPDATA|TEMP)/i.test(t) ||
      /^%[A-Z]+%/i.test(t)
    )
  })
}

export function classifyCommand(command: string): Verdict {
  const cmd = command.trim()
  if (!cmd) return { action: 'block', reason: 'empty command' }
  for (const r of RULES) {
    if (r.re.test(cmd)) return r.block ? { action: 'block', reason: r.reason } : { action: 'approve', reason: r.reason }
  }
  if (DELETE.test(cmd) && touchesOutside(cmd)) return { action: 'approve', reason: 'deletes files outside the worktree' }
  if (/(^|\s)(cd|Set-Location|pushd)\s+(\/|\\|[a-z]:|\.\.)/i.test(cmd)) {
    return { action: 'approve', reason: 'leaves the worktree folder' }
  }
  // Redirecting output to an absolute/parent path writes outside the worktree.
  if (/>{1,2}\s*("?)(\/|[a-z]:|\.\.)/i.test(cmd)) return { action: 'approve', reason: 'writes outside the worktree' }
  return { action: 'allow' }
}

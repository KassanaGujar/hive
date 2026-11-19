interface ExitSource {
  onExit(listener: (e: { exitCode: number }) => void): unknown
}

/**
 * Call `cb(exitCode)` once, as soon as the program has ended.
 * On Windows node-pty learns the exit code from ConPTY right away but only fires onExit after it has gone 1 s
 * without output (each new output restarts that wait): Run reported exits 4-8 s late on a busy PC. Its agent's
 * exitCode is set at the real exit, so watch that too; where it does not exist, onExit alone is used.
 */
export function onExitSoon(p: ExitSource, cb: (code: number) => void, pollMs = 100): void {
  let done = false
  const finish = (code: number) => {
    if (done) return
    done = true
    clearInterval(timer)
    cb(code)
  }
  const agent = (p as { _agent?: { exitCode?: number } })._agent
  const timer = agent
    ? setInterval(() => {
        if (typeof agent.exitCode === 'number') finish(agent.exitCode)
      }, pollMs)
    : undefined
  p.onExit(({ exitCode }) => finish(exitCode))
}

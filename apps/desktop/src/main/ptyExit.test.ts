import { describe, expect, it, vi } from 'vitest'
import { onExitSoon } from './ptyExit'

type Listener = (e: { exitCode: number }) => void
function fakePty() {
  const listeners: Listener[] = []
  const agent: { exitCode?: number } = {}
  return {
    pty: { onExit: (l: Listener) => listeners.push(l), _agent: agent },
    nativeExit: (code: number) => (agent.exitCode = code),
    ptyExit: (code: number) => listeners.forEach((l) => l({ exitCode: code }))
  }
}

describe('noticing a program ended', () => {
  it('reports the exit code as soon as Windows knows it, not after node-pty finishes flushing output (1 s+, 4-8 s on a busy PC)', async () => {
    vi.useFakeTimers()
    const f = fakePty()
    const cb = vi.fn()
    onExitSoon(f.pty, cb, 100)
    vi.advanceTimersByTime(300)
    expect(cb).not.toHaveBeenCalled()
    f.nativeExit(3)
    vi.advanceTimersByTime(100)
    expect(cb).toHaveBeenCalledWith(3)
    f.ptyExit(3)
    expect(cb).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
  it('falls back to the normal exit event where the early code is not available (other platforms)', () => {
    vi.useFakeTimers()
    const listeners: Listener[] = []
    const cb = vi.fn()
    onExitSoon({ onExit: (l: Listener) => listeners.push(l) }, cb, 100)
    vi.advanceTimersByTime(1000)
    listeners.forEach((l) => l({ exitCode: 0 }))
    expect(cb).toHaveBeenCalledWith(0)
    expect(cb).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})

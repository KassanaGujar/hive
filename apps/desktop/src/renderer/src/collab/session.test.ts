import { describe, expect, it, vi, beforeEach } from 'vitest'

// The app bridge: every invoke waits on a gate so the test controls when start() resumes.
const listeners = new Set<string>()
let gate: Promise<void> = Promise.resolve()
vi.mock('../lib/api', () => ({
  COLORS: ['#000'],
  invoke: vi.fn(async (channel: string) => {
    await gate
    if (channel === 'fs:read') throw new Error('missing')
    if (channel === 'fs:hashTree') return {}
    return undefined
  }),
  on: vi.fn((event: string) => {
    const key = `${event}#${Math.random()}`
    listeners.add(key)
    return () => listeners.delete(key)
  })
}))
vi.mock('../store', () => ({
  actorName: () => 'me',
  useStore: { getState: () => ({ set: () => {}, addFeed: () => {}, toast: () => {}, settings: null }) }
}))

const { ProjectSession } = await import('./session')

describe('project session lifecycle', () => {
  beforeEach(() => listeners.clear())

  it('a session closed while it was still starting leaves no listeners behind', async () => {
    // Switching projects quickly closed a session mid-start; it then registered its disk listener anyway and
    // recorded every later save a second time in the new project's History (each edit appeared twice).
    let open!: () => void
    gate = new Promise<void>((r) => (open = r))
    const s = new ProjectSession('/a')
    const started = s.start()
    s.destroy()
    open()
    await started
    expect([...listeners]).toEqual([])
    expect(s.provider).toBeNull()
  })

  it('a session closed before it read its saved state does not overwrite that state with an empty one', async () => {
    const { invoke } = await import('../lib/api')
    let open!: () => void
    gate = new Promise<void>((r) => (open = r))
    const s = new ProjectSession('/c')
    const started = s.start()
    vi.mocked(invoke).mockClear()
    s.destroy()
    open()
    await started
    expect(vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'fs:write')).toEqual([])
  })

  it('a session that finished starting registers its listeners and removes them on close', async () => {
    gate = Promise.resolve()
    const s = new ProjectSession('/b')
    await s.start()
    expect(listeners.size).toBeGreaterThan(0)
    s.destroy()
    expect([...listeners]).toEqual([])
  })
})

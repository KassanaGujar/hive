import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentRun, ChatMessage, InstalledModel } from '@hive/shared'
import { Orchestrator, type ChatResult, type OrchestratorHost } from './orchestrator'
import { createGitOps } from './gitops'

const model = (id: string, tier: InstalledModel['tier']): InstalledModel => ({ id, name: id, source: 'hf', model: id, tier, codingScore: 60, sizeGB: 0, minRamGB: 0, contextTokens: 32000 })
const call = (name: string, args: Record<string, unknown>): ChatResult => ({ text: '', toolCalls: [{ id: `c${Math.random()}`, name, arguments: args }] })

function host(root: string, chat: OrchestratorHost['chat'], extra: Partial<OrchestratorHost> = {}): OrchestratorHost {
  return {
    projectRoot: () => root,
    models: () => [model('big', 'top'), model('small', 'worker')],
    tierOverrides: () => ({}),
    chat,
    git: createGitOps(),
    exec: async () => ({ code: 0, output: '' }),
    requestApproval: async () => true,
    emit: () => {},
    log: () => {},
    feed: () => {},
    memoryBudgetGB: () => 8,
    ...extra
  }
}

async function waitFor(orch: Orchestrator, id: string, ok: (r: AgentRun) => boolean, what: string) {
  for (let i = 0; i < 4800; i++) {
    const r = orch.list().find((x) => x.id === id)!
    if (ok(r)) return r
    if (r.phase === 'failed') throw new Error(r.error)
    await new Promise((res) => setTimeout(res, 25))
  }
  throw new Error(`timeout waiting for ${what}`)
}

/** Two independent tasks; the worker on b.js hangs when `hang` is set (Hive "closes" mid-task). */
function chatFor(hang: boolean): OrchestratorHost['chat'] {
  return async (_m, msgs: ChatMessage[]) => {
    const sys = msgs[0].content
    if (sys.includes('software architect'))
      return { text: JSON.stringify({ summary: 's', tasks: [
        { id: 'a', title: 'Part A', description: 'a.js', files: ['a.js'], dependsOn: [] },
        { id: 'b', title: 'Part B', description: 'b.js', files: ['b.js'], dependsOn: [] }
      ] }) }
    if (sys.includes('code reviewer')) return { text: '{"approved": true, "notes": "ok"}' }
    const file = sys.includes('Task: Part A') ? 'a.js' : 'b.js'
    if (file === 'b.js' && hang) return new Promise<ChatResult>(() => {})
    const done = msgs.some((m) => m.role === 'tool')
    return done ? call('report_done', { summary: 'done' }) : call('write_file', { path: file, content: `const ${file[0]} = 1\n` })
  }
}

describe('resume after Hive closes', () => {
  it('keeps merged work, finds a merge that was never saved in git, and redoes the unfinished task', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-resume-'))
    const first = new Orchestrator(host(root, chatFor(true)))
    const id = await first.start('Build A and B')
    await waitFor(first, id, (r) => r.phase === 'awaiting-plan-approval', 'plan')
    await first.approvePlan(id, true)
    const mid = await waitFor(first, id, (r) => r.tasks.find((t) => t.id === 'a')?.status === 'merged', 'a merged')
    // Hive "closes" here. The last save happened before task a's merge was recorded.
    const saved: AgentRun = structuredClone(mid)
    saved.tasks.find((t) => t.id === 'a')!.status = 'approved'

    const second = new Orchestrator(host(root, chatFor(false)))
    second.restore([saved])
    const restored = second.list()[0]
    expect(restored.phase).toBe('cancelled')
    expect(restored.resumable).toBe(true)
    expect(restored.interruptedPhase).toBe('working')

    await second.resumeRun(id)
    const ready = await waitFor(second, id, (r) => r.phase === 'awaiting-merge-approval', 'merge approval')
    const a = ready.tasks.find((t) => t.id === 'a')!
    expect(a.status).toBe('merged')
    expect(a.log.join('\n')).toContain('found in git')
    expect(ready.tasks.find((t) => t.id === 'b')!.status).toBe('merged')
    await second.approveMerge(id, true)
    await waitFor(second, id, (r) => r.phase === 'done', 'done')
    expect(readFileSync(path.join(root, 'a.js'), 'utf8')).toContain('const a')
    expect(readFileSync(path.join(root, 'b.js'), 'utf8')).toContain('const b')
    rmSync(root, { recursive: true, force: true })
  }, 180_000)

  it('a run still being planned cannot be resumed', () => {
    const o = new Orchestrator(host(tmpdir(), chatFor(false)))
    o.restore([{ id: 'run-x', goal: 'g', phase: 'planning', tasks: [], agents: [], baseBranch: '', createdAt: 0 }])
    expect(o.list()[0].resumable).toBe(false)
  })
})

describe('coordination off (benchmark baseline)', () => {
  it('one agent builds the whole goal with no plan, review or checks, and the run records metrics', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-solo-'))
    const toolReplies: string[] = []
    let reviews = 0
    const chat: OrchestratorHost['chat'] = async (_m, msgs) => {
      const sys = msgs[0].content
      if (sys.includes('code reviewer')) reviews++
      if (sys.includes('software architect')) throw new Error('no architect in solo mode')
      toolReplies.splice(0, toolReplies.length, ...msgs.filter((m) => m.role === 'tool').map((m) => m.content))
      const n = toolReplies.length
      if (n === 0) return call('write_file', { path: 'a.js', content: 'function helper() { return 1 }\n' })
      if (n === 1) return call('write_file', { path: 'b.js', content: 'helper()\n' })
      if (n < 6) return call('find_code', { query: 'helper' })
      return call('report_done', { summary: 'all' })
    }
    const orch = new Orchestrator(host(root, chat, { coordination: () => 'off' }))
    const id = await orch.start('Build it all')
    const planned = await waitFor(orch, id, (r) => r.phase === 'awaiting-plan-approval', 'plan')
    expect(planned.tasks.map((t) => t.id)).toEqual(['solo'])
    expect(planned.agents.filter((a) => a.role === 'worker')).toHaveLength(1)
    await orch.approvePlan(id, true)
    const ready = await waitFor(orch, id, (r) => r.phase === 'awaiting-merge-approval', 'ready')
    expect(reviews).toBe(0)
    expect(ready.tasks[0].status).toBe('merged')
    // find_code: an answer with the definition, then the limit after three lookups
    expect(toolReplies[2]).toContain('a.js:1')
    expect(toolReplies[2]).toMatch(/Used in: b\.js/)
    expect(toolReplies[5]).toContain('find_code limit reached')
    const m = ready.metrics!
    expect(m.mode).toBe('solo')
    expect(m.toolCalls).toBe(7)
    expect(m.modelCalls).toBe(7)
    expect(m.reviewRejections + m.checkFailures).toBe(0)
    expect(m.firstFileMs).toBeGreaterThanOrEqual(0)
    expect(m.readyMs).toBeGreaterThanOrEqual(m.firstFileMs!)
    rmSync(root, { recursive: true, force: true })
  }, 120_000)
})

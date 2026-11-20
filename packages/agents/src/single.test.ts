import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentRun, InstalledModel } from '@hive/shared'
import { Orchestrator, type ChatResult, type OrchestratorHost } from './orchestrator'
import { createGitOps } from './gitops'

const model = (id: string, tier: InstalledModel['tier'], source: InstalledModel['source'] = 'hf'): InstalledModel => ({ id, name: id, source, model: '', tier, codingScore: tier === 'top' ? 92 : 60, sizeGB: 0, minRamGB: 0, contextTokens: 200000 })
const call = (name: string, args: Record<string, unknown>): ChatResult => ({ text: '', toolCalls: [{ id: `c${Math.random()}`, name, arguments: args }] })

function host(root: string, extra: Partial<OrchestratorHost>): OrchestratorHost {
  return {
    projectRoot: () => root,
    models: () => [model('big', 'top'), model('small', 'worker')],
    tierOverrides: () => ({}),
    chat: async () => ({ text: '' }),
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

describe('one agent with Hive checks (single mode)', () => {
  it('fixes what the syntax check finds, never asks the AI reviewer, and still runs the integration test', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-single-'))
    let reviews = 0
    let smoke = 0
    const prompts: string[] = []
    const chat: OrchestratorHost['chat'] = async (_m, msgs) => {
      const sys = msgs[0].content
      if (sys.includes('code reviewer')) reviews++
      if (sys.includes('software architect')) throw new Error('no architect plan in single mode')
      const tools = msgs.filter((m) => m.role === 'tool').length
      prompts.push(msgs.map((m) => m.content).join('\n'))
      const fixing = msgs.some((m) => m.content.includes("syntax check failed"))
      if (tools === 0) return call('write_file', { path: 'game.js', content: fixing ? 'const score = 1\n' : 'const score = (\n' })
      return call('report_done', { summary: 'built' })
    }
    const orch = new Orchestrator(host(root, { chat, coordination: () => 'single', smokeTest: async () => (smoke++, []) }))
    const id = await orch.start('Build a game')
    const planned = await waitFor(orch, id, (r) => r.phase === 'awaiting-plan-approval', 'plan')
    expect(planned.tasks.map((t) => t.id)).toEqual(['single'])
    expect(planned.agents.filter((a) => a.role === 'worker')).toHaveLength(1)
    await orch.approvePlan(id, true)
    const ready = await waitFor(orch, id, (r) => r.phase === 'awaiting-merge-approval', 'ready')
    expect(reviews).toBe(0)
    expect(smoke).toBe(1)
    const task = ready.tasks[0]
    expect(task.status).toBe('merged')
    expect(task.attempts).toBe(2)
    expect(ready.metrics!.mode).toBe('single')
    expect(ready.metrics!.checkFailures).toBe(1)
    await orch.approveMerge(id, true)
    await waitFor(orch, id, (r) => r.phase === 'done', 'done')
    expect(readFileSync(path.join(root, 'game.js'), 'utf8').replace(/\r/g, '')).toBe('const score = 1\n')
    rmSync(root, { recursive: true, force: true })
  }, 120_000)

  it('auto: a subscription CLI as the strongest model gets one agent, other models get the team', () => {
    const cli = new Orchestrator(host(tmpdir(), { models: () => [model('cli:claude-code', 'top', 'claude-code'), model('small', 'worker')] }))
    const local = new Orchestrator(host(tmpdir(), {}))
    const forced = new Orchestrator(host(tmpdir(), { models: () => [model('cli:claude-code', 'top', 'claude-code')], coordination: () => 'team' }))
    const mode = (o: Orchestrator) => (o as unknown as { mode(): string }).mode()
    expect(mode(cli)).toBe('single')
    expect(mode(local)).toBe('team')
    expect(mode(forced)).toBe('team')
  })
})

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentRun, InstalledModel } from '@hive/shared'
import { Orchestrator, SELF_TEST_BRIEF, type ChatResult, type OrchestratorHost } from './orchestrator'
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
    expect(planned.tasks[0].description).toContain(SELF_TEST_BRIEF) // Hive's checks can't see wrong behaviour; the app's self-test can
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

  it('play-tests the app like a person and sends back what does not work, then plays it again', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-play-'))
    const { writeFileSync } = await import('node:fs')
    const builds: string[] = []
    const runCli: OrchestratorHost['runCli'] = async (inv, cwd) => {
      builds.push(inv.input)
      writeFileSync(path.join(cwd, 'game.js'), `const build = ${builds.length}\n`)
      return { code: 0, stdout: '{"type":"result","is_error":false,"result":"built"}', stderr: '' }
    }
    const plays: { goal: string; tester: string }[] = []
    const playTest: OrchestratorHost['playTest'] = async (_dir, goal, tester) => {
      plays.push({ goal, tester: tester.id })
      return plays.length === 1 ? ['Clicking Reset does not clear the board'] : []
    }
    const orch = new Orchestrator(host(root, { models: () => [model('cli:claude-code', 'top', 'claude-code')], runCli, smokeTest: async () => [], playTest }))
    const id = await orch.start('make tic tac toe')
    await waitFor(orch, id, (r) => r.phase === 'awaiting-plan-approval', 'plan')
    await orch.approvePlan(id, true)
    const ready = await waitFor(orch, id, (r) => r.phase === 'awaiting-merge-approval', 'ready')
    expect(plays).toEqual([
      { goal: 'make tic tac toe', tester: 'cli:claude-code' },
      { goal: 'make tic tac toe', tester: 'cli:claude-code' }
    ])
    const fix = ready.tasks.find((t) => t.id === 'integrate-1')!
    expect(fix.status).toBe('merged')
    expect(builds.at(-1)).toContain('Play-test: Clicking Reset does not clear the board')
    rmSync(root, { recursive: true, force: true })
  }, 120_000)

  it('no play-test without Claude Code in the team', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-noplay-'))
    let plays = 0
    const chat: OrchestratorHost['chat'] = async (_m, msgs) => (msgs.some((m) => m.role === 'tool') ? call('report_done', { summary: 'ok' }) : call('write_file', { path: 'game.js', content: 'const a = 1\n' }))
    const orch = new Orchestrator(host(root, { chat, coordination: () => 'single', smokeTest: async () => [], playTest: async () => (plays++, ['x']) }))
    const id = await orch.start('Build a game')
    await waitFor(orch, id, (r) => r.phase === 'awaiting-plan-approval', 'plan')
    await orch.approvePlan(id, true)
    await waitFor(orch, id, (r) => r.phase === 'awaiting-merge-approval', 'ready')
    expect(plays).toBe(0)
    rmSync(root, { recursive: true, force: true })
  }, 120_000)

  it('solo (the benchmark baseline) gets no self-test brief', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-solo-'))
    const orch = new Orchestrator(host(root, { coordination: () => 'off' }))
    const id = await orch.start('Build a game')
    const planned = await waitFor(orch, id, (r) => r.phase === 'awaiting-plan-approval', 'plan')
    expect(planned.tasks[0].description).not.toContain('hiveSelfTest')
    await orch.approvePlan(id, false)
    rmSync(root, { recursive: true, force: true })
  })
})

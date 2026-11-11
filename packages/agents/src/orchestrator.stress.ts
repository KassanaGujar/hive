import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { AgentRun, ChatMessage, InstalledModel } from '@hive/shared'
import { Orchestrator } from './orchestrator'
import { createGitOps } from './gitops'

const model = (id: string, tier: InstalledModel['tier']): InstalledModel => ({
  id, name: id, source: 'hf', model: id, tier, codingScore: 50, sizeGB: 0, minRamGB: 0, contextTokens: 8192
})

/**
 * Many agents finishing at the same moment: parallel worktree creation, commits and merges into the
 * same integration branch. Git takes repo-wide locks, so this is where races would show up.
 */
describe('orchestrator under load', () => {
  it('8 parallel tasks across 4 workers all merge cleanly', async () => {
    const N = 8
    const root = mkdtempSync(path.join(tmpdir(), 'hive-stress-'))
    const chat = async (_m: InstalledModel, messages: ChatMessage[]) => {
      const sys = messages[0].content
      if (sys.includes('software architect')) {
        return { text: JSON.stringify({ tasks: Array.from({ length: N }, (_, i) => ({ id: `t${i}`, title: `Module ${i}`, description: `m${i}.js`, files: [`src/m${i}.js`], dependsOn: [] })) }) }
      }
      if (sys.includes('code reviewer')) return { text: '{"approved": true}' }
      const i = /Task: Module (\d+)/.exec(sys)![1]
      const done = messages.some((m) => m.role === 'tool')
      await new Promise((r) => setTimeout(r, Math.random() * 30)) // finish at nearly the same time
      return {
        text: '',
        toolCalls: [done ? { id: 'd', name: 'report_done', arguments: { summary: 'ok' } } : { id: 'w', name: 'write_file', arguments: { path: `src/m${i}.js`, content: `export const m${i} = ${i}\n` } }]
      }
    }
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [model('a', 'top'), model('w1', 'worker'), model('w2', 'worker'), model('w3', 'worker'), model('w4', 'worker')],
      tierOverrides: () => ({}),
      chat,
      git: createGitOps(),
      exec: async () => ({ code: 0, output: '' }),
      requestApproval: async () => true,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 64
    })
    const t0 = Date.now()
    const id = await orch.start('many modules')
    const wait = async (phase: AgentRun['phase']) => {
      for (let i = 0; i < 2400; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase) return r
        if (r.phase === 'failed') throw new Error(r.error + '\n' + r.tasks.map((t) => `${t.id}:${t.status} ${t.log.slice(-2).join(' | ')}`).join('\n'))
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error(`timeout waiting for ${phase}`)
    }
    await wait('awaiting-plan-approval')
    await orch.approvePlan(id, true)
    const r = await wait('awaiting-merge-approval')
    const statuses = r.tasks.map((t) => `${t.id}:${t.status}`)
    expect(r.tasks.filter((t) => t.status === 'merged').length, statuses.join(' ')).toBe(N)
    await orch.approveMerge(id, true)
    await wait('done')
    for (let i = 0; i < N; i++) expect(readFileSync(path.join(root, `src/m${i}.js`), 'utf8')).toContain(`m${i}`)
    const branches = (await simpleGit(root).branchLocal()).all.filter((b) => b.startsWith('hive/'))
    expect(branches).toEqual([])
    appendFileSync(process.env.STRESS_REPORT ?? 'stress-report.txt', `agents: ${N} parallel tasks / 4 workers → all merged, run done in ${Date.now() - t0} ms\n`)
    rmSync(root, { recursive: true, force: true })
  })
})

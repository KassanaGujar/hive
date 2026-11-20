import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { AgentRun, InstalledModel } from '@hive/shared'
import { Orchestrator } from './orchestrator'
import { createGitOps } from './gitops'
import type { CliInvocation } from './cliAgents'

const claude: InstalledModel = { id: 'cli:claude-code', name: 'Claude Code', source: 'claude-code', model: '', tier: 'top', codingScore: 92, sizeGB: 0, minRamGB: 0, contextTokens: 200000 }
const result = (text: string, isError = false) => ({ code: isError ? 1 : 0, stdout: JSON.stringify({ type: 'result', is_error: isError, result: text }) + '\n', stderr: '' })

describe('a subscription CLI on the team, gated by Hive checks', () => {
  it('plans, builds and reviews through the CLI; syntax and project checks send work back; stray edits are undone', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-sub-'))
    mkdirSync(path.join(root, '.hive'))
    writeFileSync(path.join(root, '.hive', 'checks.json'), JSON.stringify({ commands: ['npm test'] }))
    const calls: { mode: string; prompt: string }[] = []
    let taskRuns = 0
    let testRuns = 0
    const runCli = async (inv: CliInvocation, cwd: string) => {
      const mode = inv.args.includes('acceptEdits') ? 'task' : 'ask'
      calls.push({ mode, prompt: inv.input })
      if (mode === 'ask') {
        if (inv.input.includes('software architect'))
          return result(JSON.stringify({ summary: 'A game', tasks: [{ id: 'game', title: 'Game loop', description: 'game.js', files: ['game.js'], dependsOn: [] }] }))
        return result('{"approved": true, "notes": "Looks good"}')
      }
      taskRuns++
      // first attempt: broken syntax, plus an edit to a file it does not own
      writeFileSync(path.join(cwd, 'game.js'), taskRuns === 1 ? 'function loop( {\n' : `function loop() { return ${taskRuns} }\n`)
      if (taskRuns === 1) writeFileSync(path.join(cwd, 'other.js'), 'stray\n')
      return result(`wrote game.js (attempt ${taskRuns})`)
    }
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [claude],
      tierOverrides: () => ({}),
      chat: async () => {
        throw new Error('the HTTP chat path must not be used for a CLI model')
      },
      git: createGitOps(),
      exec: async (_cwd, command) => {
        expect(command).toBe('npm test')
        testRuns++
        return testRuns === 1 ? { code: 1, output: 'FAIL loop.test.js: expected 3' } : { code: 0, output: 'ok' }
      },
      requestApproval: async () => false,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8,
      runCli,
      coordination: () => 'team' as const // this test covers the split team with a CLI; auto would give it one agent
    })
    const id = await orch.start('Build a game')
    const wait = async (phase: AgentRun['phase']) => {
      for (let i = 0; i < 4800; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase) return r
        if (r.phase === 'failed') throw new Error(r.error)
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error(`timeout waiting for ${phase}`)
    }
    await wait('awaiting-plan-approval')
    await orch.approvePlan(id, true)
    const ready = await wait('awaiting-merge-approval')
    const game = ready.tasks.find((t) => t.id === 'game')!
    expect(game.status).toBe('merged')
    // round 1: syntax check failed; round 2: npm test failed; round 3: passed and the review approved
    expect(game.attempts).toBe(3)
    expect(taskRuns).toBe(3)
    expect(testRuns).toBe(2)
    const taskPrompts = calls.filter((c) => c.mode === 'task').map((c) => c.prompt)
    expect(taskPrompts[1]).toContain("Hive's syntax check failed")
    expect(taskPrompts[2]).toContain('FAIL loop.test.js')
    expect(game.log.join('\n')).toContain('Undid edits outside its own files: other.js')
    await orch.approveMerge(id, true)
    await wait('done')
    expect(readFileSync(path.join(root, 'game.js'), 'utf8')).toContain('return 3')
    expect(existsSync(path.join(root, 'other.js'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  }, 180_000)
})

describe('gitops', () => {
  async function repo() {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-git-'))
    const ops = createGitOps()
    await ops.ensureRepo(root)
    return { root, ops, g: simpleGit(root) }
  }

  it('a branch left by an earlier run is kept aside, and the new worktree starts from fromRef', async () => {
    const { root, ops, g } = await repo()
    await g.raw(['branch', 'hive/agent-bee/html']) // old run's branch at the first commit
    writeFileSync(path.join(root, 'new.txt'), 'new\n')
    await g.add('.').then(() => g.commit('newer'))
    const head = (await g.revparse(['HEAD'])).trim()
    const wt = path.join(root, '.hive', 'worktrees', 'r2', 'html')
    await ops.addWorktree(root, wt, 'hive/agent-bee/html', 'HEAD')
    expect((await simpleGit(wt).revparse(['HEAD'])).trim()).toBe(head)
    expect((await g.branchLocal()).all.some((b) => b.startsWith('hive/agent-bee/html-old-'))).toBe(true)
    await ops.removeWorktree(root, wt)
    rmSync(root, { recursive: true, force: true })
  }, 60_000)

  it('lists and undoes uncommitted changes, including new files and nested paths', async () => {
    const { root, ops, g } = await repo()
    mkdirSync(path.join(root, 'src'))
    writeFileSync(path.join(root, 'src', 'a.js'), 'a\n')
    await g.add('.').then(() => g.commit('a'))
    writeFileSync(path.join(root, 'src', 'a.js'), 'changed\n')
    writeFileSync(path.join(root, 'src', 'b.js'), 'new\n')
    writeFileSync(path.join(root, 'keep.js'), 'keep\n')
    expect((await ops.changedFiles!(root)).sort()).toEqual(['keep.js', 'src/a.js', 'src/b.js'])
    await ops.restorePaths!(root, ['src/a.js', 'src/b.js'])
    expect(readFileSync(path.join(root, 'src', 'a.js'), 'utf8').replace(/\r/g, '')).toBe('a\n')
    expect(existsSync(path.join(root, 'src', 'b.js'))).toBe(false)
    expect(await ops.changedFiles!(root)).toEqual(['keep.js'])
    rmSync(root, { recursive: true, force: true })
  }, 60_000)
})

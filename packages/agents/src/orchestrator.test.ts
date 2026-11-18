import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { AgentRun, ApprovalRequest, ChatMessage, InstalledModel } from '@hive/shared'
import { Orchestrator, type ChatResult } from './orchestrator'
import { createGitOps } from './gitops'

const model = (id: string, tier: InstalledModel['tier']): InstalledModel => ({
  id, name: id, source: 'hf', model: id, tier, codingScore: tier === 'top' ? 80 : 50, sizeGB: 0, minRamGB: 0, contextTokens: 8192
})

/**
 * Scripted models: the Architect returns a 2-task plan, workers write their file (the CSS worker
 * also tries a package install, which must hit the approval gate), the Lead asks for one fix
 * round on the HTML task and then approves.
 */
function scriptedChat() {
  const reviews = new Map<string, number>()
  return async (_m: InstalledModel, messages: ChatMessage[]): Promise<ChatResult> => {
    const sys = messages[0].content
    if (sys.includes('software architect')) {
      return {
        text: JSON.stringify({
          summary: 'A static page',
          tasks: [
            { id: 'html', title: 'Page markup', description: 'index.html', files: ['index.html'], dependsOn: [] },
            { id: 'css', title: 'Styles', description: 'style.css', files: ['style.css'], dependsOn: ['html'] }
          ]
        })
      }
    }
    if (sys.includes('code reviewer')) {
      const user = messages[1].content
      const key = user.includes('Page markup') ? 'html' : 'css'
      const n = (reviews.get(key) ?? 0) + 1
      reviews.set(key, n)
      if (key === 'html' && n === 1) return { text: '{"approved": false, "notes": "Add a <title>."}' }
      return { text: '{"approved": true, "notes": "Looks good"}' }
    }
    // worker
    const isCss = sys.includes('Task: Styles')
    const fixing = sys.includes('Reviewer notes')
    const toolMsgs = messages.filter((m) => m.role === 'tool').length
    const call = (name: string, args: Record<string, unknown>) => ({ text: '', toolCalls: [{ id: `c${Math.random()}`, name, arguments: args }] })
    if (isCss) {
      if (toolMsgs === 0) return call('write_file', { path: 'style.css', content: 'body { background: #111; }\n' })
      if (toolMsgs === 1) return call('run_command', { command: 'npm install left-pad' })
      return call('report_done', { summary: 'styles' })
    }
    if (toolMsgs === 0)
      return call('write_file', { path: 'index.html', content: fixing ? '<title>Todo</title><h1>Todo</h1>\n' : '<h1>Todo</h1>\n' })
    return call('report_done', { summary: 'markup' })
  }
}

describe('orchestrator (real git worktrees, scripted models)', () => {
  it('plans, builds in worktrees, reviews, gates risky commands and merges', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-orch-'))
    const approvals: ApprovalRequest[] = []
    const updates: AgentRun[] = []
    const chat = scriptedChat()
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [model('big', 'top'), model('small', 'worker')],
      tierOverrides: () => ({}),
      chat: (m, msgs) => chat(m, msgs),
      git: createGitOps(),
      exec: async () => ({ code: 0, output: 'ran' }),
      requestApproval: async (req) => {
        approvals.push(req)
        return false // deny
      },
      emit: (r) => updates.push(r),
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8
    })

    const id = await orch.start('Build a todo page')
    const wait = async (phase: AgentRun['phase']) => {
      for (let i = 0; i < 4800; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase) return r
        if (r.phase === 'failed') throw new Error(r.error)
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error(`timeout waiting for ${phase}; stuck in ${orch.list().find((x) => x.id === id)!.phase}: ${JSON.stringify(orch.list().find((x) => x.id === id)!.tasks.map((t) => [t.id, t.status]))}`)
    }

    const planned = await wait('awaiting-plan-approval')
    expect(planned.tasks.map((t) => t.id)).toEqual(['html', 'css'])
    expect(planned.agents.find((a) => a.role === 'architect')?.modelId).toBe('big')

    await orch.approvePlan(id, true)
    const ready = await wait('awaiting-merge-approval')

    // each task ran on its own branch and the html task went through a fix round
    const html = ready.tasks.find((t) => t.id === 'html')!
    expect(html.status).toBe('merged')
    expect(html.attempts).toBe(2)
    expect(html.branch).toMatch(/^hive\/agent-.+\/html$/)
    // the package install was held for approval (and denied)
    expect(approvals).toHaveLength(1)
    expect(approvals[0].command).toBe('npm install left-pad')
    // nothing merged into main until the user approves
    expect(existsSync(path.join(root, 'index.html'))).toBe(false)

    await orch.approveMerge(id, true)
    await wait('done')
    expect(readFileSync(path.join(root, 'index.html'), 'utf8')).toContain('<title>Todo</title>')
    expect(readFileSync(path.join(root, 'style.css'), 'utf8')).toContain('background')
    const branches = await simpleGit(root).branchLocal()
    expect(branches.all.filter((b) => b.startsWith('hive/'))).toEqual([])
    expect(existsSync(path.join(root, '.hive', 'worktrees', id, 'html'))).toBe(false)
    // .hive is excluded from git, so the user's status stays clean
    expect((await simpleGit(root).status()).isClean()).toBe(true)
    rmSync(root, { recursive: true, force: true })
  }, 180_000)
})

describe('integration step after parallel work', () => {
  it('smoke test fails → integration task fixes it → then waits for merge approval', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-integ-'))
    let smokeCalls = 0
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [model('big', 'top'), model('small', 'worker')],
      tierOverrides: () => ({}),
      chat: async (_m, messages) => {
        const sys = messages[0].content
        if (sys.includes('software architect')) return { text: '{"tasks":[{"id":"page","title":"Page","files":["index.html"]}]}' }
        if (sys.includes('code reviewer')) return { text: '{"approved": true}' }
        const done = messages.some((m) => m.role === 'tool')
        const integrating = sys.includes('Make all the pieces work together')
        return done
          ? { text: '', toolCalls: [{ id: 'd', name: 'report_done', arguments: { summary: 'ok' } }] }
          : { text: '', toolCalls: [{ id: 'w', name: 'write_file', arguments: { path: 'index.html', content: integrating ? '<canvas id="g"></canvas><script>/*fixed*/</script>' : '<script>broken(</script>' } }] }
      },
      git: createGitOps(),
      exec: async () => ({ code: 0, output: '' }),
      requestApproval: async () => true,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8,
      smokeTest: async (dir) => {
        smokeCalls++
        return readFileSync(path.join(dir, 'index.html'), 'utf8').includes('fixed') ? [] : ['SyntaxError: Unexpected token (index.html:1)']
      }
    })
    const id = await orch.start('a page')
    const wait = async (phase: AgentRun['phase']) => {
      for (let i = 0; i < 4800; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase) return r
        if (r.phase === 'failed') throw new Error(r.error)
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error(`timeout waiting for ${phase}; stuck in ${orch.list().find((x) => x.id === id)!.phase}: ${JSON.stringify(orch.list().find((x) => x.id === id)!.tasks.map((t) => [t.id, t.status]))}`)
    }
    await wait('awaiting-plan-approval')
    await orch.approvePlan(id, true)
    const r = await wait('awaiting-merge-approval')
    expect(r.tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['page:merged', 'integrate-1:merged'])
    expect(smokeCalls).toBe(2)
    await orch.approveMerge(id, true)
    await wait('done')
    expect(readFileSync(path.join(root, 'index.html'), 'utf8')).toContain('fixed')
    rmSync(root, { recursive: true, force: true })
  }, 180_000)
})

describe('integration can create a file whose worker failed', () => {
  it('a failed game.js task is written by the integration round', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-integ2-'))
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [model('big', 'top'), model('small', 'worker')],
      tierOverrides: () => ({}),
      chat: async (_m, messages) => {
        const sys = messages[0].content
        if (sys.includes('software architect'))
          return { text: '{"tasks":[{"id":"html","title":"Page","files":["index.html"]},{"id":"js","title":"Logic","files":["game.js"]}]}' }
        if (sys.includes('code reviewer')) return { text: '{"approved": true}' }
        const integrating = sys.includes('Make all the pieces work together')
        if (!integrating && sys.includes('Task: Logic')) throw new Error('Tool call validation failed') // the worker dies
        const done = messages.some((m) => m.role === 'tool')
        if (done) return { text: '', toolCalls: [{ id: 'd', name: 'report_done', arguments: { summary: 'ok' } }] }
        return integrating
          ? { text: '', toolCalls: [{ id: 'w', name: 'write_file', arguments: { path: 'game.js', content: 'window.game = {}\n' } }] }
          : { text: '', toolCalls: [{ id: 'w', name: 'write_file', arguments: { path: 'index.html', content: '<script src="game.js"></script>' } }] }
      },
      git: createGitOps(),
      exec: async () => ({ code: 0, output: '' }),
      requestApproval: async () => true,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8,
      smokeTest: async (dir) => (existsSync(path.join(dir, 'game.js')) ? [] : ['game.js failed to load (404)'])
    })
    const id = await orch.start('a game')
    const wait = async (phase: AgentRun['phase']) => {
      for (let i = 0; i < 4800; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase || r.phase === 'failed') return r
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error('timeout')
    }
    await wait('awaiting-plan-approval')
    await orch.approvePlan(id, true)
    const r = await wait('awaiting-merge-approval')
    const integ = r.tasks.find((t) => t.id === 'integrate-1')!
    expect(integ.files).toContain('game.js')
    expect(integ.status).toBe('merged')
    rmSync(root, { recursive: true, force: true })
  }, 180_000)
})

describe('orchestrator keeps its project when the user switches projects mid-run', () => {
  it('merges into the folder the run started in, not the newly opened one', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-orch-a-'))
    const other = mkdtempSync(path.join(tmpdir(), 'hive-orch-b-')) // not a git repo, like the QA run's stale folder
    let current = root
    const chat = scriptedChat()
    const orch = new Orchestrator({
      projectRoot: () => current,
      models: () => [model('big', 'top'), model('small', 'worker')],
      tierOverrides: () => ({}),
      chat: (m, msgs) => chat(m, msgs),
      git: createGitOps(),
      exec: async () => ({ code: 0, output: 'ran' }),
      requestApproval: async () => false,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8
    })
    const id = await orch.start('Build a todo page')
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
    current = other // the user opens a different project while the team works
    await wait('awaiting-merge-approval')
    await orch.approveMerge(id, true)
    await wait('done')
    expect(readFileSync(path.join(root, 'index.html'), 'utf8')).toContain('<title>Todo</title>')
    expect(existsSync(path.join(other, 'index.html'))).toBe(false)
    expect(existsSync(path.join(other, '.git'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  }, 180_000)
})

describe('plans sized to the team (planning only)', () => {
  // Two small local models: neither can write a whole game in one task.
  const small = (id: string, tier: InstalledModel['tier']): InstalledModel => ({ id, name: id, source: 'ollama', model: id, tier, codingScore: 50, sizeGB: 2, minRamGB: 4, contextTokens: 8192 })
  const bigTask = {
    id: 'game', title: 'Whole game', files: ['game.js'],
    description: 'Write init(), update(), draw(), reset(), spawn(), collide(), score(), input(), pause(), save(), load(), menu() in game.js.'
  }
  const planWith = async (splitReply: string, planned: object = bigTask) => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-size-'))
    const prompts: string[] = []
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [small('a', 'lead'), small('b', 'worker')],
      tierOverrides: () => ({}),
      chat: async (_m, msgs) => {
        const user = msgs[msgs.length - 1].content
        prompts.push(user)
        if (user.includes('Split this task')) return { text: splitReply }
        return { text: JSON.stringify({ summary: 's', tasks: [planned] }) }
      },
      git: createGitOps(),
      exec: async () => ({ code: 0, output: '' }),
      requestApproval: async () => false,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8
    })
    const id = await orch.start('Build a game')
    for (let i = 0; i < 400; i++) {
      const r = orch.list().find((x) => x.id === id)!
      if (r.phase === 'awaiting-plan-approval') return { run: r, prompts, root }
      if (r.phase === 'failed') throw new Error(r.error)
      await new Promise((res) => setTimeout(res, 25))
    }
    throw new Error('planning did not finish')
  }
  it('tells the architect how much each worker can write', async () => {
    const { prompts, root } = await planWith('not json')
    expect(prompts[0]).toMatch(/about \d+ lines of code/)
    expect(prompts[0]).not.toContain('Fewer is better')
    rmSync(root, { recursive: true, force: true })
  })
  it('asks the architect to split a task no model can do, and uses its split', async () => {
    const reply = JSON.stringify({ tasks: [
      { id: 'core', title: 'Core loop', description: 'init(), update(), draw()', files: ['core.js'] },
      { id: 'rules', title: 'Rules', description: 'collide(), score()', files: ['rules.js'] }
    ] })
    const { run, prompts, root } = await planWith(reply)
    expect(prompts.some((p) => p.includes('Split this task'))).toBe(true)
    expect(run.tasks.map((t) => t.files[0])).toEqual(['core.js', 'rules.js'])
    rmSync(root, { recursive: true, force: true })
  })
  it('still finishes planning when the split reply is garbage', async () => {
    const { run, root } = await planWith('I cannot do that')
    expect(run.tasks.length).toBeGreaterThanOrEqual(1)
    expect(run.tasks.length).toBeLessThanOrEqual(12)
    rmSync(root, { recursive: true, force: true })
  })
  it('does not ask to split a task that is hard but small (splitting cannot make it easier)', async () => {
    const hard = { id: 'ai', title: 'Chess engine', description: 'A minimax search for the chess AI in ai.js.', files: ['ai.js'] }
    const { run, prompts, root } = await planWith('not json', hard)
    expect(prompts.some((p) => p.includes('Split this task'))).toBe(false)
    expect(run.tasks.map((t) => t.id)).toEqual(['ai'])
    rmSync(root, { recursive: true, force: true })
  })
})

describe('router in a real run', () => {
  it('a large task runs on the strong model, a small one on the small model', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-route-'))
    const weak: InstalledModel = { id: 'weak', name: 'weak', source: 'ollama', model: 'weak', tier: 'worker', codingScore: 40, sizeGB: 2, minRamGB: 4, contextTokens: 8192 }
    const strong: InstalledModel = { id: 'strong', name: 'strong', source: 'groq', model: 'strong', tier: 'top', codingScore: 82, sizeGB: 0, minRamGB: 0, contextTokens: 131072 }
    const fns = Array.from({ length: 20 }, (_, i) => `f${i}()`).join(', ')
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [strong, weak],
      tierOverrides: () => ({}),
      chat: async (_m, msgs) => {
        const sys = msgs[0].content
        if (sys.includes('software architect')) {
          return { text: JSON.stringify({ summary: 's', tasks: [
            { id: 'engine', title: 'Engine', description: `Write ${fns} in engine.js.`, files: ['engine.js'] },
            { id: 'css', title: 'Styles', description: 'Colours.', files: ['style.css'] }
          ] }) }
        }
        if (sys.includes('code reviewer') || msgs[1]?.content.includes('Lead reviewer')) return { text: '{"approved": true, "notes": "ok"}' }
        const file = sys.includes('Task: Engine') ? 'engine.js' : 'style.css'
        const wrote = msgs.some((x) => x.role === 'tool')
        return { text: '', toolCalls: [wrote ? { id: 'd', name: 'report_done', arguments: { summary: 'done' } } : { id: 'w', name: 'write_file', arguments: { path: file, content: '// ok\n' } }] }
      },
      git: createGitOps(),
      exec: async () => ({ code: 0, output: '' }),
      requestApproval: async () => false,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8
    })
    const id = await orch.start('Build it')
    const wait = async (phase: AgentRun['phase']) => {
      for (let i = 0; i < 4800; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase) return r
        if (r.phase === 'failed') throw new Error(r.error)
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error('timeout')
    }
    await wait('awaiting-plan-approval')
    await orch.approvePlan(id, true)
    const r = await wait('awaiting-merge-approval')
    expect(r.tasks.find((t) => t.id === 'engine')!.model).toBe('strong')
    expect(r.tasks.find((t) => t.id === 'engine')!.size).toBe('large')
    expect(r.tasks.find((t) => t.id === 'css')!.model).toBe('weak')
    await orch.approveMerge(id, false)
    rmSync(root, { recursive: true, force: true })
  }, 120_000)
})

describe('reviews fit the lead', () => {
  it('a 30,000-char diff to a lead capped at 7,000 input tokens a minute is reviewed in parts, each under the cap', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-review-'))
    const lead: InstalledModel = { id: 'qwen', name: 'qwen', source: 'groq', model: 'qwen', tier: 'top', codingScore: 70, sizeGB: 0, minRamGB: 0, contextTokens: 131072, limits: { inputPerMinute: 7000 } }
    const worker: InstalledModel = { id: 'oss', name: 'oss', source: 'groq', model: 'oss', tier: 'worker', codingScore: 70, sizeGB: 0, minRamGB: 0, contextTokens: 131072 }
    const reviewPrompts: { task: string; len: number }[] = []
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [lead, worker],
      tierOverrides: () => ({}),
      chat: async (_m, msgs) => {
        const sys = msgs[0].content
        if (sys.includes('software architect')) {
          return { text: JSON.stringify({ summary: 's', tasks: [
            { id: 'big', title: 'Big', description: 'Two files.', files: ['a.js', 'b.js'] },
            { id: 'c', title: 'C', description: 'c', files: ['c.js'] },
            { id: 'd', title: 'D', description: 'd', files: ['d.js'] }
          ] }) }
        }
        if (sys.includes('code reviewer')) {
          reviewPrompts.push({ task: msgs[1].content.includes('Task: Big') ? 'big' : 'other', len: msgs[0].content.length + msgs[1].content.length })
          return { text: '{"approved": true, "notes": "ok"}' }
        }
        const mine = sys.includes('Task: Big') ? ['a.js', 'b.js'] : sys.includes('Task: C') ? ['c.js'] : ['d.js']
        const n = msgs.filter((x) => x.role === 'tool').length
        if (n < mine.length) return { text: '', toolCalls: [{ id: `w${n}`, name: 'write_file', arguments: { path: mine[n], content: `// ${mine[n]}\n${'let x = 1\n'.repeat(1500)}` } }] }
        return { text: '', toolCalls: [{ id: 'd', name: 'report_done', arguments: { summary: 'done' } }] }
      },
      git: createGitOps(),
      exec: async () => ({ code: 0, output: '' }),
      requestApproval: async () => false,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8
    })
    const id = await orch.start('Build it')
    const wait = async (phase: AgentRun['phase']) => {
      for (let i = 0; i < 4800; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase) return r
        if (r.phase === 'failed') throw new Error(r.error)
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error('timeout')
    }
    await wait('awaiting-plan-approval')
    await orch.approvePlan(id, true)
    await wait('awaiting-merge-approval')
    const big = reviewPrompts.filter((p) => p.task === 'big')
    expect(big.length).toBeGreaterThanOrEqual(2)
    for (const p of reviewPrompts) expect(p.len / 4).toBeLessThanOrEqual(7000)
    await orch.approveMerge(id, false)
    rmSync(root, { recursive: true, force: true })
  }, 120_000)
})

describe('the task card shows the model that really did the work', () => {
  it('a host fallback updates task.model and the outcome is recorded for the stand-in', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-fallback-'))
    const planned: InstalledModel = { id: 'north', name: 'North Mini Code', source: 'openrouter', model: 'north', tier: 'worker', codingScore: 66, sizeGB: 0, minRamGB: 0, contextTokens: 32768 }
    const standIn: InstalledModel = { id: 'oss', name: 'gpt-oss 120B', source: 'groq', model: 'oss', tier: 'top', codingScore: 82, sizeGB: 0, minRamGB: 0, contextTokens: 131072 }
    const outcomes: { id: string; ok: boolean }[] = []
    const orch = new Orchestrator({
      projectRoot: () => root,
      models: () => [standIn, planned],
      tierOverrides: () => ({}),
      chat: async (_m, msgs, _t, opts) => {
        const sys = msgs[0].content
        if (sys.includes('software architect')) return { text: JSON.stringify({ summary: 's', tasks: [{ id: 'css', title: 'Styles', description: 'Colours.', files: ['style.css'] }] }) }
        if (sys.includes('code reviewer')) return { text: '{"approved": true, "notes": "ok"}' }
        opts.onModel?.(standIn)
        const wrote = msgs.some((x) => x.role === 'tool')
        return { text: '', toolCalls: [wrote ? { id: 'd', name: 'report_done', arguments: { summary: 'done' } } : { id: 'w', name: 'write_file', arguments: { path: 'style.css', content: 'body{}\n' } }] }
      },
      recordOutcome: (id, o) => outcomes.push({ id, ok: o.ok }),
      git: createGitOps(),
      exec: async () => ({ code: 0, output: '' }),
      requestApproval: async () => false,
      emit: () => {},
      log: () => {},
      feed: () => {},
      memoryBudgetGB: () => 8
    })
    const id = await orch.start('Style it')
    const wait = async (phase: AgentRun['phase']) => {
      for (let i = 0; i < 4800; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase) return r
        if (r.phase === 'failed') throw new Error(r.error)
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error('timeout')
    }
    await wait('awaiting-plan-approval')
    await orch.approvePlan(id, true)
    const r = await wait('awaiting-merge-approval')
    expect(r.tasks.find((t) => t.id === 'css')!.model).toBe('gpt-oss 120B')
    expect(outcomes).toContainEqual({ id: 'oss', ok: true })
    await orch.approveMerge(id, false)
    rmSync(root, { recursive: true, force: true })
  }, 120_000)
})

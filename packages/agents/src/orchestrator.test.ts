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
      for (let i = 0; i < 400; i++) {
        const r = orch.list().find((x) => x.id === id)!
        if (r.phase === phase) return r
        if (r.phase === 'failed') throw new Error(r.error)
        await new Promise((res) => setTimeout(res, 25))
      }
      throw new Error(`timeout waiting for ${phase}`)
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
  }, 60_000)
})

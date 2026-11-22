import { describe, expect, it } from 'vitest'
import type { AgentTask, InstalledModel } from '@hive/shared'
import { classifyCommand } from './policy'
import { normalizePlan, planToTasks, readyTasks, starvedTasks, topoOrder } from './scheduler'
import { ResourceGuard } from './guard'
import { safeResolve } from './tools'
import path from 'node:path'

describe('command policy', () => {
  const v = (c: string) => classifyCommand(c).action
  it('allows ordinary build commands', () => {
    expect(v('node index.js')).toBe('allow')
    expect(v('python main.py')).toBe('allow')
    expect(v('npm run build')).toBe('allow')
    expect(v('rm -rf dist')).toBe('allow')
    expect(v('ls')).toBe('allow')
  })
  it('holds installs, network and push for approval', () => {
    expect(v('npm install express')).toBe('approve')
    expect(v('pip install flask')).toBe('approve')
    expect(v('curl https://x.y')).toBe('approve')
    expect(v('git push origin main')).toBe('approve')
    expect(v('Invoke-WebRequest https://x')).toBe('approve')
  })
  it('holds deletes outside the worktree', () => {
    expect(v('rm -rf ../other')).toBe('approve')
    expect(v('Remove-Item C:\\Users\\me\\file.txt')).toBe('approve')
    expect(v('del ..\\x')).toBe('approve')
  })
  it('blocks catastrophic commands', () => {
    expect(v('rm -rf /')).toBe('block')
    expect(v('format C:')).toBe('block')
    expect(v('shutdown /s')).toBe('block')
  })
})

describe('scheduler', () => {
  const plan = normalizePlan('g', {
    tasks: [
      { id: 'html', title: 'HTML', dependsOn: [] },
      { id: 'css', title: 'CSS', dependsOn: ['html'] },
      { id: 'js', title: 'JS', dependsOn: ['html', 'css'] }
    ]
  })
  it('normalises ids and deps', () => {
    expect(plan.tasks.map((t) => t.id)).toEqual(['html', 'css', 'js'])
    expect(plan.tasks[2].dependsOn).toEqual(['html', 'css'])
  })
  it('only starts tasks whose deps are merged', () => {
    const tasks = planToTasks('r', plan)
    expect(readyTasks(tasks).map((t) => t.id)).toEqual(['html'])
    tasks[0].status = 'merged'
    expect(readyTasks(tasks).map((t) => t.id)).toEqual(['css'])
  })
  it('cancels tasks whose dependency failed', () => {
    const tasks = planToTasks('r', plan)
    tasks[0].status = 'failed'
    expect(starvedTasks(tasks).map((t) => t.id)).toEqual(['css', 'js'])
  })
  it('breaks cycles and falls back to a single task', () => {
    const p = normalizePlan('g', { tasks: [{ id: 'a', title: 'A', dependsOn: ['b'] }, { id: 'b', title: 'B', dependsOn: ['a'] }] })
    expect(() => topoOrder(p.tasks)).not.toThrow()
    expect(normalizePlan('build it', null).tasks).toHaveLength(1)
  })
  it('accepts numeric dependency references', () => {
    const p = normalizePlan('g', { tasks: [{ title: 'First' }, { title: 'Second', dependsOn: [1] }] })
    expect(p.tasks[1].dependsOn).toEqual([p.tasks[0].id])
  })
})

const m = (id: string, sizeGB: number): InstalledModel => ({ id, name: id, source: 'ollama', model: id, tier: 'worker', codingScore: 50, sizeGB, minRamGB: 8, contextTokens: 8192 })

describe('resource guard', () => {
  it('queues a second big model until the first is released', async () => {
    const g = new ResourceGuard(() => 10)
    const r1 = await g.acquire(m('a', 6))
    let got = false
    const p = g.acquire(m('b', 6)).then((r) => {
      got = true
      return r
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(got).toBe(false)
    r1()
    const r2 = await p
    expect(got).toBe(true)
    r2()
  })
  it('lets small models share', async () => {
    const g = new ResourceGuard(() => 10)
    const a = await g.acquire(m('a', 2))
    const b = await g.acquire(m('b', 2))
    a()
    b()
  })
})

describe('sandbox paths', () => {
  const root = path.resolve('/tmp/proj')
  it('refuses escapes', () => {
    expect(() => safeResolve(root, '../x')).toThrow()
    expect(() => safeResolve(root, 'a/../../x')).toThrow()
    expect(safeResolve(root, '/src/a.js')).toBe(path.join(root, 'src', 'a.js'))
  })
})

// keep the type import used
export type _T = AgentTask

import { enforceFileOwnership } from './scheduler'
describe('file ownership', () => {
  it('merges tasks that touch the same file and re-points deps', () => {
    const p = enforceFileOwnership(
      normalizePlan('g', {
        tasks: [
          { id: 'a', title: 'HTML', files: ['index.html'] },
          { id: 'b', title: 'CSS in html', files: ['index.html'], dependsOn: ['a'] },
          { id: 'c', title: 'JS', files: ['app.js'], dependsOn: ['b'] }
        ]
      })
    )
    expect(p.tasks.map((t) => t.id)).toEqual(['a', 'c'])
    expect(p.tasks[0].description).toContain('CSS in html')
    expect(p.tasks[1].dependsOn).toEqual(['a'])
  })
  it('leaves independent tasks alone', () => {
    const plan = normalizePlan('g', { tasks: [{ id: 'a', title: 'A', files: ['a.js'] }, { id: 'b', title: 'B', files: ['b.js'] }] })
    expect(enforceFileOwnership(plan)).toBe(plan)
  })
})

import { routeTasks } from './orchestrator'
describe('router', () => {
  it('spreads ready tasks across all workers before doubling up', () => {
    const tasks = [
      { owner: 'bee', dependsOn: [] as string[] },
      { owner: 'bee', dependsOn: [] as string[] },
      { owner: 'bee', dependsOn: [] as string[] },
      { owner: 'bee', dependsOn: ['x'] }
    ]
    routeTasks(tasks, ['bee', 'wasp', 'ant'])
    expect(tasks.slice(0, 3).map((t) => t.owner).sort()).toEqual(['ant', 'bee', 'wasp'])
    expect(tasks[3].owner).toBeDefined()
  })
})

describe('file ownership keeps parallel work parallel', () => {
  it('splits a shared index.html: first task owns it, others stay separate and get wired in', () => {
    const p = enforceFileOwnership(
      normalizePlan('snake', {
        tasks: [
          { id: 'loop', title: 'Game loop', files: ['index.html', 'game.js'] },
          { id: 'score', title: 'Score', files: ['index.html', 'score.js'] },
          { id: 'over', title: 'Game over', files: ['index.html', 'over.js'] }
        ]
      })
    )
    expect(p.tasks.map((t) => t.id)).toEqual(['loop', 'score', 'over'])
    expect(p.tasks[0].files).toEqual(['index.html', 'game.js'])
    expect(p.tasks[1].files).toEqual(['score.js'])
    expect(p.tasks[0].description).toContain('must load these files made by other agents: score.js, over.js')
    expect(p.tasks[1].description).toContain('do not edit them')
  })
})

import { splitForParallelism } from './scheduler'
describe('router splits work for idle workers', () => {
  it('turns one 3-file task into 3 parallel per-file tasks with a shared contract', () => {
    const plan = normalizePlan('snake', { tasks: [{ id: 'snake', title: 'Snake game', description: 'canvas id "game"', files: ['index.html', 'game.js', 'style.css'] }] })
    const p = splitForParallelism(plan, 3)
    expect(p.tasks.map((t) => t.files[0])).toEqual(['index.html', 'game.js', 'style.css'])
    expect(p.tasks.every((t) => t.dependsOn.length === 0)).toBe(true)
    expect(p.tasks[0].description).toContain('index.html must load: game.js, style.css')
    expect(p.tasks[1].description).toContain('You write ONLY game.js')
  })
  it('leaves plans alone when every worker already has a task', () => {
    const plan = normalizePlan('g', { tasks: [{ id: 'a', title: 'A', files: ['a.js', 'b.js'] }, { id: 'c', title: 'C', files: ['c.js'] }] })
    expect(splitForParallelism(plan, 2)).toBe(plan)
  })
})

import { parallelizeWithContract } from './scheduler'
describe('router runs disjoint tasks at once', () => {
  it('drops chained deps and adds a team contract + page wiring', () => {
    const plan = normalizePlan('snake', {
      tasks: [
        { id: 'loop', title: 'Game loop', files: ['game.js', 'index.html'] },
        { id: 'score', title: 'Score', files: ['score.js'], dependsOn: ['loop'] },
        { id: 'theme', title: 'Theme', files: ['style.css'], dependsOn: ['loop', 'score'] }
      ]
    })
    const p = parallelizeWithContract(plan)
    expect(p.tasks.every((t) => t.dependsOn.length === 0)).toBe(true)
    expect(p.tasks[0].description).toContain('index.html must load: score.js, style.css')
    expect(p.tasks[2].description).toContain('- score.js: Score')
  })
  it('gives every task the element ids and globals any task names (Groq Snake: #game vs gameCanvas)', () => {
    const plan = normalizePlan('snake', {
      tasks: [
        { id: 'html', title: 'Page', files: ['index.html'], description: 'Contains <canvas id="game"></canvas>, a #score div and a #restart button; calls window.game.reset().' },
        { id: 'js', title: 'Logic', files: ['game.js'], description: 'Defines the game loop and rendering.' }
      ]
    })
    const js = parallelizeWithContract(plan).tasks.find((t) => t.id === 'js')!.description
    expect(js).toContain('#game, #score, #restart')
    expect(js).toContain('window.game')
  })
})

import { normalizeWriteArgs } from './tools'
import { fileFromReply, filesFromReply, withRetry } from './orchestrator'
describe('worker robustness (Snake test failures)', () => {
  it('accepts write_file argument-name variants and defaults the path for one-file tasks', () => {
    expect(normalizeWriteArgs({ file: 'style.css', content: 'x' })).toEqual({ path: 'style.css', content: 'x' })
    expect(normalizeWriteArgs({ f: 'a.js', code: '```js\nlet a\n```' })).toEqual({ path: 'a.js', content: 'let a' })
    expect(normalizeWriteArgs({ content: 'only content' }, 'index.html')).toEqual({ path: 'index.html', content: 'only content' })
  })
  it('takes a pasted code block / raw HTML as the file for a one-file task', () => {
    expect(fileFromReply('Here is game.js:\n```javascript\nconst canvas = document.getElementById("c")\n```', 'game.js')).toContain('getElementById')
    expect(fileFromReply('<!DOCTYPE html><html><body>hi there friends</body></html> done', 'index.html')).toBe('<!DOCTYPE html><html><body>hi there friends</body></html>')
    expect(fileFromReply('I finished the task.', 'game.js')).toBeNull()
  })
  it('saves each file a several-file task pastes into its reply (local 7B fix-up round lost 80 min to this)', () => {
    const reply = [
      '### Step 1: Fix the canvas id in `index.html`',
      '```html\n<!DOCTYPE html>\n<html><body><canvas id="gameCanvas"></canvas><script src="game.js"></script></body></html>\n```',
      'Now update **game.js**:',
      '```javascript\nconst canvas = document.getElementById("gameCanvas")\nwindow.game = {}\n```',
      'And a helper you might like:',
      '```javascript\nfunction unused() { return 42 + 1 }\n```'
    ].join('\n')
    const got = filesFromReply(reply, ['game.js', 'index.html', 'style.css'])
    expect(Object.keys(got).sort()).toEqual(['game.js', 'index.html'])
    expect(got['index.html']).toContain('gameCanvas')
    expect(got['game.js']).toContain('window.game') // named in the text before it; the unnamed extra block is not the file
    expect(filesFromReply('```js game.js\nconst a = 1; const b = 2; const c = 3\n```', ['game.js', 'ui.js'])).toEqual({ 'game.js': 'const a = 1; const b = 2; const c = 3\n' })
    expect(filesFromReply('```javascript\nconst a = 1; const b = 2; const c = 3\n```', ['game.js', 'ui.js'])).toEqual({}) // two .js files: can't tell which
    expect(filesFromReply('All fixed, nothing to change.', ['game.js', 'index.html'])).toEqual({})
  })
  it('retries transient model errors like "fetch failed", not real ones', async () => {
    let n = 0
    const ok = await withRetry(async () => (++n < 2 ? Promise.reject(new Error('fetch failed')) : 'ok'), new AbortController().signal, undefined, 3)
    expect(ok).toBe('ok')
    await expect(withRetry(async () => Promise.reject(new Error('Model request failed (400): bad')), new AbortController().signal)).rejects.toThrow('400')
  }, 15000)
})

import { executeTool } from './tools'
import { mkdtempSync as mkd, readFileSync as rf, existsSync as ex } from 'node:fs'
import { tmpdir as td } from 'node:os'
describe('ownership + messy write args (Snake run 3)', () => {
  it('falls back to the task file when the path is a folder like "./" and accepts "s" as content', () => {
    expect(normalizeWriteArgs({ path: './', content: 'x' }, 'style.css')).toEqual({ path: 'style.css', content: 'x' })
    expect(normalizeWriteArgs({ f: 'game.js', s: 'let g' })).toEqual({ path: 'game.js', content: 'let g' })
    expect(normalizeWriteArgs({ path: './game.js', content: 'x' })).toEqual({ path: 'game.js', content: 'x' })
  })
  it('refuses writes to files another agent owns', async () => {
    const root = mkd(path.join(td(), 'hive-own-'))
    const ctx = { root, runCommand: async () => '', allowedPaths: ['game.js'] }
    const bad = await executeTool(ctx, 'write_file', { path: 'index.html', content: '<html>' })
    expect(bad.output).toMatch(/belongs to another agent/)
    expect(ex(path.join(root, 'index.html'))).toBe(false)
    const ok = await executeTool(ctx, 'write_file', { path: './game.js', content: 'let g = 1' })
    expect(ok.output).toMatch(/^Wrote/)
    expect(rf(path.join(root, 'game.js'), 'utf8')).toBe('let g = 1')
  })
})

import { writeFileSync as wf } from 'node:fs'
describe('edit_file: change part of a file without re-sending it', () => {
  const setup = (text: string) => {
    const root = mkd(path.join(td(), 'hive-edit-'))
    wf(path.join(root, 'game.js'), text)
    return { root, runCommand: async () => '', allowedPaths: ['game.js'] }
  }
  it('replaces exactly one occurrence', async () => {
    const ctx = setup('let score = 0\nfunction draw() {}\n')
    const r = await executeTool(ctx, 'edit_file', { path: 'game.js', find: 'let score = 0', replace: 'let score = 10' })
    expect(r.output).toMatch(/^Edited game\.js/)
    expect(rf(path.join(ctx.root, 'game.js'), 'utf8')).toBe('let score = 10\nfunction draw() {}\n')
  })
  it('says so when the text is not there', async () => {
    const ctx = setup('let a = 1\n')
    const r = await executeTool(ctx, 'edit_file', { path: 'game.js', find: 'let b', replace: 'x' })
    expect(r.output).toMatch(/^Error: text not found in game\.js; read_file it and copy the exact text/)
  })
  it('refuses an ambiguous edit', async () => {
    const ctx = setup('x()\nx()\n')
    const r = await executeTool(ctx, 'edit_file', { path: 'game.js', find: 'x()', replace: 'y()' })
    expect(r.output).toMatch(/^Error: text appears 2 times/)
    expect(rf(path.join(ctx.root, 'game.js'), 'utf8')).toBe('x()\nx()\n')
  })
  it('refuses files another agent owns', async () => {
    const ctx = setup('a')
    wf(path.join(ctx.root, 'index.html'), '<p>')
    const r = await executeTool(ctx, 'edit_file', { path: 'index.html', find: '<p>', replace: '<div>' })
    expect(r.output).toMatch(/belongs to another agent/)
    expect(rf(path.join(ctx.root, 'index.html'), 'utf8')).toBe('<p>')
  })
})

import { splitOversized } from './scheduler'
describe('plans sized to the team', () => {
  const twoOnOneFile = () =>
    normalizePlan('visual', {
      tasks: [
        { id: 'logic', title: 'Graph logic', description: 'window.vp API', files: ['app.js'] },
        { id: 'dom', title: 'Rendering', description: 'Draw nodes and wires', files: ['app.js'] }
      ]
    })
  it('keeps two big tasks on one file as part 1 then part 2 when merging them would be too big', () => {
    const p = enforceFileOwnership(twoOnOneFile(), () => false)
    expect(p.tasks.map((t) => t.id)).toEqual(['logic', 'dom'])
    expect(p.tasks[1].files).toEqual(['app.js'])
    expect(p.tasks[1].dependsOn).toEqual(['logic'])
    expect(p.tasks[1].description).toContain('Part 2 of app.js')
  })
  it('still merges them when the merged task fits', () => {
    const p = enforceFileOwnership(twoOnOneFile(), () => true)
    expect(p.tasks.map((t) => t.id)).toEqual(['logic'])
  })
  it('a third part waits for the second, not just the first', () => {
    const plan = normalizePlan('g', {
      tasks: [
        { id: 'a', title: 'A', files: ['app.js'] },
        { id: 'b', title: 'B', files: ['app.js'] },
        { id: 'c', title: 'C', files: ['app.js'] }
      ]
    })
    const p = enforceFileOwnership(plan, () => false)
    expect(p.tasks.map((t) => [t.id, t.dependsOn])).toEqual([['a', []], ['b', ['a']], ['c', ['b']]])
  })
  it('the parallel contract keeps the order between parts of one file and drops the rest', () => {
    const plan = normalizePlan('g', {
      tasks: [
        { id: 'a', title: 'A', files: ['app.js'] },
        { id: 'b', title: 'B', files: ['app.js'], dependsOn: ['a'] },
        { id: 'c', title: 'C', files: ['style.css'], dependsOn: ['a'] }
      ]
    })
    const p = parallelizeWithContract(plan)
    expect(p.tasks.find((t) => t.id === 'b')!.dependsOn).toEqual(['a'])
    expect(p.tasks.find((t) => t.id === 'c')!.dependsOn).toEqual([])
  })
  const canFit = (t: { files: string[]; description: string }) => t.files.length <= 1 && !/(^|\n)\s*2\.\s/.test(t.description)
  it('splits an oversized 3-file task into one task per file and re-points what depended on it', () => {
    const plan = normalizePlan('g', {
      tasks: [
        { id: 'game', title: 'Game', description: 'canvas id "game"', files: ['index.html', 'game.js', 'style.css'] },
        { id: 'docs', title: 'Docs', files: ['README.txt'], dependsOn: ['game'] }
      ]
    })
    const p = splitOversized(plan, canFit)
    expect(p.tasks.filter((t) => t.id !== 'docs').map((t) => t.files)).toEqual([['index.html'], ['game.js'], ['style.css']])
    expect(p.tasks.find((t) => t.id === 'docs')!.dependsOn).toHaveLength(3)
  })
  it('splits a one-file task with numbered jobs into parts that run in order', () => {
    const plan = normalizePlan('g', { tasks: [{ id: 'app', title: 'App', description: 'Shared state in window.app.\n1. Graph logic.\n2. Rendering.', files: ['app.js'] }] })
    const p = splitOversized(plan, canFit)
    expect(p.tasks).toHaveLength(2)
    expect(p.tasks[0].description).toContain('Graph logic')
    expect(p.tasks[0].description).toContain('window.app')
    expect(p.tasks[1].description).toContain('Rendering')
    expect(p.tasks[1].dependsOn).toEqual([p.tasks[0].id])
  })
  it('never grows a plan past 12 tasks', () => {
    const tasks = Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, files: [`f${i}.js`] }))
    tasks.push({ id: 'big', title: 'Big', files: ['a.js', 'b.js', 'c.js'] })
    const p = splitOversized(normalizePlan('g', { tasks }), canFit)
    expect(p.tasks.length).toBeLessThanOrEqual(12)
  })
})

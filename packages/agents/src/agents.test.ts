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

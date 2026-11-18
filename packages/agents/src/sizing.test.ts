import { describe, expect, it } from 'vitest'
import type { InstalledModel, PlanTask } from '@hive/shared'
import { capacityOf } from '@hive/models'
import { estimateTask, fits } from './sizing'

const task = (p: Partial<PlanTask>): PlanTask => ({ id: 't', title: 'Task', description: '', files: [], dependsOn: [], ...p })
const model = (p: Partial<InstalledModel>): InstalledModel => ({
  id: 'm', name: 'm', source: 'ollama', model: 'm', tier: 'worker', codingScore: 50, sizeGB: 2, minRamGB: 4, contextTokens: 8192, ...p
})

// The task the free-hosted Visual run produced after enforceFileOwnership merged two planned tasks.
const mergedVisual = task({
  title: 'Implement core graph logic and window.vp API; Implement DOM rendering, dragging, and wiring',
  description:
    '1. Implement core graph logic and window.vp API: Create app.js. Implement window.vp with addNode(type, x, y, value), connect(fromId, toId, inputName), run(), nodes(), edges(), save(), load(json), clear(). run() must perform a topological sort and detect cycles.\n' +
    '2. Implement DOM rendering, dragging, and wiring: Create index.html and style.css with a container div (id="vp-canvas") and an SVG (id="vp-svg") for wires.',
  files: ['app.js', 'index.html', 'style.css']
})

describe('task size estimate', () => {
  it('a stylesheet on its own is small', () => {
    const s = estimateTask(task({ title: 'Style the board', description: 'Colours and layout for the board.', files: ['style.css'] }), {})
    expect(s.size).toBe('small')
    expect(s.parts).toBe(1)
  })
  it('the merged Visual task is large, with two jobs in it', () => {
    const s = estimateTask(mergedVisual, {})
    expect(s.parts).toBe(2)
    expect(s.size).toBe('large')
  })
  it('a chess engine counts as hard', () => {
    const s = estimateTask(task({ title: 'Chess engine', description: 'Legal move generation and a minimax search for the chess AI.', files: ['engine.js'] }), {})
    expect(s.hard).toBeGreaterThanOrEqual(2)
    expect(s.size).toBe('large')
  })
  it('an empty task from a sloppy plan is medium and does not throw', () => {
    const s = estimateTask(task({ files: [], description: '' }), {})
    expect(s.size).toBe('medium')
  })
  it('editing an existing file counts its size', () => {
    const s = estimateTask(task({ description: 'Fix the score.', files: ['game.js'] }), { 'game.js': 20000 })
    expect(s.outputTokens).toBeGreaterThanOrEqual(5000)
    expect(s.inputTokens).toBeGreaterThanOrEqual(5000)
  })
})

describe('does a task fit a model', () => {
  const small = estimateTask(task({ title: 'Style', description: 'Colours.', files: ['style.css'] }), {})
  it('a 2 GB local model can do a small task but not the merged Visual task', () => {
    expect(fits(small, capacityOf(model({ sizeGB: 2 })))).toBe(true)
    expect(fits(estimateTask(mergedVisual, {}), capacityOf(model({ sizeGB: 2 })))).toBe(false)
  })
  it('Qwen3.8 on Groq (1,000 output tokens a minute) cannot write a 1,200-token file', () => {
    const qwen = capacityOf(model({ source: 'groq', sizeGB: 0, contextTokens: 131072, codingScore: 70, limits: { inputPerMinute: 7000, outputPerMinute: 1000 } }))
    const mid = estimateTask(task({ description: 'Game loop with update(), draw(), reset(), spawn(), collide().', files: ['game.js', 'index.html'] }), {})
    expect(mid.outputTokens).toBeGreaterThan(1200)
    expect(fits(mid, qwen)).toBe(false)
    expect(fits(small, qwen)).toBe(true)
  })
  it('hard work needs a model with coding skill 70+', () => {
    const hard = estimateTask(task({ title: 'Physics', description: 'Collision and physics engine.', files: ['physics.js'] }), {})
    expect(fits(hard, capacityOf(model({ source: 'groq', sizeGB: 0, contextTokens: 131072, codingScore: 60 })))).toBe(false)
    expect(fits(hard, capacityOf(model({ source: 'groq', sizeGB: 0, contextTokens: 131072, codingScore: 82 })))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import type { InstalledModel, PlanTask } from '@hive/shared'
import { capacityOf } from '@hive/models'
import { estimateTask } from './sizing'
import { pickWorker, type PoolWorker } from './routing'

const m = (id: string, p: Partial<InstalledModel> = {}): InstalledModel => ({
  id, name: id, source: 'ollama', model: id, tier: 'worker', codingScore: 50, sizeGB: 2, minRamGB: 4, contextTokens: 8192, ...p
})
const w = (name: string, model: InstalledModel, busy = false): PoolWorker => ({ name, model, busy })
const task = (p: Partial<PlanTask>): PlanTask => ({ id: 't', title: 'T', description: '', files: [], dependsOn: [], ...p })

const tiny = m('llama3.2:3b', { sizeGB: 2, codingScore: 40 })
const coder7 = m('qwen2.5-coder:7b', { sizeGB: 4.7, codingScore: 62 })
const oss120 = m('groq-gpt-oss-120b', { source: 'groq', sizeGB: 0, contextTokens: 131072, codingScore: 82, limits: { inputPerMinute: 8000 } })
const qwen = m('groq-qwen3.8-27b', { source: 'groq', sizeGB: 0, contextTokens: 131072, codingScore: 70, limits: { inputPerMinute: 7000, outputPerMinute: 1000 } })

const small = estimateTask(task({ title: 'Style', description: 'Colours.', files: ['style.css'] }), {})
const large = estimateTask(task({ title: 'Engine', description: 'Physics and collision: step(), integrate(), collide(), resolve(), broadphase(), raycast(), sleep(), wake(), joints(), springs(), friction(), restitution(), gravity(), forces(), impulses(), contacts(), manifold(), solver(), island(), query() in physics.js.', files: ['physics.js'] }), {})
const cap = (x: InstalledModel) => capacityOf(x)

describe('router: each task goes to a model that can do it', () => {
  it('a small task goes to the weakest model that fits, keeping strong ones free', () => {
    const p = pickWorker(small, [w('bee', oss120), w('wasp', tiny)], cap)
    expect('worker' in p && p.worker.name).toBe('wasp')
  })
  it('a large task skips a small local model and takes gpt-oss 120B', () => {
    const p = pickWorker(large, [w('bee', tiny), w('wasp', oss120)], cap)
    expect('worker' in p && p.worker.name).toBe('wasp')
  })
  it('a large task waits for the only model that can do it when that model is busy', () => {
    const p = pickWorker(large, [w('bee', tiny), w('wasp', oss120, true)], cap)
    expect('wait' in p).toBe(true)
  })
  it('with one model, that model gets everything and the log says why', () => {
    const p = pickWorker(large, [w('bee', tiny)], cap)
    expect('worker' in p && p.worker.name).toBe('bee')
    expect(p.reason).toMatch(/no model on the team/i)
  })
  it('when nothing fits, waits for the strongest model instead of giving it to a weaker free one', () => {
    const p = pickWorker(large, [w('bee', tiny), w('wasp', coder7, true)], cap)
    expect('wait' in p).toBe(true)
  })
  it('Qwen3.8 on Groq (1,000 output tokens a minute) gets small jobs only', () => {
    const mid = estimateTask(task({ description: 'Game loop with update(), draw(), reset(), spawn(), collide().', files: ['game.js', 'index.html'] }), {})
    const s = pickWorker(small, [w('ant', qwen)], cap)
    expect('worker' in s && s.worker.name).toBe('ant')
    const p = pickWorker(mid, [w('ant', qwen), w('bee', oss120)], cap)
    expect('worker' in p && p.worker.name).toBe('bee')
  })
  it('prefers the local model that is already loaded over swapping in another', () => {
    const other = m('phi4-mini', { sizeGB: 2.4, codingScore: 62 })
    const p = pickWorker(small, [w('bee', other), w('wasp', coder7)], cap, { loadedLocal: 'qwen2.5-coder:7b' })
    expect('worker' in p && p.worker.name).toBe('wasp')
  })
  it('keeps the planned owner when the owner can do the task', () => {
    const p = pickWorker(small, [w('bee', tiny), w('wasp', oss120)], cap, { prefer: 'wasp' })
    expect('worker' in p && p.worker.name).toBe('wasp')
    const q = pickWorker(large, [w('bee', tiny), w('wasp', oss120)], cap, { prefer: 'bee' })
    expect('worker' in q && q.worker.name).toBe('wasp')
  })
})

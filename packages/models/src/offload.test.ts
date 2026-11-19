import { describe, expect, it } from 'vitest'
import { offloadMessage, slowLocalModel } from './offload'

const gb = 1024 ** 3

describe('local model running on the processor', () => {
  it('flags a model that is mostly on the CPU (other apps held the 6 GB GPU: 9 of 29 layers fit, under 1 token a second)', () => {
    const s = slowLocalModel([{ name: 'qwen2.5-coder:7b', size: 5.8 * gb, size_vram: 2.03 * gb }])
    expect(s).toEqual({ model: 'qwen2.5-coder:7b', cpuPercent: 65 })
    expect(offloadMessage(s!)).toMatch(/65% on the processor/)
    expect(offloadMessage(s!)).toMatch(/graphics card/)
  })
  it('stays quiet when most of the model is on the GPU, or nothing is loaded', () => {
    expect(slowLocalModel([{ name: 'a', size: 5 * gb, size_vram: 4.5 * gb }])).toBeNull()
    expect(slowLocalModel([])).toBeNull()
    expect(slowLocalModel([{ name: 'a', size: 0, size_vram: 0 }])).toBeNull()
  })
  it('reports the worst of several loaded models', () => {
    const s = slowLocalModel([
      { name: 'a', size: 4 * gb, size_vram: 1 * gb },
      { name: 'b', size: 4 * gb, size_vram: 0 }
    ])
    expect(s).toEqual({ model: 'b', cpuPercent: 100 })
  })
})

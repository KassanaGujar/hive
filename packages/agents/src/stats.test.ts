import { describe, expect, it } from 'vitest'
import type { InstalledModel } from '@hive/shared'
import { capacityOf } from '@hive/models'
import { learnedCapacity, recordOutcome, type ModelStats } from './stats'
import { fits, type TaskSize } from './sizing'

const size = (outputTokens: number, s: TaskSize['size']): TaskSize => ({ outputTokens, inputTokens: 300, parts: 1, hard: 0, size: s })
const oss: InstalledModel = { id: 'oss', name: 'oss', source: 'groq', model: 'oss', tier: 'lead', codingScore: 70, sizeGB: 0, minRamGB: 0, contextTokens: 131072 }

describe('learning what each model can handle', () => {
  it('two failed large tasks stop the router giving that model large tasks; smaller ones still fit', () => {
    let stats: ModelStats = {}
    stats = recordOutcome(stats, 'oss', { size: 'large', outputTokens: 3000, ok: false })
    expect(fits(size(3000, 'large'), capacityOf(oss, learnedCapacity(stats.oss)))).toBe(true)
    stats = recordOutcome(stats, 'oss', { size: 'large', outputTokens: 3400, ok: false })
    const cap = capacityOf(oss, learnedCapacity(stats.oss))
    expect(fits(size(3000, 'large'), cap)).toBe(false)
    expect(fits(size(2000, 'medium'), cap)).toBe(true)
  })
  it('a later success at that size lifts the cap', () => {
    let stats: ModelStats = {}
    stats = recordOutcome(stats, 'oss', { size: 'large', outputTokens: 3000, ok: false })
    stats = recordOutcome(stats, 'oss', { size: 'large', outputTokens: 3000, ok: false })
    stats = recordOutcome(stats, 'oss', { size: 'large', outputTokens: 3200, ok: true })
    expect(learnedCapacity(stats.oss).maxOutput).toBeUndefined()
  })
  it('limits learned from provider errors are kept with the stats', () => {
    const stats: ModelStats = { oss: { ok: { small: 0, medium: 0, large: 0 }, failed: { small: 0, medium: 0, large: 0 }, learned: { outputPerMinute: 1000 } } }
    expect(learnedCapacity(stats.oss).outputPerMinute).toBe(1000)
    expect(learnedCapacity(undefined)).toEqual({})
  })
})

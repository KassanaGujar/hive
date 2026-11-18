import { describe, expect, it } from 'vitest'
import { combineReviews, reviewBudgetChars, splitDiff } from './review'
import { capacityOf } from '@hive/models'
import type { InstalledModel } from '@hive/shared'

const fileDiff = (f: string, n: number) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -0,0 +1 @@\n+${'x'.repeat(n)}\n`

describe('reviews sized to the lead', () => {
  const qwen: InstalledModel = { id: 'q', name: 'q', source: 'groq', model: 'q', tier: 'lead', codingScore: 70, sizeGB: 0, minRamGB: 0, contextTokens: 131072, limits: { inputPerMinute: 7000, outputPerMinute: 1000 } }
  it('a lead capped at 7,000 input tokens a minute gets well under 28,000 chars per review', () => {
    const b = reviewBudgetChars(capacityOf(qwen), 1200)
    expect(b).toBeLessThanOrEqual(24000)
    expect(b + 1200).toBeLessThanOrEqual(7000 * 4)
  })
  it('keeps a small diff as one review', () => {
    const d = fileDiff('a.js', 100) + fileDiff('b.js', 100)
    expect(splitDiff(d, 24000)).toEqual([d])
  })
  it('splits a 40,000-char diff by file into chunks under the budget', () => {
    const d = ['a.js', 'b.js', 'c.js', 'd.js'].map((f) => fileDiff(f, 10000)).join('')
    const chunks = splitDiff(d, 20000)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(20000)
    expect(chunks.join('')).toContain('b/d.js')
  })
  it('cuts one file bigger than the budget and says so', () => {
    const chunks = splitDiff(fileDiff('huge.js', 50000), 20000)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].length).toBeLessThanOrEqual(20000)
    expect(chunks[0]).toMatch(/rest of this diff not shown/)
  })
  it('approves only if every part is approved, and keeps each part\'s notes', () => {
    expect(combineReviews([{ approved: true, notes: 'ok' }, { approved: true, notes: 'fine' }]).approved).toBe(true)
    const r = combineReviews([{ approved: true, notes: 'ok' }, { approved: false, notes: 'b.js: score never resets' }])
    expect(r.approved).toBe(false)
    expect(r.notes).toContain('score never resets')
  })
})

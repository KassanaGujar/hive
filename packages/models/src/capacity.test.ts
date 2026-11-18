import { describe, expect, it } from 'vitest'
import type { InstalledModel } from '@hive/shared'
import { capacityOf, limitsFromError, replyTokensFor } from './capacity'

const m = (p: Partial<InstalledModel>): InstalledModel => ({
  id: 'x', name: 'x', source: 'ollama', model: 'x', tier: 'worker', codingScore: 50, sizeGB: 4, minRamGB: 8, contextTokens: 8192, ...p
})

describe('model capacity (what a model can handle per task)', () => {
  it('sizes local models by file size and caps their context like the Ollama endpoint does', () => {
    expect(capacityOf(m({ sizeGB: 2 })).maxOutput).toBe(1500)
    expect(capacityOf(m({ sizeGB: 4.7 })).maxOutput).toBe(3000)
    expect(capacityOf(m({ sizeGB: 9 })).maxOutput).toBe(6144)
    expect(capacityOf(m({ contextTokens: 32768 })).contextTokens).toBe(16384)
    expect(capacityOf(m({ contextTokens: 0 })).contextTokens).toBe(8192)
  })
  it('hosted models keep their context; per-minute caps clamp the reply size', () => {
    const qwen = m({ source: 'groq', sizeGB: 0, contextTokens: 131072, codingScore: 70, limits: { inputPerMinute: 7000, outputPerMinute: 1000 } })
    const c = capacityOf(qwen)
    expect(c.contextTokens).toBe(131072)
    expect(c.maxOutput).toBe(1000)
    expect(c.inputPerMinute).toBe(7000)
    expect(c.skill).toBe(70)
    expect(capacityOf(m({ source: 'groq', sizeGB: 0 })).inputPerMinute).toBe(Infinity)
  })
  it('a limit learned from a provider error wins over the catalog', () => {
    const c = capacityOf(m({ source: 'groq', sizeGB: 0, limits: { outputPerMinute: 1000 } }), { outputPerMinute: 600 })
    expect(c.maxOutput).toBe(600)
  })
  it('asks for a reply no bigger than the provider allows (Groq refused max_tokens 6144 at 1,000 a minute)', () => {
    expect(replyTokensFor(capacityOf(m({ source: 'groq', sizeGB: 0, limits: { outputPerMinute: 1000 } })))).toBeLessThanOrEqual(1000)
    expect(replyTokensFor(capacityOf(m({ source: 'groq', sizeGB: 0 })))).toBe(6144)
    expect(replyTokensFor(capacityOf(m({ sizeGB: 2 })))).toBe(6144)
  })
  it('reads the limits out of real Groq error messages', () => {
    expect(limitsFromError("Request too large for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Requested 1246.")).toEqual({ outputPerMinute: 1000 })
    expect(limitsFromError('Request too large for model on input tokens per minute (ITPM): Limit 7000, Requested 8009, please reduce')).toEqual({ inputPerMinute: 7000 })
    expect(limitsFromError('Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 9100')).toEqual({ inputPerMinute: 8000 })
    expect(limitsFromError('boom')).toBeNull()
  })
})

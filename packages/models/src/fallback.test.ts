import { describe, expect, it } from 'vitest'
import { afterModelError } from './fallback'

describe('what to do when a model call fails', () => {
  it('a briefly rate-limited model is retried twice, then the task moves to another model instead of failing', () => {
    // Gemma on OpenRouter: "temporarily rate-limited upstream" failed a whole Pathfinding task.
    expect(afterModelError('busy', 0)).toEqual({ action: 'wait', ms: 15000 })
    expect(afterModelError('busy', 1)).toEqual({ action: 'wait', ms: 30000 })
    expect(afterModelError('busy', 2)).toEqual({ action: 'switch', restMs: 5 * 60_000 })
  })
  it('broken tool calls are asked again twice, then another model takes over', () => {
    // gpt-oss 20B: "Failed to parse tool call arguments as JSON" three times failed a task.
    expect(afterModelError('bad-tool', 0)).toEqual({ action: 'retry' })
    expect(afterModelError('bad-tool', 1)).toEqual({ action: 'retry' })
    expect(afterModelError('bad-tool', 2)).toEqual({ action: 'switch', restMs: 0 })
  })
  it('out of daily quota or too large switches at once; anything else fails', () => {
    expect(afterModelError('quota', 0)).toEqual({ action: 'switch', restMs: 6 * 60 * 60_000 })
    expect(afterModelError('too-big', 0)).toEqual({ action: 'switch', restMs: 0 })
    expect(afterModelError(null, 0)).toEqual({ action: 'fail' })
  })
})

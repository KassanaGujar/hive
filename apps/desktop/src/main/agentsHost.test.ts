import { describe, expect, it } from 'vitest'
import type { ChatChunk } from '@hive/shared'
import { chatResultFrom } from './agentsHost'

describe('reading a model reply', () => {
  it('stops a reply that is stuck repeating itself, keeps one copy, and stops pulling from the model', async () => {
    const unit = 'ctx.fillRect(food.x * size, food.y * size, size, size)\nctx.fillStyle = "red"\n'
    let pulled = 0
    let closed = false
    async function* stream(): AsyncGenerator<ChatChunk> {
      try {
        yield { text: 'function draw() {\n' }
        for (let i = 0; i < 5000; i++) {
          pulled++
          yield { text: unit }
        }
      } finally {
        closed = true
      }
    }
    const r = await chatResultFrom(stream())
    expect(pulled).toBeLessThan(200)
    expect(closed).toBe(true)
    expect(r.text.startsWith('function draw() {\n')).toBe(true)
    expect(r.text.length).toBeLessThan(200)
    expect(r.stoppedLooping).toBe(true)
  })
  it('passes a normal reply through untouched', async () => {
    async function* stream(): AsyncGenerator<ChatChunk> {
      yield { text: 'hello ' }
      yield { text: 'world', tokensPerSec: 12 }
    }
    const r = await chatResultFrom(stream())
    expect(r).toEqual({ text: 'hello world', toolCalls: undefined, tokensPerSec: 12 })
  })
})

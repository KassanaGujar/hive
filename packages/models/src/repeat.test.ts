import { describe, expect, it } from 'vitest'
import { loopingTail } from './repeat'

describe('a reply stuck repeating itself', () => {
  it('spots a block repeated over and over at the end and says where the first copy ends', () => {
    const head = 'function draw() {\n  ctx.clearRect(0, 0, w, h)\n}\n'
    const unit = 'snake.push({ x: head.x + dx, y: head.y + dy })\nif (hit(head)) gameOver()\n'
    const text = head + unit.repeat(40)
    const cut = loopingTail(text)!
    // keeps everything before the loop plus one copy (the repeat may start a character early when the head ends like a copy)
    expect(text.slice(0, cut).startsWith(head.slice(0, -1))).toBe(true)
    expect(cut).toBeGreaterThanOrEqual(head.length + unit.length - 2)
    expect(cut).toBeLessThanOrEqual(head.length + unit.length)
  })
  it('leaves normal code alone, including a repetitive level map', () => {
    const row = '  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],\n'
    const map = `const bricks = [\n${row.repeat(12)}]\n`
    expect(loopingTail(map)).toBeNull()
    const code = Array.from({ length: 200 }, (_, i) => `const v${i} = compute(${i}) * ${i % 7}\n`).join('')
    expect(loopingTail(code)).toBeNull()
    expect(loopingTail('')).toBeNull()
  })
  it('needs at least 5 copies (4 identical paragraphs is still a reply)', () => {
    const unit = 'x'.repeat(10) + ' a sentence that goes on for a while to make the unit long enough to matter here.\n'.repeat(6)
    expect(loopingTail('start\n' + unit.repeat(4))).toBeNull()
    expect(loopingTail('start\n' + unit.repeat(6))).not.toBeNull()
  })
})

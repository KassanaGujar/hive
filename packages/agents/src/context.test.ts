import { describe, expect, it } from 'vitest'
import { buildWorkerContext, interfaceSummary } from './context'

const gameJs = `const canvas = document.getElementById('game')
window.game = { score: 0 }
function update(dt) {
  window.game.score += 1
}
function draw(ctx) {}
class Snake {}
const reset = () => {}
`

describe('worker context sized to the model', () => {
  it('summarises another file as the names a worker needs to call it', () => {
    const s = interfaceSummary(gameJs, 'game.js')
    expect(s).toContain('function update(dt)')
    expect(s).toContain('function draw(ctx)')
    expect(s).toContain('class Snake')
    expect(s).toContain('reset')
    expect(s).toContain('window.game =')
    expect(s).toContain('#game')
    expect(s).not.toContain('score += 1')
  })
  it('lists the element ids an HTML page defines', () => {
    expect(interfaceSummary('<canvas id="board"></canvas><button id="restart">', 'index.html')).toMatch(/#board.*#restart|#restart.*#board/s)
  })
  const others = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`lib${i}.js`, gameJs.repeat(20)]))
  const input = {
    owned: { 'style.css': 'body { margin: 0 }' },
    others,
    fileList: Array.from({ length: 200 }, (_, i) => `src/file${i}.js`),
    prd: 'PRD: ' + 'requirements '.repeat(500)
  }
  it('a small budget keeps the owned file and stays inside the budget', () => {
    const c = buildWorkerContext(input, 2000)
    expect(c.length).toBeLessThanOrEqual(8000)
    expect(c).toContain('body { margin: 0 }')
    expect(c).not.toContain('PRD:')
  })
  it('a big budget also gets the plan document', () => {
    const c = buildWorkerContext(input, 100000)
    expect(c).toContain('PRD:')
    expect(c).toContain('function update(dt)')
  })
  it('a huge owned file is cut to the budget with a note to read the rest', () => {
    const c = buildWorkerContext({ owned: { 'game.js': 'x'.repeat(50000) }, others: {}, fileList: ['game.js'] }, 2000)
    expect(c.length).toBeLessThanOrEqual(8000)
    expect(c).toContain('read_file game.js')
  })
})

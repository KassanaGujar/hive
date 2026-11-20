import { describe, expect, it } from 'vitest'
import { buildCodeMap, queryCodeMap, relatedFiles, QUERY_BUDGET_TOKENS } from './codemap'

const files = {
  'index.html': '<html><body><canvas id="board"></canvas>\n<script src="js/game.js"></script>\n<script type="module" src="js/main.js"></script></body></html>',
  'js/main.js': "import { Game } from './game.js'\nimport { draw } from './render'\nconst g = new Game()\ndraw(g)\n",
  'js/game.js': 'export class Game {\n  constructor() { this.score = 0 }\n}\nexport function step(game, dt) {\n  game.score += dt\n}\n',
  'js/render.js': "export const draw = (game) => {\n  const c = document.getElementById('board')\n}\n",
  'js/unused.js': 'function lonely() {}\n',
  'server.py': 'from utils import helper\n\ndef handle(req):\n    return helper(req)\n',
  'utils.py': 'def helper(x):\n    return x\n'
}

describe('code map', () => {
  it('finds definitions with their file and line', () => {
    const map = buildCodeMap(files)
    const names = map.defs.map((d) => `${d.name}@${d.file}:${d.line}`)
    expect(names).toEqual(expect.arrayContaining(['Game@js/game.js:1', 'step@js/game.js:4', 'draw@js/render.js:1', 'handle@server.py:3', 'helper@utils.py:1', 'board@index.html:1']))
  })

  it('resolves imports, script tags and python imports into file edges', () => {
    const map = buildCodeMap(files)
    expect([...(map.deps.get('js/main.js') ?? [])].sort()).toEqual(['js/game.js', 'js/render.js'])
    expect([...(map.deps.get('index.html') ?? [])].sort()).toEqual(['js/game.js', 'js/main.js'])
    expect([...(map.deps.get('server.py') ?? [])]).toEqual(['utils.py'])
  })

  it('ranks the files a task touches: what it imports and what imports it come before unrelated files', () => {
    const order = relatedFiles(buildCodeMap(files), ['js/main.js'])
    expect(order).not.toContain('js/main.js')
    expect(order.slice(0, 3).sort()).toEqual(['index.html', 'js/game.js', 'js/render.js'])
    expect(order.indexOf('js/unused.js')).toBeGreaterThan(2)
  })

  it('answers a query with the definition, a snippet and where it is used', () => {
    const out = queryCodeMap(buildCodeMap(files), 'step')
    expect(out).toContain('js/game.js:4')
    expect(out).toContain('game.score += dt')
    const game = queryCodeMap(buildCodeMap(files), 'Game')
    expect(game).toMatch(/Used in:.*js\/main\.js/)
  })

  it('stays within its budget and says when nothing matches', () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 400; i++) big[`f${i}.js`] = `function thing${i}() {\n${'  x()\n'.repeat(40)}}\n`
    const out = queryCodeMap(buildCodeMap(big), 'thing')
    expect(out.length).toBeLessThanOrEqual(QUERY_BUDGET_TOKENS * 4 + 200)
    expect(out).toMatch(/more matches/)
    expect(queryCodeMap(buildCodeMap(files), 'nothingLikeThis')).toMatch(/No definition/)
  })
})

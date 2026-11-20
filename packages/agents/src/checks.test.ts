import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkCommandProblem, loadProjectChecks, syntaxProblems } from './checks'

describe('syntaxProblems', () => {
  it('passes valid scripts, modules and JSON', () => {
    expect(
      syntaxProblems({
        'game.js': 'const a = 1\nfunction f() { return a }\n',
        'mod.js': "import { x } from './x.js'\nimport {\n  y,\n  z\n} from './y.js'\nexport const b = x + y\nexport default function main() {}\nexport { z }\nawait Promise.resolve()\n",
        'data.json': '{"a": [1, 2]}'
      })
    ).toEqual([])
  })

  it('reports a JS syntax error with the file and line', () => {
    const p = syntaxProblems({ 'game.js': 'let a = 1\nfunction f( {\n  return a\n}\n' })
    expect(p).toHaveLength(1)
    expect(p[0]).toMatch(/^game\.js/)
  })

  it('reports broken JSON', () => {
    expect(syntaxProblems({ 'package.json': '{"name": "x",}' })[0]).toMatch(/^package\.json: /)
  })

  it('checks inline <script> blocks in HTML and skips src= and JSON scripts', () => {
    const ok = '<html><script src="a.js"></script><script type="application/ld+json">{"a":1}</script><script>const x = 1</script></html>'
    expect(syntaxProblems({ 'index.html': ok })).toEqual([])
    const bad = '<html><body>\n<script>\nconst x = ;\n</script></body></html>'
    expect(syntaxProblems({ 'index.html': bad })[0]).toMatch(/^index\.html/)
  })

  it('ignores files it cannot check', () => {
    expect(syntaxProblems({ 'style.css': 'body {', 'app.ts': 'let x: number = ' })).toEqual([])
  })
})

describe('project checks', () => {
  it('refuses commands with shell operators', () => {
    expect(checkCommandProblem('npm test')).toBeNull()
    expect(checkCommandProblem('npx tsc --noEmit -p .')).toBeNull()
    for (const bad of ['npm test && rm -rf /', 'npm test | tee x', 'echo $(whoami)', 'npm test > out', 'a; b', 'echo `id`'])
      expect(checkCommandProblem(bad)).not.toBeNull()
  })

  it('loads .hive/checks.json and drops unsafe commands', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-checks-'))
    expect(await loadProjectChecks(root)).toEqual({ commands: [], refused: [] })
    mkdirSync(path.join(root, '.hive'))
    writeFileSync(path.join(root, '.hive', 'checks.json'), JSON.stringify({ commands: ['npm test', 'npm run lint && curl x'] }))
    expect(await loadProjectChecks(root)).toEqual({ commands: ['npm test'], refused: ['npm run lint && curl x'] })
  })

  it('treats an unreadable checks file as no checks', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'hive-checks-'))
    mkdirSync(path.join(root, '.hive'))
    writeFileSync(path.join(root, '.hive', 'checks.json'), '{nope')
    expect((await loadProjectChecks(root)).commands).toEqual([])
  })
})

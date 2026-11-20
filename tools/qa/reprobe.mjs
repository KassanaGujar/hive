// Re-run a challenge's probe on a game that was already built (after a probe is fixed), without building it again.
//   node tools/qa/reprobe.mjs <challenge id> <folder with index.html>
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO } from './lib.mjs'
import { CHALLENGES } from './challenges.mjs'

const [id, dir] = process.argv.slice(2)
const c = CHALLENGES.find((x) => x.id === id)
if (!c || !dir || !existsSync(path.join(dir, 'index.html'))) {
  console.log('usage: node tools/qa/reprobe.mjs <challenge id> <folder with index.html>')
  process.exit(1)
}
const pf = path.join(dir, '.probe.js'), of = path.join(dir, '.probe-out.json')
rmSync(of, { force: true })
writeFileSync(pf, c.probe)
spawnSync(process.execPath, [path.join(REPO, 'node_modules/electron/cli.js'), path.join(REPO, 'tools/qa/pagecheck.cjs'), pf, of], { timeout: 120000, stdio: 'ignore', env: { ...process.env, PAGECHECK_URL: pathToFileURL(path.join(dir, 'index.html')).href } })
const out = existsSync(of) ? JSON.parse(readFileSync(of, 'utf8')) : { result: { _run: 'probe produced no output' }, errors: [] }
let pass = 0
for (const item of c.items) {
  const v = out.result?.[item]
  if (v === true) pass++
  console.log(`${v === true ? 'PASS' : 'FAIL'}  ${item}${v === true ? '' : ` — ${v ?? 'not checked'}`}`)
}
if (out.result?.probeError) console.log('probe error:', out.result.probeError)
if (out.errors?.length) console.log('page errors:', out.errors.slice(0, 3).join(' | '))
console.log(`${c.title}: ${pass}/${c.items.length}`)

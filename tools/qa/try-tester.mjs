// Try the play-tester on a game that is already built, without Hive:
//   node tools/qa/try-tester.mjs <plain challenge id> <folder with index.html> [how many messages, default all]
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PLAIN } from './plain-challenges.mjs'
import { playtest } from './tester.mjs'
import { SCRATCH } from './lib.mjs'

const [id, dir, upto] = process.argv.slice(2)
const c = PLAIN.find((x) => x.id === id)
if (!c || !dir) {
  console.log('usage: node tools/qa/try-tester.mjs <id> <folder with index.html> [messages]')
  process.exit(1)
}
const turns = c.turns.slice(0, Number(upto ?? c.turns.length))
const r = await playtest(pathToFileURL(path.join(dir, 'index.html')).href, turns.map((t) => t.say), turns.flatMap((t) => t.checks), { shotsDir: `${SCRATCH}/plain-shots/try-${id}` })
for (const [k, v] of Object.entries(r.verdicts)) console.log(`${v.pass === true ? 'PASS' : 'FAIL'}  ${k} — ${v.why}`)
console.log('tester:', r.notes)
if (r.errors.length) console.log('page errors:', r.errors.join(' | '))

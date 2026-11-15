// Reads docs/qa/results.jsonl (latest result per test wins) and prints a per-phase summary.
//   node tools/qa/summarize.mjs [phase]
import { readFileSync, existsSync } from 'node:fs'
import { OUT } from './lib.mjs'
const f = `${OUT}/results.jsonl`
if (!existsSync(f)) { console.log('no results yet'); process.exit(0) }
const latest = new Map()
for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line)
  latest.set(`${r.phase}|${r.name}`, r)
}
const want = process.argv[2]
const rows = [...latest.values()].filter((r) => !want || r.phase === want)
const by = {}
for (const r of rows) (by[r.phase] ??= []).push(r)
for (const [phase, list] of Object.entries(by).sort()) {
  const c = (s) => list.filter((r) => r.status === s).length
  console.log(`\n${phase}: ${c('PASS')} pass, ${c('FAIL')} fail, ${c('BLOCKED')} blocked`)
  for (const r of list) console.log(`  ${r.status.padEnd(7)} ${r.name}${r.detail ? ' — ' + r.detail.slice(0, 200) : ''}`)
}
export { latest }

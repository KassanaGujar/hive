// The AI team against one agent, per challenge, from out/challenges-team.json. Runs recorded with
// QA_COORDINATION=single / off carry " single" / " solo" in their key; each is paired with the same key without it.
//   node tools/qa/compare-coordination.mjs
import { existsSync, readFileSync } from 'node:fs'
import { OUT } from './lib.mjs'

const file = `${OUT}/challenges-team.json`
if (!existsSync(file)) {
  console.log(`No results yet (${file}). Run run-challenges-team.mjs with QA_COORDINATION=team, single and off.`)
  process.exit(0)
}
const all = JSON.parse(readFileSync(file, 'utf8'))
const passed = (r) => (r?.final ? Object.values(r.final).filter((v) => v === true).length : 0)
const total = (r) => (r?.final ? Object.keys(r.final).length : 0)
const cell = (r) => (r ? `${passed(r)}/${total(r)} ${r.minutes ?? '?'}m calls ${r.metrics?.modelCalls ?? '?'}` : '-')
const SUFFIX = / (solo|single)$/
const groups = new Map()
for (const key of Object.keys(all)) {
  const base = key.replace(SUFFIX, '')
  if (!groups.has(base)) groups.set(base, {})
  groups.get(base)[SUFFIX.exec(key)?.[1] ?? 'team'] = all[key]
}
const rows = [...groups].filter(([, g]) => g.solo || g.single)
if (!rows.length) {
  console.log('No single or solo runs recorded yet. Run: QA_COORDINATION=single node tools/qa/run-challenges-team.mjs <ids>')
  process.exit(0)
}
const wins = { team: 0, single: 0, solo: 0 }
console.log(`${'challenge'.padEnd(28)} ${'team'.padEnd(26)} ${'single (+checks)'.padEnd(26)} solo (nothing else)`)
for (const [name, g] of rows) {
  const scores = Object.entries(g).map(([k, r]) => [k, passed(r)])
  const best = Math.max(...scores.map(([, s]) => s))
  const top = scores.filter(([, s]) => s === best)
  if (top.length === 1) wins[top[0][0]]++
  console.log(`${name.padEnd(28)} ${cell(g.team).padEnd(26)} ${cell(g.single).padEnd(26)} ${cell(g.solo)}`)
}
console.log(`\nOutright best: team ${wins.team}, single ${wins.single}, solo ${wins.solo}, of ${rows.length} challenge(s) (ties not counted).`)

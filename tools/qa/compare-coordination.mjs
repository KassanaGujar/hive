// The AI team against one agent alone, per challenge, from out/challenges-team.json. Runs recorded with
// QA_COORDINATION=off carry " solo" in their tag; each is paired with the same challenge and tag without it.
//   node tools/qa/compare-coordination.mjs
import { existsSync, readFileSync } from 'node:fs'
import { OUT } from './lib.mjs'

const file = `${OUT}/challenges-team.json`
if (!existsSync(file)) {
  console.log(`No results yet (${file}). Run run-challenges-team.mjs with and without QA_COORDINATION=off.`)
  process.exit(0)
}
const all = JSON.parse(readFileSync(file, 'utf8'))
const passed = (r) => (r?.final ? Object.values(r.final).filter((v) => v === true).length : 0)
const total = (r) => (r?.final ? Object.keys(r.final).length : 0)
const cell = (r) => (r ? `${passed(r)}/${total(r)} ${r.minutes ?? '?'}m calls ${r.metrics?.modelCalls ?? '?'} tools ${r.metrics?.toolCalls ?? '?'}` : '-')
const rows = []
for (const key of Object.keys(all)) {
  if (!/[ @]solo$/.test(key)) continue
  const teamKey = key.replace(/[ @]solo$/, '')
  rows.push({ challenge: teamKey, team: all[teamKey], solo: all[key] })
}
if (!rows.length) {
  console.log('No solo runs recorded yet. Run: QA_COORDINATION=off node tools/qa/run-challenges-team.mjs <ids>')
  process.exit(0)
}
let teamWins = 0, soloWins = 0
for (const r of rows) {
  const t = passed(r.team), s = passed(r.solo)
  if (r.team && t > s) teamWins++
  if (s > t) soloWins++
  console.log(`${r.challenge.padEnd(28)} team: ${cell(r.team).padEnd(40)} solo: ${cell(r.solo)}`)
  if (r.team?.metrics) console.log(`${''.padEnd(28)} team checks failed ${r.team.metrics.checkFailures}, reviews sent back ${r.team.metrics.reviewRejections}`)
}
console.log(`\nTeam scored higher on ${teamWins}, alone scored higher on ${soloWins}, of ${rows.length} challenge(s).`)

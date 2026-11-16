// Builds docs/qa-report.md from the recorded results (docs/qa/*.json[l]) plus the hand-written analysis in
// tools/qa/report-notes.mjs (bugs, weaknesses, scores, recommendations). Run: node tools/qa/report.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { OUT, REPO } from './lib.mjs'
import { NOTES } from './report-notes.mjs'

const read = (f, d) => (existsSync(path.join(OUT, f)) ? JSON.parse(readFileSync(path.join(OUT, f), 'utf8')) : d)
const history = new Map()
for (const line of (existsSync(`${OUT}/results.jsonl`) ? readFileSync(`${OUT}/results.jsonl`, 'utf8') : '').split('\n').filter(Boolean)) {
  const r = JSON.parse(line)
  const k = `${r.phase}|${r.name}`
  ;(history.get(k) ?? history.set(k, []).get(k)).push(r)
}
const results = [...history.values()].map((l) => ({ ...l.at(-1), everFailed: l.some((r) => r.status === 'FAIL') }))
const PHASES = { P1: 'Core functionality', P2: 'Multiplayer collaboration', P3: 'AI / vibe coding', P4: 'Code execution', P5: 'Performance & stress', P6: 'Challenges: beginner', P7: 'Challenges: intermediate', P8: 'Challenges: advanced', P9: 'Collaborative challenges', P10: '30-minute challenge' }
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const perf = read('perf.json', {})
const soak = read('soak.json', [])
const challenges = read('challenges.json', {})
const phase9 = read('phase9.json', {})

let md = `# Hive — QA & Stress Test Report\n\n_Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from \`docs/qa/results.jsonl\` (latest result per test) and the phase logs. Test machine: ${NOTES.machine}_\n\n`
md += `## 1. Summary\n\n${NOTES.summary}\n\n| Phase | Passed | Failed | Blocked |\n|---|---|---|---|\n`
for (const [p, name] of Object.entries(PHASES)) {
  const l = results.filter((r) => r.phase === p)
  if (!l.length) { md += `| ${name} | – | – | not run |\n`; continue }
  md += `| ${name} | ${l.filter((r) => r.status === 'PASS').length} | ${l.filter((r) => r.status === 'FAIL').length} | ${l.filter((r) => r.status === 'BLOCKED').length} |\n`
}
md += `\nThe item-by-item checklist (every line of the plan) is \`docs/qa-checklist.md\`.\n\n`

md += `## 2. Passed tests\n\n`
for (const [p, name] of Object.entries(PHASES)) {
  const l = results.filter((r) => r.phase === p && r.status === 'PASS')
  if (!l.length) continue
  md += `### ${name}\n` + l.map((r) => `- ${r.name}${r.everFailed ? ' _(passed after a fix)_' : ''}${r.detail ? ` — ${esc(r.detail).slice(0, 200)}` : ''}`).join('\n') + '\n\n'
}
md += `## 3. Failed tests\n\n` + (results.filter((r) => r.status === 'FAIL').map((r) => `- **[${PHASES[r.phase] ?? r.phase}] ${r.name}** — ${esc(r.detail).slice(0, 300)}`).join('\n') || '_None._') + '\n\n'
md += `## 4. Blocked tests and why\n\n` + ([...results.filter((r) => r.status === 'BLOCKED').map((r) => `- **${r.name}** — ${esc(r.detail)}`), ...NOTES.blocked.map((b) => `- **${b.name}** — ${b.why}`)].join('\n') || '_None._') + '\n\n'
md += `## 5. Bugs discovered\n\n| # | Bug | Found by | Severity | Status |\n|---|---|---|---|---|\n` + NOTES.bugs.map((b, i) => `| ${i + 1} | ${esc(b.bug)} | ${esc(b.foundBy)} | ${b.severity} | ${b.fixed ? 'Fixed' : 'Open'} |`).join('\n') + '\n\n'
md += `## 6. Bugs fixed\n\n` + NOTES.bugs.filter((b) => b.fixed).map((b) => `- **${b.bug}** — ${b.fix}`).join('\n') + '\n\n'
md += `## 7. Unresolved bugs\n\n` + (NOTES.bugs.filter((b) => !b.fixed).map((b) => `- **${b.bug}** — ${b.fix ?? ''}`).join('\n') || '_None._') + '\n\n'

md += `## 8. Performance measurements\n\n`
const row = (label, v) => (v === undefined ? '' : `| ${label} | ${v} |\n`)
md += `| Measurement | Result |\n|---|---|\n`
md += row('Open project: 100 / 500 / 1,000 files', perf.open_100_files ? `${perf.open_100_files.openMs} / ${perf.open_500_files?.openMs} / ${perf.open_1000_files?.openMs} ms` : undefined)
md += row('Search 1,000 files', perf.open_1000_files ? `${perf.open_1000_files.searchMs} ms` : undefined)
md += row('Typing latency (p95): 1k / 10k / 100k-line file', perf['file_lines1000.js'] ? `${perf['file_lines1000.js'].typing.p95} / ${perf['file_lines10000.js']?.typing.p95} / ${perf['file_huge.js']?.typing.p95} ms` : undefined)
md += row('Open 100k-line (4.5 MB) file', perf['file_huge.js'] ? `${perf['file_huge.js'].openMs} ms` : undefined)
md += row('200 tab switches', perf.switch_200 !== undefined ? `${perf.switch_200} ms` : undefined)
md += row('Memory (all Hive processes)', perf.memory ? `${perf.memory.rssMB} MB RSS, renderer heap ${perf.memory.rendererHeapMB} MB` : undefined)
md += row('Idle CPU', perf.idle_cpu_pct !== undefined ? `${perf.idle_cpu_pct}% of one core` : undefined)
md += row('Idle network requests (60 s)', perf.idle_requests_60s)
md += row('Disk writes for 100 keystrokes (solo)', perf.autosave_writes_100_keys)
md += row('Shared-state file rewrites while typing', perf.shared_state_rewrites ? `${perf.shared_state_rewrites.writes} × ${perf.shared_state_rewrites.sizeKB} KB in 10 s` : undefined)
for (const r of results.filter((x) => /latency|response time|Synchronization with/.test(x.name))) md += `| ${esc(r.name)} | ${esc(r.detail)} |\n`
md += '\n' + NOTES.performanceNotes + '\n\n'

md += `## 9. Collaboration stress-test results\n\n`
for (const r of results.filter((x) => x.phase === 'P2' && /five|ten|twenty|300 marked|exact same|relay/.test(x.name))) md += `- **${r.name}**: ${r.status} — ${esc(r.detail)}\n`
if (soak.length) {
  md += `\n**Soak test** (2 people typing non-stop, ${soak.at(-1).minute} min):\n\n| Minute | Edits sent | Sync latency median | Renderer heap A/B | App RSS A/B | Relay RSS |\n|---|---|---|---|---|---|\n`
  for (const s of soak) md += `| ${s.minute} | ${s.sentA + s.sentB} | ${s.latMs[2]} ms | ${s.heapA}/${s.heapB} MB | ${s.rssA}/${s.rssB} MB | ${s.relay?.mb ?? '?'} MB |\n`
}
md += '\n' + NOTES.collabNotes + '\n\n'

md += `## 10. Coding challenge results\n\n`
if (Object.keys(challenges).length) {
  md += `| Challenge | Features working | AI rounds | Bugs the AI introduced (features that failed at some point) |\n|---|---|---|---|\n`
  for (const c of Object.values(challenges)) {
    const f = Object.values(c.final ?? {})
    md += `| ${c.title} | ${f.filter((x) => x === true).length}/${f.length} | ${c.rounds?.length ?? 0} | ${c.bugsFound ?? '?'} |\n`
  }
  md += '\n'
  for (const c of Object.values(challenges)) {
    const failing = Object.entries(c.final ?? {}).filter(([, v]) => v !== true)
    if (failing.length) md += `**${c.title}** — not working: ${failing.map(([k, v]) => `${k} (${esc(v).slice(0, 90)})`).join('; ')}\n\n`
  }
}
if (Object.keys(phase9).length) {
  md += `**Collaborative challenges (two people, each with their own AI):**\n\n| Pair | Tess wrote | Omar wrote | Rounds | Working on Tess / Omar |\n|---|---|---|---|---|\n`
  for (const [k, r] of Object.entries(phase9)) md += `| ${k} | ${r.tessFiles.join(', ') || '–'} | ${r.omarFiles.join(', ') || '–'} | ${r.rounds} | ${r.passT}/${r.total} · ${r.passO}/${r.total} |\n`
}
md += '\n' + NOTES.challengeNotes + '\n\n'
md += `## 11. Architectural weaknesses\n\n` + NOTES.weaknesses.map((w) => `- ${w}`).join('\n') + '\n\n'
md += `## 12. Recommendations\n\n` + NOTES.recommendations.map((w, i) => `${i + 1}. ${w}`).join('\n') + '\n\n'
md += `## Final quality assessment (Phase 11)\n\n| Category | Score | Why |\n|---|---|---|\n` + NOTES.scores.map((s) => `| ${s.category} | ${s.score} | ${s.why} |`).join('\n')
const avg = Math.round(NOTES.scores.reduce((a, s) => a + s.score, 0) / NOTES.scores.length)
md += `\n| **Overall** | **${avg}** | average of the ten categories |\n\n**Weakest categories:** ${[...NOTES.scores].sort((a, b) => a.score - b.score).slice(0, 3).map((s) => `${s.category} (${s.score})`).join(', ')}.\n`
writeFileSync(path.join(REPO, 'docs', 'qa-report.md'), md)
console.log('wrote docs/qa-report.md', md.length, 'chars')

// Ticks docs/qa-checklist.md from docs/qa/results.jsonl (latest result per test wins).
//   [x] passed   [!] failed because of an app bug, fixed, re-passed   [F] failing   [~] blocked   [ ] not run
// Run after every test batch:  node tools/qa/sync-checklist.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { OUT, REPO } from './lib.mjs'

const CHECKLIST = path.join(REPO, 'docs', 'qa-checklist.md')
const PHASE_OF_HEADING = [[/^## PHASE (\d+)/, (m) => 'P' + m[1]]]
import { ALIAS, FIXED } from './checklist-aliases.mjs'
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\(.*?\)/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !['the', 'and', 'that', 'are', 'can', 'with', 'for', 'its', 'what', 'happens'].includes(w)))

const history = new Map()
if (existsSync(`${OUT}/results.jsonl`)) {
  for (const line of readFileSync(`${OUT}/results.jsonl`, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line)
    const k = `${r.phase}|${r.name}`
    ;(history.get(k) ?? history.set(k, []).get(k)).push(r)
  }
}
const results = [...history.values()].map((list) => ({ ...list.at(-1), everFailed: list.some((r) => r.status === 'FAIL') }))

/** Best result for a checklist line within its phase (word overlap; challenge items are "<title> — <item>"). */
function match(phase, section, text) {
  if (ALIAS[text]) {
    // 'P3|name' points at a result recorded in another phase
    const [ph, nm] = ALIAS[text].includes('|') ? ALIAS[text].split('|') : [phase, ALIAS[text]]
    return results.find((r) => r.phase === ph && r.name === nm) ?? null
  }
  const tw = words(text)
  let best = null, score = 0
  for (const r of results) {
    if (r.phase !== phase) continue
    let name = r.name
    if (section) {
      if (!name.startsWith(section + ' — ')) continue
      name = name.slice(section.length + 3)
    } else if (/ — /.test(name) && /^\d+\. /.test(name)) continue
    if (norm(name) === norm(text)) return r
    const rw = words(name)
    const inter = [...tw].filter((w) => rw.has(w)).length
    const s = inter / Math.max(tw.size, rw.size)
    if (s > score) { score = s; best = r }
  }
  return score >= 0.6 ? best : null
}

const lines = readFileSync(CHECKLIST, 'utf8').split(/\r?\n/)
let phase = null, section = null
const counts = {}
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  const h = /^## PHASE (\d+)/.exec(l)
  if (h) { phase = 'P' + h[1]; section = null; continue }
  if (/^## /.test(l)) { phase = null; section = null; continue }
  const s = /^### (\d+\. .+)$/.exec(l)
  if (s) { section = s[1].trim(); continue }
  const item = /^- \[(.)\] (.+?)( — .*)?$/.exec(l)
  if (!item || !phase) continue
  const text = item[2]
  const r = match(phase, section, text)
  if (!r) continue
  let mark = r.status === 'PASS' ? (r.everFailed && FIXED[r.name] ? '!' : 'x') : r.status === 'BLOCKED' ? '~' : 'F'
  let note = ''
  if (mark === '!') note = ` — fixed: ${FIXED[r.name]}`
  else if (mark === 'F' || mark === '~') note = ` — ${r.detail.slice(0, 220)}`
  else if (r.detail && /\d/.test(r.detail)) note = ` — ${r.detail.slice(0, 160)}`
  lines[i] = `- [${mark}] ${text}${note}`
  counts[phase] ??= { x: 0, '!': 0, F: 0, '~': 0 }
  counts[phase][mark]++
}
writeFileSync(CHECKLIST, lines.join('\n'))
for (const [p, c] of Object.entries(counts)) console.log(`${p}: ${c.x} passed, ${c['!']} fixed+passed, ${c.F} failing, ${c['~']} blocked`)

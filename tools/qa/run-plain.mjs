// Plain-language challenges through Hive, the way a person uses it: one short message, the AI builds it, the person
// tries it and sends a follow-up into the same project. After each message an AI play-tester (tools/qa/tester.mjs)
// uses the app through the screen only and judges plain checks. Results: docs/qa/plain-results.json.
//   node tools/qa/run-plain.mjs [id ...]
// QA_COORDINATION: auto (default: what a user gets), team, single or off. QA_TAG labels the model setup.
import { writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs'
import path from 'node:path'
import { Hive, record, wait, freshDir, OUT, SCRATCH } from './lib.mjs'
import { PLAIN } from './plain-challenges.mjs'
import { playtest } from './tester.mjs'

const RUN_TIMEOUT_MS = Number(process.env.QA_TEAM_TIMEOUT ?? 180 * 60000)
const COORD = ['off', 'single', 'team'].includes(process.env.QA_COORDINATION) ? process.env.QA_COORDINATION : 'auto'
process.env.HIVE_COORDINATION = COORD
const TAG = [process.env.QA_TAG, COORD].filter(Boolean).join(' ')
const only = process.argv.slice(2)
const list = PLAIN.filter((c) => !only.length || only.includes(c.id))

const a = await new Hive(process.env.QA_PROFILE ?? 'team', 9460).launch({ keep: !!process.env.QA_PROFILE })
await a.profileAs('Tess')
{
  const end = Date.now() + 60000
  let prev, stable = 0
  while (Date.now() < end && stable < 3) {
    const cur = await a.invoke('project:current')
    stable = cur === prev ? stable + 1 : 0
    prev = cur
    await wait(2000)
  }
}
const team = await a.invoke('agents:team')
const teamDesc = `architect ${team.architect?.name ?? '-'}, workers ${team.workers.map((m) => m.name).join('/') || '-'}`
console.log('team:', teamDesc, '| coordination:', COORD)
const file = `${OUT}/plain-results.json`
const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}

async function waitPhase(runId, phases, ms) {
  const end = Date.now() + ms
  let run
  while (Date.now() < end) {
    for (const ap of await a.invoke('agents:approvals')) if (ap.runId === runId) await a.invoke('agents:approveCommand', ap.id, true)
    run = (await a.invoke('agents:runs')).find((r) => r.id === runId)
    if (run && (phases.includes(run.phase) || ['failed', 'cancelled'].includes(run.phase))) return run
    await wait(5000)
  }
  return run
}

/** One message to the AI team, approved like a user would: plan OK, then merge OK. */
async function build(say) {
  const runId = await a.invoke('agents:start', say)
  let run = await waitPhase(runId, ['awaiting-plan-approval'], 30 * 60000)
  if (run?.phase !== 'awaiting-plan-approval') throw new Error('no plan: ' + (run?.phase ?? 'timeout') + ' ' + (run?.error ?? ''))
  await a.invoke('agents:approvePlan', runId, true)
  run = await waitPhase(runId, ['awaiting-merge-approval', 'done'], RUN_TIMEOUT_MS)
  if (run?.phase === 'awaiting-merge-approval') {
    await a.invoke('agents:approveMerge', runId, true)
    run = await waitPhase(runId, ['done'], 10 * 60000)
  }
  if (run?.phase !== 'done') {
    await a.invoke('agents:stop', runId).catch(() => {})
    const why = [run?.error, ...(run?.tasks ?? []).flatMap((t) => (t.log ?? []).slice(-2))].filter(Boolean).join(' | ')
    throw new Error('did not finish: ' + (run?.phase ?? 'timeout') + ' ' + why)
  }
  return run.metrics
}

// An outage or a used-up plan is not the app failing: stop instead of recording zeros (the first plain run lost
// 13 of 16 messages to "can't reach the API server" and "you've hit your session limit").
const OUTAGE = /session limit|usage limit|rate limit|ENOTFOUND|reach the API|ECONNRESET|overloaded|fetch failed/i
function stop(where, why, from) {
  console.log(`STOPPED at ${where}: ${String(why).slice(0, 200)}. Earlier results are kept; rerun: node tools/qa/run-plain.mjs ${from.join(' ')}`)
  return a.kill().then(() => process.exit(3))
}

for (const c of list) {
  const dir = freshDir(`plain-${c.id}`)
  await a.invoke('project:open', dir)
  await a.invoke('fs:write', 'README.md', '# My project\n')
  await a.openProject(dir)
  if (path.resolve((await a.invoke('project:current')) ?? '') !== path.resolve(dir)) throw new Error('wrong project open')
  const log = { team: teamDesc, coordination: COORD, turns: [] }
  const said = []
  let checks = []
  let notes = ''
  for (const [i, turn] of c.turns.entries()) {
    said.push(turn.say)
    checks = [...checks, ...turn.checks]
    const t0 = Date.now()
    const entry = { say: turn.say }
    try {
      entry.metrics = await build(turn.say)
    } catch (e) {
      entry.error = String(e.message ?? e).slice(0, 600)
      if (OUTAGE.test(entry.error)) await stop(`[${c.id} #${i + 1}] build`, entry.error, list.slice(list.indexOf(c)).map((x) => x.id))
    }
    // keep every version a person would have seen (the next run of the same id wipes the project folder)
    cpSync(dir, `${SCRATCH}/kept-plain/${c.id}@${TAG.replace(/\s+/g, '-')}/after-message-${i + 1}`, { recursive: true, filter: (p) => !/[\\/](\.git|\.hive|node_modules)([\\/]|$)/.test(p) })
    entry.buildMinutes = Math.round((Date.now() - t0) / 60000)
    const st = await a.invoke('run:start')
    if (st.previewUrl) {
      const t = await playtest(st.previewUrl, said, checks, { shotsDir: `${SCRATCH}/plain-shots/${c.id}-${i + 1}`, notes })
      if (t.outage) await stop(`[${c.id} #${i + 1}] play-test`, t.outage, list.slice(list.indexOf(c)).map((x) => x.id))
      entry.verdicts = t.verdicts
      entry.tester = t.notes
      entry.pageErrors = t.errors
      notes = t.notes
    } else {
      entry.verdicts = Object.fromEntries(checks.map((k) => [k, { pass: false, why: 'nothing to open: ' + (st.message ?? 'no preview') }]))
    }
    await a.invoke('run:stop').catch(() => {})
    entry.score = `${Object.values(entry.verdicts).filter((v) => v.pass === true).length}/${checks.length}`
    log.turns.push(entry)
    console.log(`[${c.id} #${i + 1}] "${turn.say}" → ${entry.score} (${entry.buildMinutes} min build)${entry.error ? ' — ' + entry.error : ''}`)
    all[`${c.id}@${TAG}`] = log
    writeFileSync(file, JSON.stringify(all, null, 1))
  }
  const last = log.turns.at(-1)
  for (const [k, v] of Object.entries(last.verdicts)) record('PLAIN', `${c.id} (${TAG}) — ${k}`, v.pass === true ? 'PASS' : 'FAIL', v.why)
}
await a.kill()
process.exit(0)

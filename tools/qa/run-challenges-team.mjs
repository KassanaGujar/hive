// Coding challenges through Hive's AI TEAM (architect plans → workers build in worktrees → lead reviews →
// integration smoke test → merge), the way a user would press "Build with the AI team". Same briefs and
// probes as run-challenges.mjs. Results are recorded as "<title> (AI team) — <item>".
//   node tools/qa/run-challenges-team.mjs [id ...]
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { Hive, record, assert, wait, freshDir, OUT, REPO } from './lib.mjs'
import { CHALLENGES } from './challenges.mjs'
import { testChatServer } from './chat-probe.mjs'
const RUN_TIMEOUT_MS = Number(process.env.QA_TEAM_TIMEOUT ?? 180 * 60000)
const only = process.argv.slice(2)
// QA_TAG labels a model setup (e.g. "qwen3.5-4b") so its results sit beside, not over, other setups' results.
const TAG = process.env.QA_TAG ? ` ${process.env.QA_TAG}` : ''
const list = CHALLENGES.filter((c) => (only.length ? only.includes(c.id) : c.phase === 'P6'))
// QA_PROFILE=<name>: reuse a kept profile (e.g. 'cloud', which holds the user's free OpenRouter key) instead of a fresh one.
const a = await new Hive(process.env.QA_PROFILE ?? 'team', 9460).launch({ keep: !!process.env.QA_PROFILE })
await a.profileAs('Tess')
// Hive reopens the last project on launch. Let that finish before opening the test project, or it can land afterwards
// and switch the app to a stale folder mid-run (it did: the merge then went to a half-deleted folder with no .git).
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
const teamDesc = `architect ${team.architect?.name ?? '-'}, leads ${team.leads.map((m) => m.name).join('/') || '-'}, workers ${team.workers.map((m) => m.name).join('/') || '-'}`
console.log('team:', teamDesc)
const summaryFile = `${OUT}/challenges-team.json`
const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')) : {}

async function waitPhase(runId, phases, ms) {
  const end = Date.now() + ms
  let run
  while (Date.now() < end) {
    // approve the commands agents ask for (these are throwaway test projects; Hive's policy already blocks dangerous ones)
    for (const ap of await a.invoke('agents:approvals')) if (ap.runId === runId) await a.invoke('agents:approveCommand', ap.id, true)
    run = (await a.invoke('agents:runs')).find((r) => r.id === runId)
    if (run && phases.includes(run.phase)) return run
    if (run && ['failed', 'cancelled'].includes(run.phase)) return run
    await wait(5000)
  }
  return run
}
async function probe(c, dir) {
  if (c.kind === 'server') return testChatServer(a, dir)
  const st = await a.invoke('run:start')
  if (!st.previewUrl) return { result: { _run: st.message ?? 'no preview' }, errors: [] }
  const pf = `${dir}/.probe.js`, of = `${dir}/.probe-out.json`
  writeFileSync(pf, c.probe)
  spawnSync(process.execPath, [path.join(REPO, 'node_modules/electron/cli.js'), path.join(REPO, 'tools/qa/pagecheck.cjs'), pf, of, `${OUT}/team-${c.id}.png`], { timeout: 120000, stdio: 'ignore', env: { ...process.env, PAGECHECK_URL: st.previewUrl } })
  await a.invoke('run:stop')
  return existsSync(of) ? JSON.parse(readFileSync(of, 'utf8')) : { result: { _run: 'probe produced no output' }, errors: [] }
}

for (const c of list) {
  const dir = freshDir(`team-${c.id}`)
  await a.invoke('project:open', dir)
  await a.invoke('fs:write', 'README.md', `# ${c.title}\n`)
  await a.openProject(dir)
  const opened = await a.invoke('project:current')
  if (path.resolve(opened ?? '') !== path.resolve(dir)) throw new Error(`wrong project open: ${opened} (expected ${dir})`)
  const t0 = Date.now()
  const log = { title: c.title, team: teamDesc }
  let runId
  try {
    runId = await a.invoke('agents:start', c.brief)
    let run = await waitPhase(runId, ['awaiting-plan-approval'], 30 * 60000)
    log.plan = run?.tasks?.map((t) => `${t.title}: ${(t.files ?? []).join(', ')}`)
    assert(run?.phase === 'awaiting-plan-approval', 'no plan: ' + (run?.phase ?? 'timeout') + ' ' + (run?.error ?? ''))
    await a.invoke('agents:approvePlan', runId, true)
    run = await waitPhase(runId, ['awaiting-merge-approval', 'done'], RUN_TIMEOUT_MS)
    log.tasks = run?.tasks?.map((t) => ({ title: t.title, status: t.status, reviews: t.reviewRounds }))
    assert(run?.phase === 'awaiting-merge-approval' || run?.phase === 'done', 'team did not finish: ' + (run?.phase ?? 'timeout') + ' ' + (run?.error ?? ''))
    if (run.phase === 'awaiting-merge-approval') {
      await a.invoke('agents:approveMerge', runId, true)
      run = await waitPhase(runId, ['done'], 10 * 60000)
    }
    log.phase = run?.phase
  } catch (e) {
    log.error = String(e.message ?? e).slice(0, 400)
    // A timed-out run kept going and held the one local model: the next two challenges never got a plan (sized-local run).
    if (runId) await a.invoke('agents:stop', runId).catch(() => {})
  }
  log.minutes = Math.round((Date.now() - t0) / 60000)
  const res = log.error ? { result: {}, errors: [] } : await probe(c, dir)
  const final = res.result ?? {}
  if (c.items.includes('The game runs without errors')) final['The game runs without errors'] = !log.error && !final._run && !(res.errors ?? []).length && !final.probeError ? true : String((res.errors ?? [])[0] ?? final.probeError ?? final._run ?? log.error ?? 'not run').slice(0, 200)
  log.final = Object.fromEntries(c.items.map((it) => [it, final[it] === true ? true : final[it] ?? (log.error ? 'team run failed: ' + log.error : 'not checked')]))
  log.probeError = final.probeError
  summary[c.id + (TAG ? '@' + TAG.trim() : '')] = log
  writeFileSync(summaryFile, JSON.stringify(summary, null, 1))
  const pass = c.items.filter((it) => log.final[it] === true).length
  console.log(`[${c.id}] AI team${TAG}: ${pass}/${c.items.length} in ${log.minutes} min${log.error ? ' — ' + log.error : ''}`)
  for (const it of c.items) record(c.phase, `${c.title} (AI team${TAG}) — ${it}`, log.final[it] === true ? 'PASS' : 'FAIL', log.final[it] === true ? `AI team (${teamDesc})` : String(log.final[it]).slice(0, 200))
}
await a.kill()
process.exit(0)

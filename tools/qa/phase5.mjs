// PHASE 5 — performance. Measures the real app; numbers go to docs/qa/perf.json.
import { writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { Hive, check, record, assert, until, wait, freshDir, openFile, OUT, startRelay, share, join } from './lib.mjs'
const P = 'P5'
const perf = {}
const base = freshDir('p5')
const a = await new Hive('p5a', 9441).launch()
await a.profileAs('Tess')

function makeProject(name, nFiles, { depth = 4, lines = 30 } = {}) {
  const dir = `${base}/${name}`
  for (let i = 0; i < nFiles; i++) {
    const sub = Array.from({ length: i % depth }, (_, d) => `d${d}`).join('/')
    const p = `${dir}/src/${sub}`
    mkdirSync(p, { recursive: true })
    writeFileSync(`${p}/file${i}.js`, Array.from({ length: lines }, (_, l) => `export const v${l} = ${i} * ${l} // file ${i} line ${l}`).join('\n') + '\n')
  }
  writeFileSync(`${dir}/index.html`, '<h1>perf</h1>\n')
  return dir
}
async function timeOpen(dir) {
  const t0 = Date.now()
  await a.eval(`await H.actions.openProject(${JSON.stringify(dir)});return 1`)
  const openMs = Date.now() - t0
  const t1 = Date.now()
  const hits = await a.invoke('fs:search', 'line 7', {})
  const searchMs = Date.now() - t1
  const t2 = Date.now()
  const hashes = await a.invoke('fs:hashTree')
  const hashMs = Date.now() - t2
  return { openMs, searchMs, hits: hits.length, hashMs, files: Object.keys(hashes).length }
}
for (const n of [100, 500, 1000]) {
  await check(P, `Open a project with ${n} files`, async () => {
    const r = await timeOpen(makeProject(`files${n}`, n))
    perf[`open_${n}_files`] = r
    assert(r.files >= n, `only ${r.files} files seen`)
    assert(r.openMs < 5000, `open took ${r.openMs} ms`)
    return `open ${r.openMs} ms, search ${r.searchMs} ms (${r.hits} hits), full-tree hash ${r.hashMs} ms`
  })
}
const lp = freshDir('p5/large')
writeFileSync(`${lp}/README.md`, 'x\n')
for (const n of [1000, 10000]) writeFileSync(`${lp}/lines${n}.js`, Array.from({ length: n }, (_, i) => `function f${i}(x) { return x * ${i} + ${i % 7} } // line ${i}`).join('\n') + '\n')
writeFileSync(`${lp}/huge.js`, Array.from({ length: 100000 }, (_, i) => `const big${i} = ${i} // padding padding padding`).join('\n') + '\n')
await a.openProject(lp)
async function typingLatency(rel, n = 200) {
  return a.eval(`const m=H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///${rel}'));H.store.getState().activate('file:${rel}',0);await w(300);const ed=H.monaco.editor.getEditors().find(e=>e.getModel()===m);ed.focus();ed.setPosition({lineNumber:Math.floor(m.getLineCount()/2),column:1});const ts=[];for(let i=0;i<${n};i++){const t=performance.now();ed.trigger('keyboard','type',{text:i%10===9?'\\n':'x'});await new Promise(r=>requestAnimationFrame(()=>r()));ts.push(performance.now()-t)}for(let i=0;i<${n};i++){ed.trigger('keyboard','deleteLeft',null)}ts.sort((a,b)=>a-b);return {p50:+ts[Math.floor(ts.length/2)].toFixed(1),p95:+ts[Math.floor(ts.length*.95)].toFixed(1),max:+ts[ts.length-1].toFixed(1)}`)
}
for (const [rel, label] of [['lines1000.js', 'Open a source file with 1,000 lines'], ['lines10000.js', 'Open a source file with 10,000 lines'], ['huge.js', 'Open a very large source file (100,000 lines, 4.5 MB) and measure editor responsiveness']]) {
  await check(P, label, async () => {
    const t0 = Date.now()
    await openFile(a, rel)
    const openMs = Date.now() - t0
    const lat = await typingLatency(rel)
    perf[`file_${rel}`] = { openMs, typing: lat, bytes: statSync(`${lp}/${rel}`).size }
    assert(lat.p95 < 50, `typing p95 ${lat.p95} ms`)
    return `open ${openMs} ms; keystroke→frame p50 ${lat.p50} ms, p95 ${lat.p95} ms, max ${lat.max} ms`
  })
}
await check(P, 'Rapid typing and deletion', async () => {
  const r = await a.eval(`const m=H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///lines1000.js'));const before=m.getValue();H.store.getState().activate('file:lines1000.js',0);await w(200);const ed=H.monaco.editor.getEditors().find(e=>e.getModel()===m);ed.focus();ed.setPosition({lineNumber:5,column:1});const t=performance.now();for(let i=0;i<3000;i++){ed.trigger('keyboard','type',{text:'q'});if(i%3===2){ed.trigger('keyboard','deleteLeft',null);ed.trigger('keyboard','deleteLeft',null)}}const ms=performance.now()-t;for(let i=0;i<1000;i++)ed.trigger('keyboard','deleteLeft',null);await w(1500);return {ms:Math.round(ms),same:m.getValue()===before}`)
  perf.rapid_typing = r
  assert(r.same, 'text corrupted after rapid type/delete')
  return `3,000 keystrokes + 2,000 deletes in ${r.ms} ms; text intact`
})
await check(P, 'Rapid switching between files', async () => {
  for (const f of ['lines1000.js', 'lines10000.js', 'README.md']) await openFile(a, f)
  const r = await a.eval(`const ids=['file:lines1000.js','file:lines10000.js','file:README.md','file:huge.js'];const t=performance.now();for(let i=0;i<200;i++){H.store.getState().activate(ids[i%4],0);await new Promise(r=>requestAnimationFrame(()=>r()))}return Math.round(performance.now()-t)`)
  perf.switch_200 = r
  assert(r / 200 < 50, `avg ${r / 200} ms per switch`)
  return `200 tab switches in ${r} ms (${(r / 200).toFixed(1)} ms each)`
})
await check(P, 'Rapid project navigation', async () => {
  const dirs = [`${base}/files100`, `${base}/files500`, lp]
  const t = Date.now()
  for (let i = 0; i < 15; i++) await a.eval(`await H.actions.openProject(${JSON.stringify(dirs[i % 3])});return 1`)
  const ms = Date.now() - t
  const root = await a.eval(`return H.store.getState().root`)
  perf.project_nav_15 = ms
  assert(root.replace(/\\/g, '/').endsWith('/large'), 'ended in the wrong project: ' + root)
  return `15 project switches in ${ms} ms`
})
await check(P, 'A project with 50 dependencies', async () => {
  const r = await depsProject('deps50', 50)
  return r
})
await check(P, 'A project with hundreds of dependencies', async () => {
  return depsProject('deps400', 400)
})
async function depsProject(name, n) {
  const dir = `${base}/${name}`
  const deps = {}
  for (let i = 0; i < n; i++) {
    const p = `${dir}/node_modules/pkg-${i}`
    mkdirSync(`${p}/lib`, { recursive: true })
    writeFileSync(`${p}/package.json`, `{"name":"pkg-${i}","version":"1.0.0"}`)
    for (let k = 0; k < 10; k++) writeFileSync(`${p}/lib/m${k}.js`, `module.exports = ${k} // line 7\n`)
    deps[`pkg-${i}`] = '1.0.0'
  }
  writeFileSync(`${dir}/package.json`, JSON.stringify({ name, dependencies: deps }, null, 1))
  writeFileSync(`${dir}/index.js`, 'console.log(1) // line 7\n')
  const r = await timeOpen(dir)
  perf[`deps_${n}`] = r
  assert(r.openMs < 3000, `open took ${r.openMs} ms`)
  assert(r.files < 50, `node_modules files are being scanned/shared (${r.files} files hashed)`)
  return `open ${r.openMs} ms; node_modules (${n * 11} files) skipped by search (${r.hits} hits) and sharing (${r.files} files hashed)`
}
await check(P, 'A project with deeply nested directories (60 levels)', async () => {
  const deep = `${base}/deep`
  let p = deep
  for (let i = 0; i < 60; i++) p += `/level${i}`
  mkdirSync(p, { recursive: true })
  writeFileSync(`${p}/bottom.js`, 'export const bottom = true // line 7\n')
  const r = await timeOpen(deep)
  const flat = JSON.stringify(await a.invoke('fs:tree'))
  assert(flat.includes('bottom.js'), 'deep file missing from tree')
  assert(r.hits >= 1, 'search did not reach the deep file')
  perf.deep60 = r
  return `open ${r.openMs} ms; path length ${p.length} chars works`
})
await check(P, 'Repeated project creation and deletion (20 cycles)', async () => {
  const before = (await a.metrics()).JSHeapUsedSize
  const t = Date.now()
  for (let i = 0; i < 20; i++) {
    const d = await a.invoke('project:create', base, `churn${i}`)
    await a.openProject(d)
    await a.invoke('fs:write', 'x.js', 'x\n')
    await a.eval(`H.actions.closeProject();return 1`)
    await a.invoke('project:delete', d)
  }
  const s = await a.invoke('settings:get')
  const leftovers = s.recentProjects.filter((p) => /churn/.test(p))
  const after = (await a.metrics()).JSHeapUsedSize
  perf.churn20 = { ms: Date.now() - t, heapGrowthMB: +((after - before) / 1e6).toFixed(1) }
  assert(!leftovers.length, 'deleted projects still listed: ' + leftovers)
  assert(![...Array(20).keys()].some((i) => existsSync(`${base}/churn${i}`)), 'folders left behind')
  return `${perf.churn20.ms} ms; renderer heap ${perf.churn20.heapGrowthMB >= 0 ? '+' : ''}${perf.churn20.heapGrowthMB} MB`
})
await check(P, 'Measure project loading time', async () => {
  return `100 files ${perf.open_100_files.openMs} ms · 500 files ${perf.open_500_files.openMs} ms · 1,000 files ${perf.open_1000_files.openMs} ms`
})
await check(P, 'Measure editor responsiveness', async () => {
  return `keystroke→frame p95: 1k lines ${perf['file_lines1000.js'].typing.p95} ms, 10k lines ${perf['file_lines10000.js'].typing.p95} ms, 100k lines ${perf['file_huge.js'].typing.p95} ms`
})
function procStats() {
  try {
    const out = execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*remote-debugging-port=9441*' } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($p){'{0} {1}' -f [math]::Round($p.WorkingSet64/1MB),[math]::Round($p.CPU,1)} }"`).toString()
    const rows = out.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split(' ').map(Number))
    return { processes: rows.length, rssMB: rows.reduce((s, r) => s + r[0], 0), cpuSec: +rows.reduce((s, r) => s + r[1], 0).toFixed(1) }
  } catch (e) { return { error: String(e).slice(0, 100) } }
}
await check(P, 'Monitor memory consumption', async () => {
  const s = procStats()
  const m = await a.metrics()
  perf.memory = { ...s, rendererHeapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1) }
  return `all Hive processes ${s.rssMB} MB RSS (${s.processes} processes); renderer JS heap ${perf.memory.rendererHeapMB} MB`
})
await check(P, 'Monitor CPU consumption (idle 20 s)', async () => {
  const s1 = procStats()
  await wait(20000)
  const s2 = procStats()
  const pct = ((s2.cpuSec - s1.cpuSec) / 20) * 100
  perf.idle_cpu_pct = +pct.toFixed(1)
  assert(pct < 15, `idle CPU ${pct.toFixed(1)}% of one core`)
  return `idle: ${pct.toFixed(1)}% of one core`
})
await check(P, 'Identify unnecessary network requests (60 s idle, solo project)', async () => {
  await a.cdp.send('Network.enable')
  const reqs = []
  const onMsg = (e) => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.url) }
  a.cdp.ws.addEventListener('message', onMsg)
  await wait(60000)
  a.cdp.ws.removeEventListener('message', onMsg)
  const external = reqs.filter((u) => !/^(devtools|data|blob):/.test(u))
  perf.idle_requests_60s = external.length
  const byHost = {}
  for (const u of external) { const h = new URL(u).host; byHost[h] = (byHost[h] ?? 0) + 1 }
  return `${external.length} renderer requests in 60 s idle: ${JSON.stringify(byHost)}`
})
await check(P, 'Identify redundant storage operations (writes while typing)', async () => {
  // solo project: autosave writes; count disk writes for 10 s of typing
  const dir = `${base}/files100`
  await a.openProject(dir)
  await openFile(a, 'index.html')
  const statBefore = statSync(`${dir}/index.html`).mtimeMs
  let writes = 0, last = statBefore
  const typing = a.eval(`const m=H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///index.html'));for(let i=0;i<100;i++){m.pushEditOperations([],[{range:new H.monaco.Range(1,1,1,1),text:'k'}],()=>null);await w(100)}return 1`)
  const end = Date.now() + 12000
  while (Date.now() < end) { const t = statSync(`${dir}/index.html`).mtimeMs; if (t !== last) { writes++; last = t } await wait(50) }
  await typing
  perf.autosave_writes_100_keys = writes
  assert(writes <= 15, `${writes} disk writes for 100 keystrokes`)
  return `${writes} disk writes for 100 keystrokes over 10 s (autosave debounced at 0.9 s)`
})
// shared-mode storage: how often the whole collaboration state file is rewritten
const relay = await startRelay(4474, freshDir('p5-relay'))
await check(P, 'Redundant storage operations in a shared project (state file rewrites)', async () => {
  const dir = `${base}/files500`
  await a.openProject(dir)
  await share(a, relay.url)
  await openFile(a, 'index.html')
  const f = `${dir}/.hive/state.b64`
  await wait(3000)
  let writes = 0, last = statSync(f).mtimeMs
  const size = statSync(f).size
  const typing = a.eval(`const m=H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///index.html'));for(let i=0;i<100;i++){m.pushEditOperations([],[{range:new H.monaco.Range(1,1,1,1),text:'k'}],()=>null);await w(100)}return 1`)
  const end = Date.now() + 14000
  while (Date.now() < end) { const t = statSync(f).mtimeMs; if (t !== last) { writes++; last = t } await wait(50) }
  await typing
  perf.shared_state_rewrites = { writes, sizeKB: Math.round(size / 1024) }
  return `${writes} full rewrites of a ${Math.round(size / 1024)} KB state file during 10 s of typing (debounced 1.5 s; each rewrite re-encodes the whole project)`
})
await relay.stop()
writeFileSync(`${OUT}/perf.json`, JSON.stringify(perf, null, 1))
const errs = a.errors
record(P, 'No uncaught errors during Phase 5', errs.length ? 'FAIL' : 'PASS', [...new Set(errs)].slice(0, 3).join(' | '))
await a.kill()
process.exit(0)

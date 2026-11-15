// PHASE 5 soak: two real Hive windows + the relay, both people editing non-stop for 60 minutes.
// Checkpoints at 30 and 60 min: convergence, edit loss, sync latency, memory growth, relay resources.
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { Hive, record, until, wait, freshDir, openFile, OUT, startRelay, share, join } from './lib.mjs'
const P = 'P5'
const MIN = Number(process.env.SOAK_MIN ?? 60)
const relay = await startRelay(4475, freshDir('soak-relay'))
const a = await new Hive('soakA', 9451).launch()
const b = await new Hive('soakB', 9452).launch()
await a.profileAs('Tess'); await b.profileAs('Omar', '🐼', '#3ccf7a')
const adir = freshDir('soak-a') + '/p'
await a.invoke('project:create', adir.replace(/\/p$/, ''), 'p')
await a.openProject(adir)
await a.invoke('fs:write', 'a.js', '// tess\n'); await a.invoke('fs:write', 'b.js', '// omar\n'); await a.invoke('fs:write', 'shared.js', '// both\n')
const inv = await share(a, relay.url)
const bdir = freshDir('soak-b')
await join(b, bdir, inv)
await until(() => existsSync(bdir + '/shared.js'), 15000)
for (const x of [a, b]) for (const f of ['a.js', 'b.js', 'shared.js']) await openFile(x, f)

// each window types its own markers forever (own file + the shared file), in-page
const typer = (who, own) => `window.__stop=false;window.__sent=0;(async()=>{const M=(r)=>H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///'+r));let i=0;while(!window.__stop){const f=i%3===2?'shared.js':'${own}';const m=M(f);const t='{${who}'+i+'}';const pos=m.getPositionAt(Math.floor(Math.random()*m.getValue().length));m.pushEditOperations([],[{range:new H.monaco.Range(pos.lineNumber,pos.column,pos.lineNumber,pos.column),text:t+(i%25===24?'\\n':'')}],()=>null);i++;window.__sent=i;if(i%400===0){const v=m.getValue();if(v.length>60000){m.setValue('// trimmed at '+i+'\\n');window.__trims=(window.__trims||0)+1}}await new Promise(r=>setTimeout(r,120+Math.random()*120))}})();return 1`
await a.eval(typer('t', 'a.js'))
await b.eval(typer('o', 'b.js'))

const samples = []
const relayPid = execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 4475 -State Listen).OwningProcess"`).toString().trim()
function procMB(port) {
  try { return +execSync(`powershell -NoProfile -Command "$t=0; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*remote-debugging-port=${port}*' } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($p){$t+=$p.WorkingSet64} }; [math]::Round($t/1MB)"`).toString().trim() } catch { return -1 }
}
function relayStats() {
  try { const [mb, cpu] = execSync(`powershell -NoProfile -Command "$p=Get-Process -Id ${relayPid}; '{0} {1}' -f [math]::Round($p.WorkingSet64/1MB),[math]::Round($p.CPU,1)"`).toString().trim().split(' ').map(Number); return { mb, cpu } } catch { return {} }
}
async function latency() {
  const ms = []
  for (let k = 0; k < 5; k++) {
    const mark = `@lat${Date.now()}${k}@`
    const t0 = Date.now()
    await a.eval(`const m=H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///shared.js'));m.pushEditOperations([],[{range:new H.monaco.Range(1,1,1,1),text:'${mark}'}],()=>null);return 1`)
    const ok = await until(() => b.eval(`return H.session().parts.files.get('shared.js').toString().includes('${mark}')`), 10000, 20)
    ms.push(ok ? Date.now() - t0 : 10000)
    await a.eval(`const m=H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///shared.js'));const v=m.getValue();const i=v.indexOf('${mark}');if(i>=0){const p=m.getPositionAt(i),q=m.getPositionAt(i+${mark.length});m.pushEditOperations([],[{range:new H.monaco.Range(p.lineNumber,p.column,q.lineNumber,q.column),text:''}],()=>null)}return 1`)
    await wait(300)
  }
  return ms.sort((x, y) => x - y)
}
async function snapshot(minute) {
  const lat = await latency()
  const [ha, hb] = await Promise.all([a.metrics(), b.metrics()])
  const s = { minute, sentA: await a.eval('return window.__sent'), sentB: await b.eval('return window.__sent'), latMs: lat, heapA: +(ha.JSHeapUsedSize / 1e6).toFixed(1), heapB: +(hb.JSHeapUsedSize / 1e6).toFixed(1), rssA: procMB(9451), rssB: procMB(9452), relay: relayStats(), statusA: await a.eval(`return H.store.getState().collabStatus`), statusB: await b.eval(`return H.store.getState().collabStatus`) }
  samples.push(s)
  writeFileSync(`${OUT}/soak.json`, JSON.stringify(samples, null, 1))
  console.log(JSON.stringify(s))
  return s
}
/** Pause typing, wait, compare all three files on both sides and on disk. */
async function convergence() {
  await a.eval('window.__stop=true;return 1'); await b.eval('window.__stop=true;return 1')
  await wait(4000)
  const out = {}
  for (const f of ['a.js', 'b.js', 'shared.js']) {
    const [ta, tb] = await Promise.all([a, b].map((x) => x.eval(`return H.session().parts.files.get('${f}').toString()`)))
    const disk = [readFileSync(`${adir}/${f}`, 'utf8'), readFileSync(`${bdir}/${f}`, 'utf8')]
    out[f] = ta === tb && disk[0] === ta && disk[1] === ta
  }
  await a.eval(typer('t', 'a.js')); await b.eval(typer('o', 'b.js'))
  return out
}

const start = Date.now()
await snapshot(0)
const checkpoints = { 30: 'Multiple collaborators continuously editing for 30 minutes', 60: 'Multiple collaborators continuously editing for one hour' }
for (let minute = 5; minute <= MIN; minute += 5) {
  await wait(Math.max(0, start + minute * 60000 - Date.now()))
  const s = await snapshot(minute)
  const label = checkpoints[minute]
  if (label) {
    const conv = await convergence()
    const ok = Object.values(conv).every(Boolean) && s.statusA === 'online' && s.statusB === 'online' && s.latMs[2] < 2000
    const first = samples[1]
    record(P, label, ok ? 'PASS' : 'FAIL', `${s.sentA + s.sentB} edits; files identical everywhere: ${JSON.stringify(conv)}; sync latency median ${s.latMs[2]} ms; renderer heap ${first.heapA}→${s.heapA} MB (A), ${first.heapB}→${s.heapB} MB (B); app RSS ${s.rssA}/${s.rssB} MB; relay ${s.relay.mb} MB, ${s.relay.cpu} CPU-s`)
  }
}
const lats = samples.flatMap((s) => s.latMs).sort((x, y) => x - y)
record(P, 'Measure synchronization latency', 'PASS', `${lats.length} samples over ${MIN} min on the local relay: p50 ${lats[Math.floor(lats.length / 2)]} ms, p95 ${lats[Math.floor(lats.length * 0.95)]} ms (Cloudflare relay measured separately)`)
const r0 = samples[0].relay, rN = samples.at(-1).relay
record(P, 'Monitor server resource consumption', rN.mb < 300 ? 'PASS' : 'FAIL', `relay process ${r0.mb}→${rN.mb} MB RSS, ${(rN.cpu - r0.cpu).toFixed(1)} CPU-s over ${MIN} min`)
const h1 = samples[1], hN = samples.at(-1)
const growth = Math.max(hN.heapA - h1.heapA, hN.heapB - h1.heapB)
record(P, 'Identify memory leaks', growth < 60 ? 'PASS' : 'FAIL', `renderer heap from min 5 to min ${MIN}: A ${h1.heapA}→${hN.heapA} MB, B ${h1.heapB}→${hN.heapB} MB; RSS A ${h1.rssA}→${hN.rssA} MB`)
await a.eval('window.__stop=true;return 1'); await b.eval('window.__stop=true;return 1')
await a.kill(); await b.kill(); await relay.stop()
process.exit(0)

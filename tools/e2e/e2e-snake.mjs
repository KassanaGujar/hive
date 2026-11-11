// End-to-end: 3 people ask for Snake in the Planning room → Planner writes the plan (PRD/MVP) →
// Send to agents → router assigns tasks → 3 worker AIs at once → merge → syncs to everyone → runs.
import { writeFileSync, appendFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
const SP = process.argv[2]
const WP = SP.replace(/^\/c\//, 'C:/')
const PEOPLE = { sam: 9351, kim: 9352, ari: 9353 }
const LOG = `${SP}/e2e-snake-log.txt`
writeFileSync(LOG, '')
const log = (s) => { const line = `[${new Date().toLocaleTimeString()}] ${s}`; console.log(line); appendFileSync(LOG, line + '\n') }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((p) => p.type === 'page')
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((r) => (ws.onopen = r))
        let id = 0
        const pending = new Map()
        ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
        const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
        return {
          ws,
          async eval(expr) {
            const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true })
            if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed')
            return r.result?.result?.value
          },
          async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.result.data, 'base64')) }
        }
      }
    } catch {}
    await wait(1000)
  }
  throw new Error(`no app on ${port}`)
}

const H = {
  btn: `const btn=(l)=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===l||b.title===l||b.textContent.trim().startsWith(l));`,
  w: `const w=(ms)=>new Promise(r=>setTimeout(r,ms));`,
  say: `async function say(t){const w=(ms)=>new Promise(r=>setTimeout(r,ms));let i=document.querySelector('input[placeholder="Pitch an idea…"]');if(!i){[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Planning room').click();await w(800);i=document.querySelector('input[placeholder="Pitch an idea…"]')}const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,t);i.dispatchEvent(new Event('input',{bubbles:true}));await w(100);i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await w(300)}`
}

const app = {}
for (const [name, port] of Object.entries(PEOPLE)) app[name] = await connect(port)
log('3 Hive instances connected: Sam (host), Kim, Ari')

// --- profiles + host project
const profiles = { sam: ['Sam', '🦊', '#5aa9ff'], kim: ['Kim', '🐼', '#3ccf7a'], ari: ['Ari', '🦉', '#ff6b8b'] }
for (const [n, [name, avatar, color]] of Object.entries(profiles)) {
  await app[n].eval(`await window.hive.invoke('settings:set',{profile:{name:'${name}',avatar:'${avatar}',color:'${color}'},setupComplete:true,recentProjects:${n === 'sam' ? `['${WP}/snake']` : '[]'}});location.reload();return 1`).catch(() => {})
}
await wait(7000)
app.sam = await connect(PEOPLE.sam); app.kim = await connect(PEOPLE.kim); app.ari = await connect(PEOPLE.ari)

// --- Sam shares via the Team panel (live Cloudflare relay)
const invite = await app.sam.eval(`${H.btn}${H.w}let b;for(let i=0;i<40&&!b;i++){b=btn('Team');if(!b)await w(250)};b.click();await w(800);btn('Share & invite').click();for(let i=0;i<60;i++){const l=[...document.querySelectorAll('input')].map(x=>x.value).find(v=>v.startsWith('hive://'));if(l)return l;await w(250)};return null`)
if (!invite) throw new Error('no invite link')
const u = new URL(invite.replace('hive://', 'https://x/'))
const relay = u.searchParams.get('relay'), room = u.searchParams.get('room'), key = u.hash.slice(1)
log(`Sam shared the project on ${relay} (code ${u.searchParams.get('code')})`)

for (const n of ['kim', 'ari']) {
  await app[n].eval(`const h=window.hive;const dir=await h.invoke('project:create','${WP}/${n}','snake',{empty:true}).catch(()=>'${WP}/${n}/snake');await h.invoke('project:open',dir);await h.invoke('fs:write','.hive/collab.json',JSON.stringify({relayUrl:'${relay}',roomId:'${room}',roomKey:'${key}',projectName:'snake',role:'editor'}));await h.invoke('settings:set',{recentProjects:[dir]});location.reload();return dir`).catch(() => {})
}
await wait(8000)
app.kim = await connect(PEOPLE.kim); app.ari = await connect(PEOPLE.ari)
const online = await app.sam.eval(`return document.body.innerText.match(/Live · \\d+ online/)?.[0]`)
log(`Kim and Ari joined → host status "${online}"`)

// --- each person asks for Snake in the Planning room
const asks = {
  sam: "Let's make a classic Snake game in the browser. Arrow keys move the snake.",
  kim: 'Snake please! Show the score on screen and make the snake grow when it eats food.',
  ari: 'For the snake game: game over when you hit a wall or yourself, with a restart button. Dark theme.'
}
for (const n of ['sam', 'kim', 'ari']) {
  await app[n].eval(`${H.say}await say(${JSON.stringify(asks[n])});return 1`)
  log(`${profiles[n][0]} said in the Planning room: "${asks[n]}"`)
  await wait(1500)
}
await wait(2500)
const seen = await app.sam.eval(`return [...document.querySelectorAll('.whitespace-pre-wrap')].map(e=>e.textContent).filter(t=>/snake/i.test(t)).length`)
log(`Host sees ${seen} snake requests in the shared chat`)

// --- Planner writes the plan doc (PRD/MVP)
log('Planner AI: Update plan…')
await app.sam.eval(`${H.btn}btn('Update plan').click();return 1`)
let plan = null
for (let i = 0; i < 120; i++) {
  await wait(2000)
  const busy = await app.sam.eval(`return !!document.querySelector('.animate-spin')`)
  if (!busy && i > 2) break
}
plan = await app.sam.eval(`return [...document.querySelectorAll('h3')].map(h=>{const sec=h.closest('.mb-5');const vals=[...sec.querySelectorAll('input.bg-transparent:not([placeholder=owner])')].map(i=>i.value);return h.textContent+': '+(vals.length?vals.join(' | '):'(empty)')})`)
log('Plan doc (PRD/MVP) after Planner:\n' + plan.map((l) => '    ' + l).join('\n'))
const traced = await app.sam.eval(`return [...document.querySelectorAll('button')].filter(b=>/^from /.test(b.textContent)).map(b=>b.textContent)`)
log(`Traceability: ${traced.length} items cite chat messages, e.g. "${traced[0] ?? '-'}"`)
await app.sam.shot(`${SP}/snake-1-plan.png`)
const taskCount = plan.find((l) => l.startsWith('Tasks'))?.split(' | ').filter((x) => !x.endsWith('(empty)')).length ?? 0
log(`Tasks in plan doc: ${taskCount}`)

// --- Send to agents → router → 3 workers
await app.sam.eval(`${H.btn}btn('Send to agents').click();return 1`)
log('Sam clicked "Send to agents"')
let run
for (let i = 0; i < 120; i++) {
  await wait(2000)
  run = await app.sam.eval(`return (await window.hive.invoke('agents:runs'))[0]`)
  if (run && run.phase !== 'planning') break
  if (i === 5 && !run) { const toast = await app.sam.eval(`return document.body.innerText.match(/plan is empty[^\n]*/)?.[0]`); if (toast) throw new Error(toast) }
}
if (run.phase !== 'awaiting-plan-approval') throw new Error(`plan phase: ${run.phase} ${run.error ?? ''}`)
log(`Architect/router plan (${run.tasks.length} tasks):`)
for (const t of run.tasks) log(`    • ${t.title} → ${t.owner}  files: ${t.files.join(', ')}  ${t.dependsOn.length ? 'after ' + t.dependsOn.join(',') : '(parallel)'}`)
await app.sam.eval(`${H.btn}${H.w}btn('Agents').click();await w(500);return 1`)
await app.sam.shot(`${SP}/snake-2-routed.png`)
await app.sam.eval(`await window.hive.invoke('agents:approvePlan',(await window.hive.invoke('agents:runs'))[0].id,true);return 1`)
log('Sam approved the plan — workers start')

// --- watch concurrency
let maxBusy = 0, maxBusyNames = []
const t0 = Date.now()
for (let i = 0; i < 600; i++) {
  await wait(2000)
  run = await app.sam.eval(`return (await window.hive.invoke('agents:runs'))[0]`)
  const busy = run.agents.filter((a) => a.role === 'worker' && ['working', 'thinking', 'waiting'].includes(a.status))
  if (busy.length > maxBusy) { maxBusy = busy.length; maxBusyNames = busy.map((a) => `${a.name}:${a.currentTaskId}`); log(`  ${busy.length} workers active at once: ${maxBusyNames.join(', ')}`) }
  if (busy.length === 3 && !existsSync(`${SP}/snake-3-three-at-once.png`)) await app.sam.shot(`${SP}/snake-3-three-at-once.png`)
  for (const a of run.approvals ?? []) {}
  const approvals = await app.sam.eval(`return await window.hive.invoke('agents:approvals')`)
  for (const a of approvals) { log(`  approval asked: ${a.agent} → ${a.command} (denied for the test)`); await app.sam.eval(`await window.hive.invoke('agents:approveCommand','${a.id}',false);return 1`) }
  if (['awaiting-merge-approval', 'failed', 'cancelled', 'done'].includes(run.phase)) break
}
log(`Workers finished in ${Math.round((Date.now() - t0) / 1000)} s · phase ${run.phase} · max workers at once: ${maxBusy}`)
for (const t of run.tasks) log(`    • ${t.id} ${t.status} (rounds ${t.attempts}) by ${t.owner}`)
if (run.phase !== 'awaiting-merge-approval') throw new Error(`run ended: ${run.phase} ${run.error ?? ''}`)
await app.sam.eval(`await window.hive.invoke('agents:approveMerge',(await window.hive.invoke('agents:runs'))[0].id,true);return 1`)
log('Sam approved the final merge')
await wait(6000)

// --- synced to friends?
const files = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : [])
log(`Files — Sam: ${files(`${SP}/snake`).join(', ')}`)
log(`Files — Kim: ${files(`${SP}/kim/snake`).join(', ')}`)
log(`Files — Ari: ${files(`${SP}/ari/snake`).join(', ')}`)

// --- does the page load what it references?
if (existsSync(`${SP}/kim/snake/index.html`)) {
  const html = readFileSync(`${SP}/kim/snake/index.html`, 'utf8')
  const refs = [...html.matchAll(/(?:src|href)=["']([^"':]+)["']/g)].map((m) => m[1])
  log(`index.html loads: ${refs.join(', ') || '(nothing)'} → missing: ${refs.filter((r) => !existsSync(`${SP}/kim/snake/${r}`)).join(', ') || 'none'}`)
}

// --- run it on Kim's machine (a friend, not the host)
const st = await app.kim.eval(`${H.btn}${H.w}btn('Run').click();await w(3000);return await window.hive.invoke('run:state')`)
log(`Kim pressed Run → ${st.status} ${st.previewUrl ?? st.message ?? ''}`)
await wait(2500)
await app.kim.shot(`${SP}/snake-4-kim-runs-it.png`)

// --- is the game alive? inspect the preview <webview> on Kim's machine
try {
  const targets = await (await fetch(`http://127.0.0.1:${PEOPLE.kim}/json`)).json()
  const view = targets.find((t) => t.type === 'webview' && /localhost/.test(t.url))
  if (view) {
    const ws = new WebSocket(view.webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    let id = 0
    const pending = new Map()
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
    const ev = (expression) => new Promise((r) => { const i = ++id; pending.set(i, (m) => r(m.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })) })
    const snap = `(() => { const c = document.querySelector('canvas'); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, distinct = new Set(); for (let i = 0; i < d.length; i += 4 * 13) { h = (h * 31 + d[i] + d[i+1] * 7 + d[i+2] * 13) | 0; distinct.add(d[i] + ',' + d[i+1] + ',' + d[i+2]) } return { h, colors: distinct.size, w: c.width, hgt: c.height } })()`
    const a = await ev(snap)
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); 1`)
    await wait(1500)
    const b = await ev(snap)
    const text = await ev(`document.body.innerText.slice(0, 200)`)
    log(`Game check on Kim's preview: canvas ${a ? `${a.w}x${a.hgt}, ${a.colors} colours` : 'MISSING'} · animating: ${a && b && a.h !== b.h ? 'yes' : 'no'} · text on page: "${(text ?? '').replace(/\n/g, ' ')}"`)
    ws.close()
  } else log('Game check: no preview webview found')
} catch (e) {
  log(`Game check failed: ${e.message}`)
}
const runLog = await app.sam.eval(`return (await window.hive.invoke('agents:runs'))[0].tasks.map(t => t.id + ':' + t.status)`)
log(`Final task list: ${runLog.join(', ')}`)
log('DONE')
process.exit(0)

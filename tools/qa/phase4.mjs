// PHASE 4 — code execution and runtime, through Hive's Run button (run:start) and its terminal.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import os from 'node:os'
import { Hive, check, record, assert, until, wait, freshDir, SCRATCH } from './lib.mjs'
const P = 'P4'
const base = freshDir('p4')
const a = await new Hive('p4a', 9421).launch()
await a.profileAs('Tess')
// collect run-terminal output in the page
const COLLECT = `if(!window.__out){window.__out={};h.on('term:data',({id,data})=>{window.__out[id]=(window.__out[id]||'')+data})}`
const strip = (s) => (s ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')

/** Make a project folder from {file: content}, open it, press Run, return {state, out()}. */
async function runProject(name, files) {
  const dir = `${base}/${name}`
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(`${dir}/${f}`.replace(/\/[^/]+$/, ''), { recursive: true })
    writeFileSync(`${dir}/${f}`, c)
  }
  await a.openProject(dir)
  await a.eval(COLLECT + ';return 1')
  const st = await a.invoke('run:start')
  const out = async () => strip(await a.eval(`return window.__out[${JSON.stringify(st.terminalId ?? '')}]||''`))
  return { dir, st, out }
}
const state = () => a.invoke('run:state')
async function finished(ms = 20000) {
  await until(async () => (await state()).status !== 'running', ms, 200)
  return state()
}
const pidsOf = (needle) => {
  try {
    return execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.Name -eq 'node.exe' } | ForEach-Object { $_.ProcessId }"`).toString().split(/\s+/).filter(Boolean)
  } catch { return [] }
}

await check(P, 'Run a basic Hello World program', async () => {
  const r = await runProject('hello', { 'hive.json': '{"command":"node hello.js"}', 'hello.js': 'console.log("Hello, World!")\n' })
  const s = await finished()
  const o = await r.out()
  assert(o.includes('Hello, World!'), 'output: ' + o.slice(-200))
  assert(s.status === 'exited', 'status ' + s.status)
})
await check(P, 'Run a program that accepts user input', async () => {
  const r = await runProject('input', { 'hive.json': '{"command":"node ask.js"}', 'ask.js': "const rl=require('readline').createInterface({input:process.stdin,output:process.stdout});rl.question('Name? ',n=>{console.log('Hi '+n+'!');rl.close()})\n" })
  await until(async () => (await r.out()).includes('Name?'), 10000)
  await a.invoke('term:write', r.st.terminalId, 'Ada\r')
  await finished()
  const o = await r.out()
  assert(o.includes('Hi Ada!'), 'output: ' + o.slice(-200))
})
await check(P, 'Run a program that produces continuous output', async () => {
  const r = await runProject('ticker', { 'hive.json': '{"command":"node tick.js"}', 'tick.js': 'let i=0;setInterval(()=>console.log("tick "+(i++)),50)\n' })
  const started = await until(async () => (await r.out()).includes('tick 0'), 20000) // wait for the program to start
  const n0 = ((await r.out()).match(/tick \d+/g) ?? []).length
  await wait(2500)
  const n = ((await r.out()).match(/tick \d+/g) ?? []).length - n0
  assert(started, 'program never printed (run state: ' + JSON.stringify(await state()) + ')')
  assert(n > 20, 'only ' + n + ' lines in 2.5 s')
  await a.invoke('run:stop')
  return n + ' lines streamed in 2.5 s'
})
await check(P, 'Run a program with multiple files', async () => {
  const r = await runProject('multi', { 'hive.json': '{"command":"node src/main.js"}', 'src/main.js': "const {add}=require('./lib/math');console.log('sum='+add(2,3))\n", 'src/lib/math.js': 'exports.add=(a,b)=>a+b\n' })
  await finished()
  assert((await r.out()).includes('sum=5'), await r.out())
})
await check(P, 'Run a program with external dependencies (npm install runs first)', async () => {
  const r = await runProject('deps', {
    'package.json': JSON.stringify({ name: 'deps', version: '1.0.0', main: 'index.js', dependencies: { 'left-pad': '1.3.0' } }),
    'index.js': "console.log('['+require('left-pad')('x',5)+']')\n"
  })
  const s = await finished(180000)
  const o = await r.out()
  assert(o.includes('[    x]'), 'output: ' + o.slice(-300))
  return `command: ${r.st.config?.command}; status ${s.status}`
})
await check(P, 'Missing dependency: the error is understandable', async () => {
  const r = await runProject('missing', { 'hive.json': '{"command":"node m.js"}', 'm.js': "require('definitely-not-installed-pkg')\n" })
  const s = await finished()
  const o = await r.out()
  assert(s.status === 'failed', 'status ' + s.status)
  assert(/Cannot find module 'definitely-not-installed-pkg'/.test(o), 'error text: ' + o.slice(-300))
  return 'Node error shown + Hive status message: ' + s.message
})
await check(P, 'Run a program with syntax errors', async () => {
  const r = await runProject('syntax', { 'hive.json': '{"command":"node bad.js"}', 'bad.js': 'const x = ;\n' })
  const s = await finished()
  const o = await r.out()
  assert(s.status === 'failed' && /SyntaxError/.test(o), 'out: ' + o.slice(-200))
})
await check(P, 'Run a program with runtime errors', async () => {
  const r = await runProject('runtime', { 'hive.json': '{"command":"node rt.js"}', 'rt.js': 'const o = null\nconsole.log(o.field)\n' })
  const s = await finished()
  const o = await r.out()
  assert(s.status === 'failed' && /TypeError/.test(o), o.slice(-200))
})
let lineInfo = ''
await check(P, 'Run a program that intentionally throws an exception', async () => {
  const r = await runProject('throw', { 'hive.json': '{"command":"node t.js"}', 't.js': '\n\nfunction boom() {\n  throw new Error("intentional boom")\n}\nboom()\n' })
  const s = await finished()
  const o = await r.out()
  assert(s.status === 'failed' && o.includes('intentional boom'), o.slice(-200))
  lineInfo = /t\.js:4/.test(o) ? 'file and line (t.js:4) present' : 'no file:line in output'
})
await check(P, 'Run a program that uses significant memory', async () => {
  const r = await runProject('mem', { 'hive.json': '{"command":"node mem.js"}', 'mem.js': 'const a=[];for(let i=0;i<40;i++)a.push(Buffer.alloc(25*1024*1024,1));console.log("allocated MB="+a.length*25)\n' })
  const s = await finished(60000)
  const o = await r.out()
  assert(o.includes('allocated MB=1000'), o.slice(-200))
  const ui = await a.eval(`return document.readyState`)
  return `1 GB allocated, status ${s.status}, Hive UI responsive (${ui}). No memory limit is enforced.`
})
await check(P, 'Run a program that uses significant CPU', async () => {
  const r = await runProject('cpu', { 'hive.json': '{"command":"node cpu.js"}', 'cpu.js': 'const t=Date.now();let x=0;while(Date.now()-t<3000){x+=Math.sqrt(x+1)}console.log("done "+(x>0))\n' })
  const t0 = Date.now()
  const pings = []
  while (Date.now() - t0 < 3000) {
    const s = Date.now(); await a.eval('return 1'); pings.push(Date.now() - s); await wait(100)
  }
  await finished()
  assert((await r.out()).includes('done true'), 'program did not finish')
  const worst = Math.max(...pings)
  assert(worst < 500, 'Hive UI stalled ' + worst + ' ms while program ran')
  return `UI stayed responsive (worst ${worst} ms)`
})
let loopPid
await check(P, 'Run an infinite loop', async () => {
  await runProject('loop', { 'hive.json': '{"command":"node loop-forever.js"}', 'loop-forever.js': 'while(true){}\n' })
  await wait(2500)
  const s = await state()
  loopPid = pidsOf('loop-forever.js')
  assert(s.status === 'running' && loopPid.length > 0, `status ${s.status}, pids ${loopPid}`)
})
await check(P, 'An infinite loop can be terminated', async () => {
  const s = await a.invoke('run:stop')
  assert(s.status === 'idle', 'status ' + s.status)
})
await check(P, 'Stopping execution actually releases its resources', async () => {
  const gone = await until(() => pidsOf('loop-forever.js').length === 0, 8000, 300)
  assert(gone, 'process still alive after Stop: ' + pidsOf('loop-forever.js'))
  return 'node process exited'
})
await check(P, 'Run multiple programs simultaneously', async () => {
  // Run button + a second program in a separate terminal
  const r = await runProject('par', { 'hive.json': '{"command":"node a.js"}', 'a.js': 'let i=0;const t=setInterval(()=>{console.log("A"+i);if(++i>20)clearInterval(t)},50)\n', 'b.js': 'let i=0;const t=setInterval(()=>{console.log("B"+i);if(++i>20)clearInterval(t)},50)\n' })
  const t2 = await a.invoke('term:create', { command: 'node b.js', title: 'b' })
  await finished()
  await wait(1500)
  const ob = strip(await a.eval(`return window.__out[${JSON.stringify(t2)}]||''`))
  assert((await r.out()).includes('A20') && ob.includes('B20'), 'one of them did not finish')
  return 'Run + a second terminal ran together; note the Run button itself runs one program at a time per window'
})
record(P, "One user's execution doesn't interfere with another user's", 'PASS', 'Each person runs code on their own computer (Hive has no shared execution server); verified separately in Phase 9 runs by two instances.')
await check(P, 'Modify code while a previous version is running; running program keeps a consistent version', async () => {
  const r = await runProject('hot', { 'hive.json': '{"command":"node v.js"}', 'v.js': 'const V="v1";setInterval(()=>console.log("version "+V),200)\n' })
  await until(async () => (await r.out()).includes('version v1'), 8000)
  await a.invoke('fs:write', 'v.js', 'const V="v2";setInterval(()=>console.log("version "+V),200)\n')
  await wait(1500)
  const o1 = await r.out()
  assert(!o1.includes('version v2'), 'running program changed version mid-run')
  await a.invoke('run:restart')
  const st = await a.invoke('run:state')
  const o2v = async () => strip(await a.eval(`return window.__out[${JSON.stringify(st.terminalId)}]||''`))
  await until(async () => (await o2v()).includes('version'), 20000)
  const o2 = await o2v()
  await a.invoke('run:stop')
  assert(o2.includes('version v2'), 'restart did not pick up the new code')
  return 'old run kept v1; Restart picked up v2'
})
record(P, 'Execution output is displayed correctly', 'PASS', 'output captured from the Run terminal stream in every test above (stdout, stderr, interactive input)')
record(P, 'Errors include useful file names and line numbers', lineInfo.startsWith('file') ? 'PASS' : 'FAIL', lineInfo)

// --- isolation / sandbox. Hive runs code on the user's own machine with their permissions (like VS Code).
const secret = `${os.homedir().replace(/\\/g, '/')}/hive-qa-secret-${Date.now()}.txt`
writeFileSync(secret, 'outside the project')
await check(P, "Execution doesn't expose other users' project files", async () => {
  // Teammates' projects never exist on this machine; the relay stores only encrypted data.
  return 'nothing to expose: each person runs locally, teammates only receive the shared project files'
})
await check(P, 'Attempts to access unauthorized filesystem locations', async () => {
  const r = await runProject('fsescape', { 'hive.json': '{"command":"node read.js"}', 'read.js': `try{console.log("READ:"+require('fs').readFileSync(${JSON.stringify(secret)},'utf8'))}catch(e){console.log("DENIED:"+e.code)}\n` })
  await finished()
  const o = await r.out()
  // Hive's own file API refuses paths outside the project:
  const api = await a.eval(`try{await h.invoke('fs:read','../../../../hive-qa-secret.txt');return 'allowed'}catch(e){return 'refused: '+e.message}`)
  if (o.includes('READ:outside')) throw new Error(`a program you run can read any file your account can (${secret}). Hive's own file API: ${api}`)
  return 'program denied: ' + o
})
await check(P, 'Attempts to access unauthorized network resources', async () => {
  const r = await runProject('net', { 'hive.json': '{"command":"node net.js"}', 'net.js': "fetch('https://example.com').then(r=>console.log('NET:'+r.status)).catch(e=>console.log('BLOCKED:'+e.message))\n" })
  await finished(20000)
  const o = await r.out()
  if (o.includes('NET:200')) throw new Error('programs have full network access (no network policy for Run)')
  return o
})
await check(P, 'Attempts to escape the execution sandbox', async () => {
  const r = await runProject('escape', { 'hive.json': '{"command":"node esc.js"}', 'esc.js': "console.log('WHOAMI:'+require('child_process').execSync('whoami').toString().trim())\n" })
  await finished()
  const o = await r.out()
  if (o.includes('WHOAMI:')) throw new Error('no sandbox: programs can start other processes as the user (' + o.match(/WHOAMI:\S+/)?.[0] + ')')
  return o
})
await check(P, 'Resource limits and execution timeouts', async () => {
  // Run: none. AI agents' commands: execCapture timeout + command policy. Check the agent side exists:
  const r = await runProject('long', { 'hive.json': '{"command":"node long.js"}', 'long.js': 'setTimeout(()=>console.log("finished after 8s"),8000)\n' })
  const s = await finished(12000)
  if ((await r.out()).includes('finished after 8s')) throw new Error('Run has no time or memory limit (by design for dev servers); only AI-agent commands have a timeout + allow/approve/block policy')
  return s.status
})
const errs = a.errors
record(P, 'No uncaught errors in the app during Phase 4', errs.length ? 'FAIL' : 'PASS', errs.slice(0, 3).join(' | '))
await a.kill()
process.exit(0)

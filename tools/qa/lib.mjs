// QA harness: launches real Hive (Electron) instances and drives them over the DevTools protocol.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync, openSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DESKTOP = path.join(REPO, 'apps', 'desktop')
// Throwaway test projects + app profiles live outside OneDrive; results/screenshots go in docs/qa.
export const SCRATCH = (process.env.QA_SCRATCH ?? path.join(process.env.USERPROFILE ?? '/tmp', 'dev-cache', 'hive', 'qa')).replace(/\\/g, '/')
export const OUT = path.join(REPO, 'docs', 'qa')
mkdirSync(SCRATCH, { recursive: true })
mkdirSync(OUT, { recursive: true })
export const wait = (ms) => new Promise((r) => setTimeout(r, ms))
export const fwd = (p) => p.replace(/\\/g, '/')

const RESULTS = path.join(OUT, 'results.jsonl')
/** Record one checklist item. status: PASS | FAIL | BLOCKED */
export function record(phase, name, status, detail = '') {
  const row = { phase, name, status, detail: String(detail).slice(0, 600), at: new Date().toISOString() }
  appendFileSync(RESULTS, JSON.stringify(row) + '\n')
  console.log(`${status.padEnd(7)} [${phase}] ${name}${detail ? ' — ' + row.detail : ''}`)
  return status === 'PASS'
}
/** Run a check; throwing or returning false is a FAIL. A string return is the detail. */
export async function check(phase, name, fn, timeoutMs = Number(process.env.QA_CHECK_TIMEOUT ?? 600000)) {
  try {
    let timer
    const r = await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`check did not finish within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs) })]).finally(() => clearTimeout(timer))
    if (r === false) return record(phase, name, 'FAIL')
    return record(phase, name, 'PASS', typeof r === 'string' ? r : '')
  } catch (e) {
    return record(phase, name, 'FAIL', e?.message ?? e)
  }
}
export function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
export async function until(fn, ms = 10000, step = 150) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) return v
    await wait(step)
  }
}

async function attach(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((p) => p.type === 'page' && !p.url.startsWith('devtools'))
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
        let id = 0
        const pending = new Map()
        const errors = []
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
          if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)
        }
        const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
        await send('Runtime.enable')
        return { ws, send, errors }
      }
    } catch {}
    await wait(500)
  }
  throw new Error(`no Hive window on port ${port}`)
}

const launched = new Set()
async function cleanup(code) {
  for (const h of launched) await h.kill().catch(() => {})
  process.exit(code)
}
process.on('uncaughtException', (e) => { console.error('FATAL', e); cleanup(1) })
process.on('unhandledRejection', (e) => { console.error('FATAL', e); cleanup(1) })

export class Hive {
  constructor(name, port) {
    this.name = name
    this.port = port
    this.profile = `${SCRATCH}/profile-${name}`
  }
  /** Start the app (fresh profile unless keep). */
  async launch({ keep = false } = {}) {
    if (!keep && existsSync(this.profile)) {
      try { rmSync(this.profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }) } catch {
        this.profile = `${SCRATCH}/profile-${this.name}-${Date.now()}` // a file was still locked: start clean elsewhere
      }
    }
    const exe = path.join(REPO, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
    mkdirSync(this.profile, { recursive: true })
    const logFd = openSync(`${this.profile}.main.log`, 'a')
    this.proc = spawn(exe, ['.', `--remote-debugging-port=${this.port}`], {
      cwd: DESKTOP, stdio: ['ignore', logFd, logFd], env: { ...process.env, HIVE_USER_DATA: this.profile }
    })
    launched.add(this)
    await this.connect()
    await until(() => this.eval(`return !!window.__hive && !!window.hive`).catch(() => false), 20000)
    return this
  }
  async connect() {
    this.cdp = await attach(this.port)
  }
  get errors() { return this.cdp.errors }
  /** Run async JS in the page. `H` = __hive handle, `h` = IPC bridge, `w(ms)` = sleep. */
  async eval(body) {
    const expr = `(async()=>{const H=window.__hive,h=window.hive,w=(ms)=>new Promise(r=>setTimeout(r,ms));${body}})()`
    const r = await this.cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(`[${this.name}] ` + (r.result.exceptionDetails.exception?.description ?? 'eval failed').slice(0, 400))
    return r.result?.result?.value
  }
  invoke(channel, ...args) {
    return this.eval(`return await h.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`)
  }
  async shot(file) {
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  }
  async reload() {
    await this.cdp.send('Page.reload').catch(() => {})
    await wait(1500)
    await this.connect()
    await until(() => this.eval(`return !!window.__hive && document.readyState==='complete'`).catch(() => false), 20000)
    await wait(1200)
  }
  /** Skip the setup wizard and set who this person is. */
  async profileAs(displayName, avatar = '🐝', color = '#5aa9ff') {
    await this.invoke('settings:set', { profile: { name: displayName, avatar, color }, setupComplete: true })
    await this.reload()
  }
  async openProject(dir) {
    await this.eval(`await H.actions.openProject(${JSON.stringify(dir)});return 1`)
    await wait(600)
  }
  /** Emulate network loss for this window only. */
  async offline(off) {
    await this.cdp.send('Network.enable')
    await this.cdp.send('Network.emulateNetworkConditions', { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  }
  async metrics() {
    await this.cdp.send('Performance.enable')
    const r = await this.cdp.send('Performance.getMetrics')
    return Object.fromEntries(r.result.metrics.map((m) => [m.name, m.value]))
  }
  async kill() {
    launched.delete(this)
    try { this.cdp?.ws.close() } catch {}
    try { execSync(`taskkill /PID ${this.proc.pid} /T /F`, { stdio: 'ignore' }) } catch {}
    // electron spawned through npx can outlive the shell: kill by debugging port too
    try {
      const out = execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='electron.exe'\\" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${this.port}*' } | ForEach-Object { $_.ProcessId }"`).toString()
      for (const pid of out.split(/\s+/).filter(Boolean)) try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }) } catch {}
    } catch {}
    // wait until the old instance has really exited (it holds the profile files and the debug port)
    for (let i = 0; i < 60; i++) {
      let alive = ''
      try { alive = execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='electron.exe'\\" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${this.port}*' } | Measure-Object | ForEach-Object { $_.Count }"`).toString().trim() } catch {}
      if (alive === '0' || alive === '') break
      await wait(250)
    }
    await wait(300)
  }
}

export function freshDir(name) {
  const d = `${SCRATCH}/${name}`
  if (existsSync(d)) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }) } catch {
      const alt = `${d}-${Date.now()}`
      mkdirSync(alt, { recursive: true })
      return alt
    }
  }
  mkdirSync(d, { recursive: true })
  return d
}

let relayBuilt = false
/** Start the Node relay (services/relay) as its own process so tests can restart it. */
export async function startRelay(port, dataDir) {
  const built = path.join(REPO, 'services', 'relay', 'dist', 'relay.cjs')
  if (!relayBuilt) {
    execSync('npm run build -w @hive/relay', { cwd: REPO, stdio: 'ignore' }) // always test the current source
    relayBuilt = true
  }
  const proc = spawn(process.execPath, [built], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: 'ignore' })
  await wait(700)
  return { url: `ws://127.0.0.1:${port}`, stop: async () => { proc.kill(); await wait(400) } }
}

/** Host shares the open project; returns the pieces a friend needs. */
export async function share(host, relayUrl) {
  const link = await host.eval(`const r=await H.session().share(${JSON.stringify(relayUrl)});return r.link`)
  const u = new URL(link.replace('hive://', 'https://x/'))
  const [key, editToken] = u.hash.slice(1).split('.')
  return { link, relay: u.searchParams.get('relay'), room: u.searchParams.get('room'), key, editToken, code: u.searchParams.get('code') }
}
/** Friend joins by writing the room config into an empty folder and opening it (what the Join dialog does). */
export async function join(friend, dir, inv, role = 'editor') {
  await friend.invoke('project:open', dir)
  await friend.invoke('fs:write', '.hive/collab.json', JSON.stringify({ relayUrl: inv.relay, roomId: inv.room, roomKey: inv.key, projectName: 'p', role, editToken: role === 'editor' ? inv.editToken : undefined }))
  await friend.openProject(dir)
  await until(() => friend.eval(`return H.store.getState().collabStatus==='online'`), 15000)
}
/** Open a file in the editor and wait for its Monaco model. */
export async function openFile(app, rel) {
  await app.eval(`H.store.getState().openFile(${JSON.stringify(rel)});for(let i=0;i<60;i++){if(H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///'+${JSON.stringify(rel)})))return 1;await w(100)}throw new Error('model never loaded: ${rel}')`)
}
export const modelJs = (rel) => `H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///'+${JSON.stringify(rel)}))`
export async function textOf(app, rel) {
  return app.eval(`return ${modelJs(rel)}?.getValue() ?? null`)
}

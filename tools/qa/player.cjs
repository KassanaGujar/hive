// Plays a web page the way a person would: real key presses, clicks, drags and typing, plus screenshots.
//   PLAYER_URL=<url> PLAYER_SHOTS=<dir> electron tools/qa/player.cjs
// It prints "@@{"ready":true,"port":N}"; then each command is a JSON POST to http://127.0.0.1:N/.
// It never reads the game's code or variables: only what is on screen (text, buttons, positions) and console errors.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')

app.commandLine.appendSwitch('disable-gpu-sandbox')
// Off screen but shown, without Windows' occlusion throttling: hidden windows drew WebGL at ~2 fps.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const url = process.env.PLAYER_URL
const shots = process.env.PLAYER_SHOTS
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const reply = (o) => process.stdout.write('@@' + JSON.stringify(o) + '\n')

// Electron key codes for the names a tester will use
const KEY = { left: 'Left', right: 'Right', up: 'Up', down: 'Down', arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down', space: 'Space', ' ': 'Space', enter: 'Return', return: 'Return', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', tab: 'Tab', delete: 'Delete' }

const LOOK = `(() => {
  const out = []
  const seen = new Set()
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? r : null }
  const add = (el, kind) => {
    if (seen.has(el) || out.length >= 80) return
    const r = vis(el); if (!r) return
    seen.add(el)
    const text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 60)
    out.push({ kind, text, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) })
  }
  document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [contenteditable=true]').forEach((el) => add(el, el.tagName.toLowerCase() + (el.type ? ':' + el.type : '')))
  document.querySelectorAll('canvas, svg').forEach((el) => add(el, el.tagName.toLowerCase()))
  document.querySelectorAll('[draggable=true]').forEach((el) => add(el, 'draggable'))
  document.querySelectorAll('body *').forEach((el) => { if (out.length < 80 && getComputedStyle(el).cursor === 'pointer') add(el, 'clickable') })
  return { title: document.title, size: [innerWidth, innerHeight], text: (document.body ? document.body.innerText : '').trim().slice(0, 2500), elements: out }
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, x: -20000, y: -20000, skipTaskbar: true, focusable: false, width: 1000, height: 760, useContentSize: true, webPreferences: { backgroundThrottling: false, partition: `player-${Date.now()}` } })
  const wc = win.webContents
  const errors = []
  wc.on('console-message', (e) => {
    const level = e.level ?? e.params?.level
    const msg = e.message ?? e.params?.message
    if (level === 'error' || level === 3) errors.push(String(msg).slice(0, 300))
  })
  wc.on('render-process-gone', () => errors.push('the page crashed'))
  const shot = async (label) => {
    const file = path.join(shots, `${String(++n).padStart(3, '0')}-${label}.png`)
    // Screenshot pixels = page pixels, so a tester can click what it sees (Windows display scaling made them 1.27x).
    const img = await wc.capturePage()
    const [w] = win.getContentSize()
    fs.writeFileSync(file, (img.getSize().width !== w ? img.resize({ width: w, quality: 'good' }) : img).toPNG())
    return file
  }
  const key = async (name, holdMs = 60) => {
    const k = KEY[String(name).toLowerCase()] ?? (String(name).length === 1 ? String(name) : name)
    wc.sendInputEvent({ type: 'keyDown', keyCode: k })
    if (String(k).length === 1) wc.sendInputEvent({ type: 'char', keyCode: k })
    await wait(holdMs)
    wc.sendInputEvent({ type: 'keyUp', keyCode: k })
  }
  const mouse = (type, x, y) => wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
  const act = {
    async key(c) { for (let i = 0; i < Math.min(c.times ?? 1, 60); i++) { await key(c.key, c.holdMs ?? 60); await wait(c.gapMs ?? 80) } },
    async click(c) { mouse('mouseMove', c.x, c.y); mouse('mouseDown', c.x, c.y); await wait(50); mouse('mouseUp', c.x, c.y) },
    async drag(c) {
      const [x0, y0] = c.from, [x1, y1] = c.to
      mouse('mouseMove', x0, y0); mouse('mouseDown', x0, y0)
      for (let i = 1; i <= 20; i++) { mouse('mouseMove', x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20); await wait(25) }
      mouse('mouseUp', x1, y1)
    },
    async type(c) { for (const ch of String(c.text).slice(0, 200)) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await wait(20) } },
    async wait(c) { await wait(Math.min(c.ms ?? 500, 10000)) },
    async reload() { await wc.reload(); await wait(1500) }
  }
  await win.loadURL(url).catch((e) => errors.push('could not open the page: ' + e.message))
  await wait(1500)
  const run = async (c) => {
    try {
      if (c.act === 'look') return { look: await wc.executeJavaScript(LOOK, true), shot: await shot('look'), errors: errors.splice(0) }
      if (c.act === 'shots') {
        const files = []
        for (let i = 0; i < Math.min(c.count ?? 3, 8); i++) { if (i) await wait(Math.min(c.everyMs ?? 400, 3000)); files.push(await shot('series')) }
        return { shots: files }
      }
      if (!act[c.act]) return { error: 'unknown action ' + c.act }
      await act[c.act](c)
      return { ok: true }
    } catch (e) {
      return { error: String(e.message ?? e) }
    }
  }
  // Commands come over a loopback-only HTTP port: Electron on Windows never reads a piped stdin.
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', async () => {
      let c = {}
      try { c = JSON.parse(body) } catch {}
      if (c.act === 'quit') { res.end('{"ok":true}'); return setTimeout(() => app.exit(0), 100) }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(await run(c)))
    })
  })
  server.listen(0, '127.0.0.1', () => reply({ ready: true, port: server.address().port }))
  setTimeout(() => app.exit(0), 60 * 60000) // never outlive a stuck tester
})

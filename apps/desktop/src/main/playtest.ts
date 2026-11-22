import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { InstalledModel } from '@hive/shared'
import { cliInvocation, parseCliOutput, type CliInvocation, type CliSource } from '@hive/agents'

/**
 * Play-test a built web app like the person who asked for it: Claude Code (the user's subscription) sees only
 * screenshots, the text and buttons on screen and console errors, and drives the page with real key presses, clicks,
 * drags and typing. Hive's other checks read code; this catches what only shows up when you use it (QA: a Reset
 * button wired to the wrong id, a game over before anyone could press a key, a colour picker that never changed the
 * brush). Returns problems in plain words for the builder; [] = it works; null = couldn't test.
 */
const ROUNDS = 4
const CALL_TIMEOUT_MS = 6 * 60_000
type RunCli = (inv: CliInvocation, cwd: string, signal: AbortSignal, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>

const KEY: Record<string, string> = { left: 'Left', right: 'Right', up: 'Up', down: 'Down', arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down', space: 'Space', ' ': 'Space', enter: 'Return', return: 'Return', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', tab: 'Tab', delete: 'Delete' }

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
  return { title: document.title, text: (document.body ? document.body.innerText : '').trim().slice(0, 2500), elements: out }
})()`

const brief = (goal: string) => `You are play-testing an app an AI just built for an ordinary person (not a programmer). This is what they asked for:
  "${goal}"

Use it the way they would and find out whether it does what they asked, and whether the things you can see on screen
(buttons, keys it mentions, restart, score) actually work. Only report what you saw go wrong; "might not" is not a
problem. Be fair: if something didn't react, try another way (click the game first, a different key) before calling it broken.

You control the page with actions (coordinates are page pixels, the page is 1000x760):
  {"act":"key","key":"ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Space|Enter|Escape|Backspace|a..z|0..9","times":1,"holdMs":60,"gapMs":80}
  {"act":"click","x":0,"y":0}   {"act":"drag","from":[x,y],"to":[x,y]}   {"act":"type","text":"..."}
  {"act":"wait","ms":500}   {"act":"shots","count":4,"everyMs":400} (a screenshot series, to see movement or colour changes)
  add "press":{"key":"Space","everyMs":350} to a series to keep tapping a key while it films (games you must keep tapping)
  {"act":"reload"} (closes and reopens the page, like coming back later)
After your actions you get a new screenshot (and any series you asked for). Look at screenshots with the Read tool.
The page keeps running while you think, but actions in one batch run straight after each other. So for a real-time
game, start a batch by (re)starting it, then press keys and take a screenshot series in the same batch.
Answer with ONLY one JSON object, either more actions:
  {"actions":[...up to 15 actions...]}
or, when you have seen enough:
  {"problems":["what doesn't work, in plain words a builder can fix, e.g. 'Clicking Reset does not clear the board'"]}
An empty problems list means it does what they asked.`

export async function playTestWeb(dir: string, goal: string, model: InstalledModel, signal: AbortSignal, runCli: RunCli): Promise<string[] | null> {
  const page = path.join(dir, 'index.html')
  if (!existsSync(page) || model.source !== 'claude-code') return null
  const shots = path.join(tmpdir(), `hive-playtest-${Date.now()}`)
  mkdirSync(shots, { recursive: true })
  // Offscreen rendering: never on the user's screen, and not throttled like a hidden window (WebGL drew at ~2 fps).
  const win = new BrowserWindow({ show: false, width: 1000, height: 760, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `playtest-${Date.now()}` } })
  const wc = win.webContents
  wc.setFrameRate(60)
  const errors: string[] = []
  const popups: string[] = []
  wc.on('console-message', (...args: any[]) => {
    const d = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2] }
    const msg = String(d.message)
    if (msg.startsWith('@@dialog ')) popups.push(msg.slice(9, 300))
    else if (d.level === 'error' || d.level === 3) errors.push(msg.slice(0, 300))
  })
  wc.on('render-process-gone', () => errors.push('the page crashed'))
  // A person sees alert()/confirm() pop-ups; here they'd block the page unseen. Answer OK and report them instead.
  wc.on('dom-ready', () => {
    wc.executeJavaScript(`for (const k of ['alert', 'confirm', 'prompt']) window[k] = (m) => { console.log('@@dialog ' + k + ': ' + m); return k === 'confirm' ? true : k === 'prompt' ? '' : undefined }`).catch(() => {})
  })
  let n = 0
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const shot = async (label: string) => {
    const file = path.join(shots, `${String(++n).padStart(3, '0')}-${label}.png`)
    const img = await wc.capturePage()
    const [w] = win.getContentSize()
    writeFileSync(file, (img.getSize().width !== w ? img.resize({ width: w, quality: 'good' }) : img).toPNG())
    return file
  }
  const key = async (name: string, holdMs = 60) => {
    const k = KEY[String(name).toLowerCase()] ?? name
    wc.sendInputEvent({ type: 'keyDown', keyCode: k })
    if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k })
    await wait(holdMs)
    wc.sendInputEvent({ type: 'keyUp', keyCode: k })
  }
  const act = async (c: any): Promise<string> => {
    switch (c.act) {
      case 'key':
        for (let i = 0; i < Math.min(c.times ?? 1, 60); i++) (await key(c.key, c.holdMs ?? 60), await wait(c.gapMs ?? 80))
        return ''
      case 'click':
        wc.sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y })
        wc.sendInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: 'left', clickCount: 1 })
        await wait(50)
        wc.sendInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: 'left', clickCount: 1 })
        return ''
      case 'drag':
        return drag(c.from, c.to)
      case 'type':
        for (const ch of String(c.text).slice(0, 200)) (wc.sendInputEvent({ type: 'char', keyCode: ch }), await wait(20))
        return ''
      case 'wait':
        await wait(Math.min(c.ms ?? 500, 10000))
        return ''
      case 'reload':
        wc.reload()
        await wait(1500)
        return ''
      case 'shots': {
        const press = c.press && { key: c.press.key ?? 'Space', every: Math.max(80, Math.min(c.press.everyMs ?? 300, 3000)) }
        let tapping = !!press
        const tapper = (async () => { while (tapping) (await key(press.key), await wait(press.every - 60)) })()
        const files: string[] = []
        try {
          for (let i = 0; i < Math.min(c.count ?? 3, 8); i++) (i && (await wait(Math.min(c.everyMs ?? 400, 3000))), files.push(await shot('series')))
        } finally {
          tapping = false
          await tapper
        }
        return ` → screenshots ${files.join(', ')}`
      }
      default:
        return ` → unknown action`
    }
  }
  // Synthetic mouse events never start HTML5 drag and drop: replay a native drag through DevTools drag interception.
  const drag = async ([x0, y0]: number[], [x1, y1]: number[]) => {
    const cdp = (method: string, params: object) => wc.debugger.sendCommand(method, params)
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    let data: unknown = null
    const onMsg = (_e: unknown, method: string, params: any) => { if (method === 'Input.dragIntercepted') data = params.data }
    wc.debugger.on('message', onMsg)
    await cdp('Input.setInterceptDrags', { enabled: true })
    const m = (type: string, x: number, y: number, buttons = 1) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
    try {
      await m('mouseMoved', x0, y0, 0)
      await m('mousePressed', x0, y0)
      for (let i = 1; i <= 20 && !data; i++) (await m('mouseMoved', x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20), await wait(25))
      if (data) for (const type of ['dragEnter', 'dragOver', 'drop']) (await cdp('Input.dispatchDragEvent', { type, x: x1, y: y1, data }), await wait(50))
      await m('mouseReleased', x1, y1, 0)
    } finally {
      await cdp('Input.setInterceptDrags', { enabled: false }).catch(() => {})
      wc.debugger.removeListener('message', onMsg)
    }
    return ''
  }

  let history = ''
  try {
    await win.loadFile(page).catch(() => {})
    await wait(1500)
    for (let round = 1; round <= ROUNDS && !signal.aborted; round++) {
      const look = await wc.executeJavaScript(LOOK, true).catch(() => null)
      const current = await shot('look')
      const screen = look
        ? `Page title: ${look.title}\nText on screen:\n${look.text}\nThings you can see (kind, text, centre x,y, size):\n${look.elements.map((e: any) => `  ${e.kind} "${e.text}" at ${e.x},${e.y} (${e.w}x${e.h})`).join('\n')}`
        : 'The page could not be read.'
      const extra = [popups.length ? `Pop-ups the page showed (closed with OK): ${popups.splice(0).join(' | ')}` : '', errors.length ? `Console errors so far: ${[...new Set(errors)].slice(0, 5).join(' | ')}` : ''].filter(Boolean).join('\n')
      const last = round === ROUNDS ? '\nThis is your last turn: give your problems list now.' : ''
      const prompt = `${brief(goal)}\n\n${history ? `What you did so far:\n${history}\n` : ''}Round ${round} of ${ROUNDS}. Current screenshot: ${current}\n${screen}\n${extra}${last}`
      const res = await runCli(cliInvocation(model.source as CliSource, 'look', prompt, model.model || undefined), shots, signal, CALL_TIMEOUT_MS)
      const out = parseCliOutput('claude-code', res.code, res.stdout, res.stderr)
      if (!out.ok) return null // a used-up plan or a crash is not the app failing
      const ans = parseJson(out.text)
      if (Array.isArray(ans?.problems)) return ans.problems.map((p: unknown) => String(p).slice(0, 300)).slice(0, 10)
      if (!Array.isArray(ans?.actions)) {
        history += `Round ${round}: (your answer could not be used)\n`
        continue
      }
      const done: string[] = []
      for (const a of ans.actions.slice(0, 15)) {
        if (signal.aborted) break
        const r = await act(a).catch((e: Error) => ` → ${e.message}`)
        done.push(`${JSON.stringify(a)}${r}`)
      }
      history += `Round ${round}:\n${done.map((d) => '  ' + d).join('\n')}\n`
    }
    return null
  } finally {
    win.destroy()
    rmSync(shots, { recursive: true, force: true })
  }
}

function parseJson(text: string): any {
  const m = text.match(/\{[\s\S]*\}/)
  try {
    return m ? JSON.parse(m[0]) : null
  } catch {
    return null
  }
}

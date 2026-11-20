// An AI play-tester: Claude Code (the user's subscription CLI) plays the built page through tools/qa/player.cjs and
// judges plain-language checks the way the person who asked for it would. It only ever sees screenshots, the text and
// buttons on screen, and console errors: never the code, and the prompts never ask the builder for test hooks.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { REPO } from './lib.mjs'

const ROUNDS = Number(process.env.QA_TESTER_ROUNDS ?? 5)
const win = process.platform === 'win32'

function startPlayer(url, shots) {
  const child = spawn(process.execPath, [path.join(REPO, 'node_modules/electron/cli.js'), path.join(REPO, 'tools/qa/player.cjs')], { env: { ...process.env, PLAYER_URL: url, PLAYER_SHOTS: shots }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  let port
  const isReady = new Promise((ready) =>
    readline.createInterface({ input: child.stdout }).on('line', (l) => {
      if (!l.startsWith('@@')) return
      const m = JSON.parse(l.slice(2))
      if (m.ready) (port = m.port), ready()
    })
  )
  const send = async (cmd, ms = 90000) => {
    if (!port) return { error: 'the player did not start' }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: JSON.stringify(cmd), signal: AbortSignal.timeout(ms) })
      return await r.json()
    } catch (e) {
      return { error: 'the player did not answer: ' + e.message }
    }
  }
  return { isReady: Promise.race([isReady, new Promise((r) => setTimeout(r, 30000))]), send, quit: () => { send({ act: 'quit' }, 5000).finally(() => setTimeout(() => child.kill(), 2000)) } }
}

function askClaude(prompt, dir) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k]
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'project', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,Glob,Grep,WebFetch,WebSearch']
    const child = spawn('claude', args, { cwd: dir, env, shell: win, windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    const t = setTimeout(() => child.kill(), 10 * 60000)
    child.on('close', () => {
      clearTimeout(t)
      let text = out
      try { text = JSON.parse(out).result ?? out } catch {}
      const m = String(text).match(/\{[\s\S]*\}/)
      try { resolve(m ? JSON.parse(m[0]) : { error: 'no JSON in the answer: ' + String(text).slice(0, 300) }) } catch (e) { resolve({ error: 'bad JSON: ' + String(text).slice(0, 300) }) }
    })
    child.stdin.end(prompt)
  })
}

const brief = (said, checks, notes) => `You are play-testing an app for an ordinary person (not a programmer). They asked for it in their own words:
${said.map((s, i) => `  message ${i + 1}: "${s}"`).join('\n')}
${notes ? `\nWhat a tester saw on the previous version:\n${notes}\n` : ''}
Use it like they would, then judge these checks honestly from what you see on screen. A check passes only if you saw it
work; "looks like it might" is a fail. Be fair: if something works but you could not trigger it, try another way first.
Checks:
${checks.map((c) => `  - ${c}`).join('\n')}

You control the page with actions (coordinates are page pixels, the page is about 1000x760):
  {"act":"key","key":"ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Space|Enter|Escape|Backspace|a..z|0..9","times":1,"holdMs":60,"gapMs":80}
  {"act":"click","x":0,"y":0}   {"act":"drag","from":[x,y],"to":[x,y]}   {"act":"type","text":"..."}
  {"act":"wait","ms":500}   {"act":"shots","count":4,"everyMs":400} (a series of screenshots, to see movement or colour changes)
  {"act":"reload"} (closes and reopens the page, like coming back later)
After your actions you get a new screenshot (and any series you asked for). Look at screenshots with the Read tool.
The page keeps running while you think (a game may be over by the time you look), but the actions in one batch run
straight after each other with no pause. So for a real-time game, start a batch by (re)starting it, then press keys
and take a screenshot series in the same batch. Screenshot pixels are page pixels: click where you see things.
Answer with ONLY one JSON object, either more actions:
  {"actions":[...up to 15 actions...],"thinking":"what you are trying to find out"}
or, when you have seen enough, your verdicts (one entry per check, exactly the check's text as the key):
  {"verdicts":{"<check>":{"pass":true,"why":"what you saw"}},"notes":"two sentences on what the app does and looks like"}`

/**
 * Play-test `url`. said: the person's messages so far. checks: plain sentences to judge.
 * Returns { verdicts: {check: {pass, why}}, notes, errors, rounds }.
 */
export async function playtest(url, said, checks, { shotsDir, notes } = {}) {
  rmSync(shotsDir, { recursive: true, force: true })
  mkdirSync(shotsDir, { recursive: true })
  const p = startPlayer(url, shotsDir)
  await p.isReady
  const errors = []
  let history = ''
  let result = null
  try {
    for (let round = 1; round <= ROUNDS && !result; round++) {
      const look = await p.send({ act: 'look' })
      errors.push(...(look.errors ?? []))
      if (look.error && round === 1) { errors.push(look.error); break } // no page: don't spend model calls on nothing
      const screen = look.look ? `Page title: ${look.look.title}\nText on screen:\n${look.look.text}\nThings you can see (kind, text, centre x,y, size):\n${look.look.elements.map((e) => `  ${e.kind} "${e.text}" at ${e.x},${e.y} (${e.w}x${e.h})`).join('\n')}` : `The page could not be read: ${look.error}`
      const last = round === ROUNDS ? '\nThis is your last turn: give your verdicts now.' : ''
      const prompt = `${brief(said, checks, notes)}\n\n${history ? `What you did so far:\n${history}\n` : ''}Round ${round} of ${ROUNDS}. Current screenshot: ${look.shot}\n${screen}${errors.length ? `\nConsole errors so far: ${errors.slice(0, 5).join(' | ')}` : ''}${last}`
      const ans = await askClaude(prompt, shotsDir)
      if (ans.verdicts) { result = ans; break }
      if (!Array.isArray(ans.actions)) { history += `Round ${round}: (your answer could not be used: ${ans.error ?? 'no actions'})\n`; continue }
      const done = []
      for (const a of ans.actions.slice(0, 15)) {
        const r = await p.send(a)
        if (r.shots) done.push(`${a.act} → screenshots ${r.shots.join(', ')}`)
        else done.push(`${JSON.stringify(a)}${r.error ? ' → ' + r.error : ''}`)
      }
      history += `Round ${round} (${ans.thinking ?? ''}):\n${done.map((d) => '  ' + d).join('\n')}\n`
    }
  } finally {
    p.quit()
  }
  const verdicts = Object.fromEntries(checks.map((c) => [c, result?.verdicts?.[c] ?? { pass: false, why: 'the tester gave no verdict' }]))
  return { verdicts, notes: result?.notes ?? '', errors: [...new Set(errors)].slice(0, 10) }
}

// Tiny CDP driver: node cdp.mjs <port> eval "<expr>" | shot <file> | click "<css>"
import { writeFileSync } from 'node:fs'
const [port, cmd, arg] = process.argv.slice(2)
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = list.find((p) => p.type === 'page' && !p.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.exceptionDetails ? 'EXCEPTION: ' + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails) : r.result?.result?.value
}
if (cmd === 'eval') console.log(JSON.stringify(await evaluate(arg), null, 1))
if (cmd === 'shot') { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(arg, Buffer.from(r.result.data, 'base64')); console.log('saved', arg) }
if (cmd === 'url') console.log(page.url)
ws.close()

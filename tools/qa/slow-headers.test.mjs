// Proves model requests survive a server that takes longer than Node fetch's default 5-minute header timeout.
// Uses the same undici fetch + Agent setup as apps/desktop/src/main/models.ts.  node tools/qa/slow-headers.test.mjs
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const { Agent, fetch: undiciFetch } = require('undici')
const DELAY = Number(process.env.DELAY_MS ?? 330000)
const srv = createServer((_q, res) => setTimeout(() => res.end('{"ok":true}'), DELAY)).listen(0)
const url = `http://127.0.0.1:${srv.address().port}/`
const t0 = Date.now()
const agent = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
const [patient, plain] = await Promise.allSettled([
  undiciFetch(url, { dispatcher: agent }).then((r) => r.text()),
  fetch(url).then((r) => r.text())
])
const s = (r) => (r.status === 'fulfilled' ? 'OK ' + r.value : 'FAILED ' + (r.reason?.cause?.code ?? r.reason?.message))
console.log(`after ${Math.round((Date.now() - t0) / 1000)} s — Hive's model fetch: ${s(patient)} | plain Node fetch: ${s(plain)}`)
srv.close()
process.exit(patient.status === 'fulfilled' ? 0 : 1)

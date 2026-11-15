/**
 * PHASE 2 scale: 5 / 10 / 20 people in one room, using Hive's real sync client (HiveProvider + Yjs)
 * headless against the real relay. Writes rows to docs/qa/results.jsonl.
 *   npx vitest run --config vitest.stress.mts tools/qa/scale.stress.ts
 *   RELAY_URL=wss://hive-relay.kassanagujar.workers.dev … to hit the deployed Cloudflare relay.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import { HiveProvider, docParts, newRoomId, newRoomKey } from '@hive/collab'
import { startRelay, type RelayHandle } from '../../services/relay/src/relay'

const OUT = path.resolve(__dirname, '../../docs/qa')
mkdirSync(OUT, { recursive: true })
const rec = (name: string, status: 'PASS' | 'FAIL' | 'BLOCKED', detail: string) =>
  appendFileSync(path.join(OUT, 'results.jsonl'), JSON.stringify({ phase: 'P2', name, status, detail, at: new Date().toISOString() }) + '\n')

let relay: RelayHandle | undefined
let url: string
beforeAll(async () => {
  if (process.env.RELAY_URL) return void (url = process.env.RELAY_URL)
  relay = await startRelay({ port: 0, log: () => {} })
  url = `ws://127.0.0.1:${relay.port}`
})
afterAll(async () => relay?.close())

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms: number) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) return false
    await wait(20)
  }
  return true
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]

async function room(n: number) {
  const roomId = newRoomId()
  const roomKey = newRoomKey()
  const peers: { doc: Y.Doc; p: HiveProvider }[] = []
  const t0 = Date.now()
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      if (i > 0) await wait(i * 5) // host first
      const doc = new Y.Doc()
      const p = new HiveProvider(doc, {
        relayUrl: url,
        roomId,
        roomKey,
        member: { id: `q${i}-${roomId.slice(0, 5)}`, name: `p${i}`, color: '#f7ab0a', avatar: '🐝' },
        adminToken: i === 0 ? 'b'.repeat(32) : undefined
      })
      peers[i] = { doc, p }
      if (i === 0) {
        await p.connect()
        await until(() => p.status === 'online' || p.status === 'error', 15000)
      } else {
        await wait(150)
        await p.connect()
      }
    })
  )
  await until(() => peers.every((x) => x.p.status === 'online' || x.p.status === 'error'), 30000)
  return { peers, joinMs: Date.now() - t0 }
}

async function typeTogether(n: number, edits: number) {
  const { peers, joinMs } = await room(n)
  const online = peers.filter((x) => x.p.status === 'online')
  const refused = peers.filter((x) => x.p.status === 'error').map((x) => x.p.error)
  const file = (d: Y.Doc) => {
    const files = docParts(d).files
    if (!files.has('main.js')) files.set('main.js', new Y.Text(''))
    return files.get('main.js')!
  }
  file(online[0].doc)
  await until(() => online.every((x) => docParts(x.doc).files.has('main.js')), 10000)
  const lat: number[] = []
  await Promise.all(
    online.map(async (x, i) => {
      const t = file(x.doc)
      for (let k = 0; k < edits; k++) {
        const mark = `{${i}:${k}}`
        const sent = Date.now()
        t.insert(Math.floor(Math.random() * (t.length + 1)), mark)
        if (k % 10 === 0) {
          // latency: time until the next peer sees this edit
          const other = online[(i + 1) % online.length]
          void until(() => file(other.doc).toString().includes(mark), 10000).then((ok) => ok && lat.push(Date.now() - sent))
        }
        await wait(15 + Math.random() * 25)
      }
    })
  )
  const ok = await until(() => {
    const texts = online.map((x) => file(x.doc).toString())
    return texts.every((s) => s === texts[0])
  }, 30000)
  await wait(300)
  const text = file(online[0].doc).toString()
  const present = (text.match(/\{\d+:\d+\}/g) ?? []).length
  online.concat(peers.filter((x) => x.p.status !== 'online')).forEach((x) => x.p.destroy())
  return { ok, present, expected: online.length * edits, online: online.length, refused, joinMs, p50: pct(lat, 50), p95: pct(lat, 95) }
}

describe('Phase 2 scale', () => {
  it('5 people editing simultaneously', async () => {
    const r = await typeTogether(5, 60)
    const pass = r.ok && r.present === r.expected
    rec('Synchronization with five people editing simultaneously', pass ? 'PASS' : 'FAIL', `${r.present}/${r.expected} edits on all 5; latency p50 ${r.p50} ms, p95 ${r.p95} ms`)
    expect(pass).toBe(true)
  })
  it('10 people editing simultaneously', async () => {
    const r = await typeTogether(10, 40)
    const pass = r.ok && r.present === r.expected && r.online === 10
    rec('Synchronization with ten people editing simultaneously', pass ? 'PASS' : 'FAIL', `${r.online} online, ${r.present}/${r.expected} edits converged; latency p50 ${r.p50} ms, p95 ${r.p95} ms`)
    expect(pass).toBe(true)
  })
  it('20 people joining simultaneously', async () => {
    const r = await typeTogether(20, 20)
    const pass = r.online === 20 && r.ok && r.present === r.expected
    rec('Synchronization with twenty people joining simultaneously', pass ? 'PASS' : 'FAIL', `${r.online}/20 got in (refused: ${r.refused[0] ?? 'none'}); join ${r.joinMs} ms; ${r.present}/${r.expected} edits converged; p95 ${r.p95} ms`)
    expect(pass).toBe(true)
  })
})

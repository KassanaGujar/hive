/**
 * Collaboration stress tests. Defaults to an in-process relay; set RELAY_URL to hit a deployed one
 * (e.g. RELAY_URL=wss://hive-relay.kassanagujar.workers.dev npm run stress).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendFileSync } from 'node:fs'
import * as Y from 'yjs'
import { HiveProvider, docParts, newRoomId, newRoomKey } from '@hive/collab'
import { startRelay, type RelayHandle } from './relay'

let relay: RelayHandle | undefined
let url: string
beforeAll(async () => {
  if (process.env.RELAY_URL) return void (url = process.env.RELAY_URL)
  relay = await startRelay({ port: 0, log: () => {} })
  url = `ws://127.0.0.1:${relay.port}`
})
afterAll(async () => relay?.close())

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms = 30_000, what = 'condition') {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`)
    await wait(15)
  }
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]
const report: string[] = []
const log = (s: string) => {
  report.push(s)
  console.log(`[stress] ${s}`)
}
afterAll(() => {
  const where = url.startsWith('ws://127') ? 'local relay' : url
  appendFileSync(process.env.STRESS_REPORT ?? 'stress-report.txt', `\n== STRESS REPORT (${where}) ${new Date().toISOString()} ==\n${report.join('\n')}\n`)
})

interface Peer {
  doc: Y.Doc
  p: HiveProvider
}

async function room(n: number, opts: { compactAfter?: number } = {}) {
  const roomId = newRoomId()
  const roomKey = newRoomKey()
  const peers: Peer[] = []
  for (let i = 0; i < n; i++) {
    const doc = new Y.Doc()
    const p = new HiveProvider(doc, {
      relayUrl: url,
      roomId,
      roomKey,
      member: { id: `m${i}-${roomId.slice(0, 4)}`, name: `peer${i}`, color: '#f5b400', avatar: '🐝' },
      adminToken: i === 0 ? 'a'.repeat(32) : undefined,
      compactAfter: opts.compactAfter
    })
    await p.connect()
    await until(() => p.status === 'online' || p.status === 'error', 15_000, `peer${i} online`)
    if (p.status !== 'online') throw new Error(`peer${i}: ${p.error}`)
    peers.push({ doc, p })
  }
  return { roomId, roomKey, peers, close: () => peers.forEach((x) => x.p.destroy()) }
}

describe('collaboration under load', () => {
  it('10 people typing in the same file at once converge to identical text', async () => {
    const r = await room(10)
    const texts = r.peers.map((x) => docParts(x.doc).files)
    texts[0].set('shared.js', new Y.Text('// start\n'))
    await until(() => texts.every((t) => t.has('shared.js')), 15_000, 'file on all peers')

    const EDITS = 100
    const t0 = Date.now()
    // everyone types concurrently at random positions, ~1 keystroke every 10–30 ms
    await Promise.all(
      r.peers.map(async (peer, i) => {
        const t = docParts(peer.doc).files.get('shared.js')!
        for (let k = 0; k < EDITS; k++) {
          const pos = Math.floor(Math.random() * (t.length + 1))
          t.insert(pos, `[${i}.${k}]`)
          if (k % 7 === 0 && t.length > 20) t.delete(Math.floor(Math.random() * (t.length - 5)), 2)
          await wait(10 + Math.random() * 20)
        }
      })
    )
    const typingMs = Date.now() - t0
    const final = () => texts.map((t) => t.get('shared.js')!.toString())
    await until(() => new Set(final()).size === 1, 60_000, 'convergence')
    const convergeMs = Date.now() - t0 - typingMs
    const total = 10 * EDITS
    log(`10 peers × ${EDITS} edits (${total} keystrokes, ${(total / (typingMs / 1000)).toFixed(0)}/s) → identical on all peers ${convergeMs} ms after typing stopped`)
    expect(new Set(final()).size).toBe(1)
    r.close()
  })

  it('edit latency stays under 2 s while the room is busy', async () => {
    const r = await room(6)
    const files = r.peers.map((x) => docParts(x.doc).files)
    files[0].set('a.txt', new Y.Text(''))
    files[0].set('noise.txt', new Y.Text(''))
    await until(() => files.every((f) => f.has('a.txt') && f.has('noise.txt')), 15_000, 'files')
    // background noise from 5 peers
    let stop = false
    const noise = r.peers.slice(1).map(async (peer) => {
      const t = docParts(peer.doc).files.get('noise.txt')!
      while (!stop) {
        t.insert(t.length, 'x')
        await wait(20)
      }
    })
    const lat: number[] = []
    for (let i = 0; i < 30; i++) {
      const token = `<${i}>`
      const t0 = performance.now()
      files[0].get('a.txt')!.insert(0, token)
      await until(() => files.slice(1).every((f) => f.get('a.txt')!.toString().includes(token)), 10_000, 'token')
      lat.push(performance.now() - t0)
      await wait(50)
    }
    stop = true
    await Promise.all(noise)
    log(`latency to ALL 5 other peers under load: p50 ${pct(lat, 50).toFixed(0)} ms · p95 ${pct(lat, 95).toFixed(0)} ms · max ${Math.max(...lat).toFixed(0)} ms`)
    expect(pct(lat, 95)).toBeLessThan(2000)
    r.close()
  })

  it('the 11th person is turned away (10-person limit)', async () => {
    const r = await room(10)
    const extra = new HiveProvider(new Y.Doc(), { relayUrl: url, roomId: r.roomId, roomKey: r.roomKey, member: { id: 'eleven', name: 'x', color: '#fff', avatar: '🐝' } })
    await extra.connect()
    await until(() => extra.status === 'error', 15_000, '11th rejected')
    log(`11th member rejected: "${extra.error}"`)
    expect(extra.error).toMatch(/full/)
    extra.destroy()
    r.close()
  })

  it('people dropping and reconnecting mid-edit still converge (offline edits sync)', async () => {
    const r = await room(5)
    const files = r.peers.map((x) => docParts(x.doc).files)
    files[0].set('churn.md', new Y.Text(''))
    await until(() => files.every((f) => f.has('churn.md')), 15_000, 'file')
    await Promise.all(
      r.peers.map(async (peer, i) => {
        for (let round = 0; round < 4; round++) {
          const t = docParts(peer.doc).files.get('churn.md')!
          for (let k = 0; k < 15; k++) {
            t.insert(t.length, `${i}:${round}:${k};`)
            await wait(5)
          }
          if (i > 0 && round % 2 === 0) {
            peer.p.disconnect() // keep editing while offline
            for (let k = 0; k < 10; k++) t.insert(0, `off${i}.${round}.${k};`)
            await wait(100 + Math.random() * 300)
            await peer.p.connect()
            await until(() => peer.p.status === 'online', 15_000, 'reconnect')
          }
        }
      })
    )
    const all = () => files.map((f) => f.get('churn.md')!.toString())
    await until(() => new Set(all()).size === 1, 60_000, 'convergence after churn')
    const text = all()[0]
    const expected = 5 * 4 * 15 + 4 * 2 * 10
    const count = (text.match(/;/g) ?? []).length
    log(`5 peers with disconnect/reconnect churn: converged, ${count}/${expected} edits present`)
    expect(count).toBe(expected)
    r.close()
  })

  it('a friend joining a big project (300 files, ~6 MB) gets everything', async () => {
    const host = await room(1, { compactAfter: 50 })
    const files = docParts(host.peers[0].doc).files
    const body = 'const x = "' + 'lorem ipsum '.repeat(1700) + '"\n' // ~20 KB
    for (let i = 0; i < 300; i++) host.peers[0].doc.transact(() => files.set(`src/file${i}.js`, new Y.Text(`// ${i}\n${body}`)))
    await wait(1500)
    const bytes = Y.encodeStateAsUpdate(host.peers[0].doc).length
    const doc = new Y.Doc()
    const t0 = Date.now()
    const friend = new HiveProvider(doc, { relayUrl: url, roomId: host.roomId, roomKey: host.roomKey, member: { id: 'friend', name: 'f', color: '#fff', avatar: '🐼' }, compactAfter: 50 })
    await friend.connect()
    await until(() => docParts(doc).files.size === 300, 60_000, 'all files on friend')
    const ms = Date.now() - t0
    log(`join: 300 files / ${(bytes / 1024 / 1024).toFixed(1)} MB synced to a new member in ${ms} ms`)
    expect(docParts(doc).files.get('src/file299.js')!.toString()).toContain('// 299')
    // a second joiner after compaction (the log was rolled into one encrypted snapshot)
    const doc2 = new Y.Doc()
    const late = new HiveProvider(doc2, { relayUrl: url, roomId: host.roomId, roomKey: host.roomKey, member: { id: 'late', name: 'l', color: '#fff', avatar: '🦊' } })
    await late.connect()
    await until(() => docParts(doc2).files.size === 300, 60_000, 'late joiner after compaction')
    log('late joiner after log compaction: all 300 files present')
    friend.destroy()
    late.destroy()
    host.close()
  })
})

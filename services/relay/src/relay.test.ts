import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { HiveProvider, newRoomId, newRoomKey, newInviteCode, sealInvite, openInvite, docParts, sha256Hex } from '@hive/collab'
import { startRelay, type RelayHandle } from './relay'

let relay: RelayHandle
let url: string
// RELAY_URL=ws://127.0.0.1:8787 runs the same tests against the Cloudflare relay (wrangler dev).
beforeAll(async () => {
  if (process.env.RELAY_URL) return void (url = process.env.RELAY_URL)
  relay = await startRelay({ port: 0, log: () => {} })
  url = `ws://127.0.0.1:${relay.port}`
})
afterAll(async () => relay?.close())

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout')
    await wait(20)
  }
}
const member = (id: string) => ({ id, name: id, color: '#f00', avatar: '🐝' })

describe('roles are enforced by the relay', () => {
  it('a join without the edit token is a viewer whose edits never reach anyone; with it, an editor', async () => {
    const room = newRoomId()
    const key = newRoomKey()
    const token = 'edit-token-for-test'
    const host = new Y.Doc(), viewer = new Y.Doc(), editor = new Y.Doc()
    const ph = new HiveProvider(host, { relayUrl: url, roomId: room, roomKey: key, member: member('h'), adminToken: 'y'.repeat(32), editHash: await sha256Hex(token) })
    await ph.connect()
    await until(() => ph.status === 'online')
    docParts(host).files.set('a.js', new Y.Text('start'))
    const pv = new HiveProvider(viewer, { relayUrl: url, roomId: room, roomKey: key, member: member('v') })
    const pe = new HiveProvider(editor, { relayUrl: url, roomId: room, roomKey: key, member: member('e'), editToken: token })
    await pv.connect()
    await pe.connect()
    await until(() => pv.status === 'online' && pe.status === 'online' && ph.members.length === 3)
    expect(ph.members.find((m) => m.id === 'v')?.role).toBe('viewer')
    expect(ph.members.find((m) => m.id === 'e')?.role).toBe('editor')
    await until(() => docParts(viewer).files.get('a.js')?.toString() === 'start')
    docParts(viewer).files.get('a.js')!.insert(0, 'VIEWER ')
    docParts(editor).files.get('a.js')!.insert(5, ' EDITOR')
    await until(() => docParts(host).files.get('a.js')!.toString().includes('EDITOR'))
    await wait(500)
    expect(docParts(host).files.get('a.js')!.toString()).not.toContain('VIEWER')
    expect(pv.status).toBe('online')
    ;[ph, pv, pe].forEach((p) => p.destroy())
  })
})

describe('relay restart safety', () => {
  it('a snapshot claiming entries the relay never handed out is ignored (stale client counter)', async () => {
    const room = newRoomId()
    const key = newRoomKey()
    const a = new Y.Doc(), b = new Y.Doc()
    const pa = new HiveProvider(a, { relayUrl: url, roomId: room, roomKey: key, member: member('sa'), adminToken: 'z'.repeat(32) })
    await pa.connect()
    await until(() => pa.status === 'online')
    docParts(a).files.set('f.js', new Y.Text('one'))
    await wait(200)
    // a client with a stale, too-high counter tries to compact the log
    ;(pa as any).send({ t: 'snapshot', data: await (pa as any).seal(Y.encodeStateAsUpdate(new Y.Doc())), upTo: 999999 })
    await wait(200)
    docParts(a).files.get('f.js')!.insert(3, ' two')
    await wait(300)
    const pb = new HiveProvider(b, { relayUrl: url, roomId: room, roomKey: key, member: member('sb') })
    await pb.connect()
    await until(() => docParts(b).files.get('f.js')?.toString() === 'one two', 5000)
    expect(docParts(b).files.get('f.js')!.toString()).toBe('one two')
    pa.destroy(); pb.destroy()
  })
})

describe('relay + provider', () => {
  it('syncs edits both ways within 2 seconds, encrypted', async () => {
    const room = newRoomId()
    const key = newRoomKey()
    const a = new Y.Doc()
    const b = new Y.Doc()
    const pa = new HiveProvider(a, { relayUrl: url, roomId: room, roomKey: key, member: member('host'), adminToken: 'x'.repeat(32) })
    await pa.connect()
    await until(() => pa.status === 'online')
    docParts(a).files.set('index.html', new Y.Text('<h1>hi</h1>'))
    const pb = new HiveProvider(b, { relayUrl: url, roomId: room, roomKey: key, member: member('friend') })
    await pb.connect()
    await until(() => pb.status === 'online')
    await until(() => docParts(b).files.get('index.html')?.toString() === '<h1>hi</h1>')

    const t0 = Date.now()
    docParts(b).files.get('index.html')!.insert(4, 'oh ')
    await until(() => docParts(a).files.get('index.html')!.toString() === '<h1>oh hi</h1>')
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(pa.members.length).toBe(2)
    pa.destroy()
    pb.destroy()
  })

  it('rejects a wrong room key', async () => {
    const room = newRoomId()
    const a = new Y.Doc()
    const pa = new HiveProvider(a, { relayUrl: url, roomId: room, roomKey: newRoomKey(), member: member('h'), adminToken: 'y'.repeat(32) })
    await pa.connect()
    await until(() => pa.status === 'online')
    a.getMap('m').set('k', 1)
    await wait(100)
    const pb = new HiveProvider(new Y.Doc(), { relayUrl: url, roomId: room, roomKey: newRoomKey(), member: member('evil') })
    await pb.connect()
    await until(() => pb.status === 'error')
    expect(pb.error).toMatch(/key/)
    pa.destroy()
    pb.destroy()
  })

  it('sends offline edits on reconnect', async () => {
    const room = newRoomId()
    const key = newRoomKey()
    const a = new Y.Doc()
    const b = new Y.Doc()
    const pa = new HiveProvider(a, { relayUrl: url, roomId: room, roomKey: key, member: member('h'), adminToken: 'z'.repeat(32) })
    await pa.connect()
    await until(() => pa.status === 'online')
    const pb = new HiveProvider(b, { relayUrl: url, roomId: room, roomKey: key, member: member('f') })
    await pb.connect()
    await until(() => pb.status === 'online')
    pb.disconnect()
    b.getArray('chat').push(['written offline'])
    await pb.connect()
    await until(() => a.getArray('chat').length === 1)
    pa.destroy()
    pb.destroy()
  })

  it('code-only invites round-trip through the relay', async () => {
    const room = newRoomId()
    const key = newRoomKey()
    const pa = new HiveProvider(new Y.Doc(), { relayUrl: url, roomId: room, roomKey: key, member: member('h'), adminToken: 'w'.repeat(32) })
    await pa.connect()
    await until(() => pa.status === 'online')
    const code = newInviteCode()
    pa.publishInvite(code, await sealInvite(code, { relayUrl: url, roomId: room, roomKey: key, projectName: 'p', role: 'editor' }))
    await wait(100)
    const sealed = await HiveProvider.fetchInvite(url, code)
    expect(sealed).toBeTruthy()
    const info = await openInvite(code, sealed!)
    expect(info.roomKey).toBe(key)
    pa.destroy()
  })
})

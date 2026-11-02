import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { HiveProvider, newRoomId, newRoomKey, newInviteCode, sealInvite, openInvite, docParts } from '@hive/collab'
import { startRelay, type RelayHandle } from './relay'

let relay: RelayHandle
let url: string
beforeAll(async () => {
  relay = await startRelay({ port: 0, log: () => {} })
  url = `ws://127.0.0.1:${relay.port}`
})
afterAll(async () => relay.close())

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout')
    await wait(20)
  }
}
const member = (id: string) => ({ id, name: id, color: '#f00', avatar: '🐝' })

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

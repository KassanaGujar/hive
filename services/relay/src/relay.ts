import { createServer, type Server } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { promises as fs, mkdirSync } from 'node:fs'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMsg, MemberInfo, ServerMsg } from '@hive/collab'

/**
 * Hive relay. Holds one append-only log of ENCRYPTED Yjs updates per room and forwards updates and
 * presence between members. It never has the room key, so it can't read code, chat or plans.
 */
export interface RelayOptions {
  port?: number
  host?: string
  dataDir?: string
  maxMembers?: number
  maxLogEntries?: number
  maxMessageBytes?: number
  log?: (msg: string) => void
}

interface Room {
  id: string
  adminHash: string
  seq: number
  log: { seq: number; data: string }[]
  members: Map<string, { info: MemberInfo; sockets: Set<WebSocket> }>
  banned: Set<string>
  dirty: boolean
}

interface Invite {
  code: string
  room: string
  sealed: string
  expiresAt: number
}

const INVITE_TTL = 24 * 60 * 60 * 1000
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function sameHash(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export interface RelayHandle {
  port: number
  close(): Promise<void>
  stats(): { rooms: number; sockets: number }
}

export async function startRelay(opts: RelayOptions = {}): Promise<RelayHandle> {
  const log = opts.log ?? ((m: string) => console.log(`[relay] ${m}`))
  const maxMembers = opts.maxMembers ?? 10
  const maxLog = opts.maxLogEntries ?? 20_000
  const maxBytes = opts.maxMessageBytes ?? 8 * 1024 * 1024
  const dataDir = opts.dataDir
  const rooms = new Map<string, Room>()
  const invites = new Map<string, Invite>()
  const sockMeta = new WeakMap<WebSocket, { room?: Room; memberId?: string; lastInviteGet?: number }>()
  if (dataDir) mkdirSync(dataDir, { recursive: true })

  // ---------- persistence (snapshots to disk) ----------
  const roomFile = (id: string) => path.join(dataDir!, `room-${id.replace(/[^a-z0-9]/gi, '')}.json`)
  async function loadRoom(id: string): Promise<Room | null> {
    if (!dataDir) return null
    try {
      const j = JSON.parse(await fs.readFile(roomFile(id), 'utf8'))
      const members = new Map<string, { info: MemberInfo; sockets: Set<WebSocket> }>()
      for (const m of j.members ?? []) members.set(m.id, { info: { ...m, online: false }, sockets: new Set() })
      return { id, adminHash: j.adminHash, seq: j.seq, log: j.log, members, banned: new Set(j.banned ?? []), dirty: false }
    } catch {
      return null
    }
  }
  async function saveAll() {
    if (!dataDir) return
    for (const r of rooms.values()) {
      if (!r.dirty) continue
      r.dirty = false
      const j = { adminHash: r.adminHash, seq: r.seq, log: r.log, banned: [...r.banned], members: [...r.members.values()].map((m) => m.info) }
      const tmp = roomFile(r.id) + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(j))
      await fs.rename(tmp, roomFile(r.id))
    }
    const now = Date.now()
    for (const [k, v] of invites) if (v.expiresAt < now) invites.delete(k)
    await fs.writeFile(path.join(dataDir, 'invites.json'), JSON.stringify([...invites.values()]))
  }
  if (dataDir) {
    try {
      for (const i of JSON.parse(await fs.readFile(path.join(dataDir, 'invites.json'), 'utf8')) as Invite[]) invites.set(i.code, i)
    } catch {
      /* none yet */
    }
  }
  const saveTimer = setInterval(() => saveAll().catch((e) => log(`save failed: ${e}`)), 5_000)

  // ---------- http + ws ----------
  const server: Server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, service: 'hive-relay' }))
      return
    }
    res.writeHead(404).end()
  })
  const wss = new WebSocketServer({ server, maxPayload: maxBytes })

  const send = (ws: WebSocket, m: ServerMsg) => ws.readyState === 1 && ws.send(JSON.stringify(m))
  const memberList = (r: Room): MemberInfo[] => [...r.members.values()].map((m) => ({ ...m.info, online: m.sockets.size > 0 }))
  const broadcast = (r: Room, m: ServerMsg, except?: WebSocket) => {
    const s = JSON.stringify(m)
    for (const mem of r.members.values()) for (const ws of mem.sockets) if (ws !== except && ws.readyState === 1) ws.send(s)
  }
  const isAdmin = (r: Room, token: string) => sameHash(r.adminHash, sha(token))

  async function getRoom(id: string): Promise<Room | null> {
    return rooms.get(id) ?? (await loadRoom(id).then((r) => (r && rooms.set(id, r), r)))
  }

  function attach(ws: WebSocket, r: Room, member: ClientMsg & { t: 'join' | 'create' }, role: MemberInfo['role']) {
    const m = member.member
    let entry = r.members.get(m.id)
    if (!entry) {
      if (r.members.size >= maxMembers) return send(ws, { t: 'error', message: `This project is full (${maxMembers} people max).` })
      entry = { info: { ...m, role, online: true }, sockets: new Set() }
      r.members.set(m.id, entry)
      r.dirty = true
    } else {
      entry.info = { ...entry.info, name: m.name, color: m.color, avatar: m.avatar }
      if (role === 'host') entry.info.role = 'host'
    }
    entry.sockets.add(ws)
    sockMeta.set(ws, { room: r, memberId: m.id })
    send(ws, { t: 'joined', room: r.id, you: m.id, members: memberList(r), log: r.log })
    broadcast(r, { t: 'members', members: memberList(r) }, ws)
  }

  wss.on('connection', (ws) => {
    sockMeta.set(ws, {})
    ws.on('message', async (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return send(ws, { t: 'error', message: 'bad message' })
      }
      const meta = sockMeta.get(ws)!
      const r = meta.room
      try {
        switch (msg.t) {
          case 'ping':
            return send(ws, { t: 'pong' })
          case 'create': {
            if (!/^[a-f0-9]{8,64}$/.test(msg.room) || msg.adminToken.length < 16) return send(ws, { t: 'error', message: 'bad room' })
            let room = await getRoom(msg.room)
            if (room && !isAdmin(room, msg.adminToken)) return send(ws, { t: 'error', message: 'Room exists and you are not its host.' })
            if (!room) {
              room = { id: msg.room, adminHash: sha(msg.adminToken), seq: 0, log: [], members: new Map(), banned: new Set(), dirty: true }
              rooms.set(room.id, room)
              log(`room created ${room.id.slice(0, 6)}…`)
            }
            return attach(ws, room, msg, 'host')
          }
          case 'join': {
            const room = await getRoom(msg.room)
            if (!room) return send(ws, { t: 'error', message: 'That project was not found on this relay. Check the invite.' })
            if (room.banned.has(msg.member.id)) return send(ws, { t: 'kicked' })
            return attach(ws, room, msg, 'editor')
          }
          case 'update': {
            if (!r || !meta.memberId) return
            const me = r.members.get(meta.memberId)
            if (me?.info.role === 'viewer') return send(ws, { t: 'error', message: 'Viewers can not edit.' })
            const seq = ++r.seq
            r.log.push({ seq, data: msg.data })
            if (r.log.length > maxLog) r.log.splice(0, r.log.length - maxLog)
            r.dirty = true
            broadcast(r, { t: 'update', seq, from: meta.memberId, data: msg.data }, ws)
            return
          }
          case 'awareness':
            if (r && meta.memberId) broadcast(r, { t: 'awareness', from: meta.memberId, data: msg.data }, ws)
            return
          case 'snapshot': {
            if (!r) return
            // Keep entries newer than the snapshot so concurrent edits aren't lost.
            r.log = [{ seq: msg.upTo, data: msg.data }, ...r.log.filter((e) => e.seq > msg.upTo)]
            r.dirty = true
            return
          }
          case 'invite:create': {
            if (!r || !isAdmin(r, msg.adminToken)) return send(ws, { t: 'error', message: 'Only the host can invite.' })
            if (!/^[A-Z0-9]{6}$/.test(msg.code)) return
            invites.set(msg.code, { code: msg.code, room: r.id, sealed: msg.sealed, expiresAt: Date.now() + INVITE_TTL })
            return
          }
          case 'invite:get': {
            // light rate limit against code guessing
            const now = Date.now()
            if (meta.lastInviteGet && now - meta.lastInviteGet < 1000) return send(ws, { t: 'invite', code: msg.code, sealed: null })
            meta.lastInviteGet = now
            const inv = invites.get(String(msg.code).toUpperCase())
            const ok = inv && inv.expiresAt > now
            return send(ws, { t: 'invite', code: msg.code, sealed: ok ? inv!.sealed : null })
          }
          case 'role': {
            if (!r || !isAdmin(r, msg.adminToken)) return
            const m = r.members.get(msg.memberId)
            if (m && m.info.role !== 'host') {
              m.info.role = msg.role
              r.dirty = true
              broadcast(r, { t: 'members', members: memberList(r) })
            }
            return
          }
          case 'kick': {
            if (!r || !isAdmin(r, msg.adminToken)) return
            const m = r.members.get(msg.memberId)
            if (!m || m.info.role === 'host') return
            r.banned.add(msg.memberId)
            r.members.delete(msg.memberId)
            r.dirty = true
            for (const s of m.sockets) {
              send(s, { t: 'kicked' })
              s.close()
            }
            broadcast(r, { t: 'members', members: memberList(r) })
            return
          }
        }
      } catch (e) {
        log(`error: ${(e as Error).message}`)
        send(ws, { t: 'error', message: 'relay error' })
      }
    })
    ws.on('close', () => {
      const meta = sockMeta.get(ws)
      if (!meta?.room || !meta.memberId) return
      const m = meta.room.members.get(meta.memberId)
      m?.sockets.delete(ws)
      broadcast(meta.room, { t: 'members', members: memberList(meta.room) })
    })
  })

  const port = await new Promise<number>((resolve) => {
    server.listen(opts.port ?? 4455, opts.host ?? '0.0.0.0', () => resolve((server.address() as any).port))
  })
  log(`listening on ${port}${dataDir ? `, data in ${dataDir}` : ''}`)

  return {
    port,
    stats: () => ({ rooms: rooms.size, sockets: wss.clients.size }),
    async close() {
      clearInterval(saveTimer)
      await saveAll().catch(() => {})
      for (const c of wss.clients) c.terminate()
      wss.close()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }
}

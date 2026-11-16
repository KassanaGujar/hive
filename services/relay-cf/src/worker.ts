/**
 * Hive relay on Cloudflare: always on, free tier, no PC needed — Google Docs-style availability.
 *
 * Same wire protocol as services/relay (see packages/collab/src/protocol.ts). Each project room is
 * one Durable Object holding an append-only log of ENCRYPTED Yjs updates; it never has the room key.
 * Clients connect to `wss://<worker>/?room=<roomId>` (or `?invite=1` to look up a code).
 * WebSockets use hibernation, so idle rooms cost nothing.
 */
import { DurableObject } from 'cloudflare:workers'

interface Env {
  ROOMS: DurableObjectNamespace<Room>
  INVITES: DurableObjectNamespace<Invites>
}

type Role = 'host' | 'editor' | 'viewer'
interface MemberInfo {
  id: string
  name: string
  color: string
  avatar: string
  role: Role
  online: boolean
}
interface Attachment {
  memberId?: string
  lastInviteGet?: number
}

const MAX_MEMBERS = 25
const MAX_LOG = 20_000
const CHUNK = 1_000_000 // SQLite values are capped at 2 MB; big snapshots are split
const INVITE_TTL = 24 * 60 * 60 * 1000

async function sha256(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const send = (ws: WebSocket, m: unknown) => {
  try {
    ws.send(JSON.stringify(m))
  } catch {
    /* closed */
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.headers.get('Upgrade') !== 'websocket') {
      if (url.pathname === '/' || url.pathname === '/health') {
        return Response.json({ ok: true, service: 'hive-relay', runtime: 'cloudflare' })
      }
      return new Response('Not found', { status: 404 })
    }
    if (url.searchParams.get('invite')) return env.INVITES.get(env.INVITES.idFromName('global')).fetch(req)
    const room = url.searchParams.get('room') ?? ''
    if (!/^[a-f0-9]{8,64}$/.test(room)) return new Response('room required', { status: 400 })
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req)
  }
}

export class Room extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS log (seq INTEGER, part INTEGER, data TEXT, PRIMARY KEY (seq, part));
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, json TEXT);
      CREATE TABLE IF NOT EXISTS banned (id TEXT PRIMARY KEY);
    `)
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'))
  }

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({} satisfies Attachment)
    const room = new URL(req.url).searchParams.get('room')!
    if (!this.meta('id')) this.setMeta('id', room)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // ---------- storage helpers ----------
  private meta(k: string): string | null {
    const r = this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]
    return r ? r.v : null
  }
  private setMeta(k: string, v: string) {
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v)
  }
  private seq() {
    return Number(this.meta('seq') ?? 0)
  }
  private append(seq: number, data: string) {
    for (let i = 0, part = 0; i < data.length || part === 0; i += CHUNK, part++) {
      this.sql.exec('INSERT OR REPLACE INTO log (seq, part, data) VALUES (?, ?, ?)', seq, part, data.slice(i, i + CHUNK))
    }
  }
  private readLog(): { seq: number; data: string }[] {
    const out: { seq: number; data: string }[] = []
    for (const r of this.sql.exec<{ seq: number; data: string }>('SELECT seq, data FROM log ORDER BY seq, part')) {
      const last = out[out.length - 1]
      if (last && last.seq === r.seq) last.data += r.data
      else out.push({ seq: r.seq, data: r.data })
    }
    return out
  }
  private members(): Map<string, MemberInfo> {
    const m = new Map<string, MemberInfo>()
    for (const r of this.sql.exec<{ json: string }>('SELECT json FROM members')) {
      const info = JSON.parse(r.json) as MemberInfo
      m.set(info.id, info)
    }
    return m
  }
  private saveMember(info: MemberInfo) {
    this.sql.exec('INSERT OR REPLACE INTO members (id, json) VALUES (?, ?)', info.id, JSON.stringify(info))
  }
  private socketsOf(memberId: string) {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment)?.memberId === memberId)
  }
  private memberList(): MemberInfo[] {
    const online = new Set(this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment)?.memberId).filter(Boolean))
    return [...this.members().values()].map((m) => ({ ...m, online: online.has(m.id) }))
  }
  private broadcast(m: unknown, except?: WebSocket) {
    const s = JSON.stringify(m)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || !(ws.deserializeAttachment() as Attachment)?.memberId) continue
      try {
        ws.send(s)
      } catch {
        /* closed */
      }
    }
  }
  private async isAdmin(token: string) {
    const h = this.meta('adminHash')
    return !!h && h === (await sha256(token))
  }

  private attach(ws: WebSocket, member: Omit<MemberInfo, 'role' | 'online'>, role: Role) {
    const members = this.members()
    let info = members.get(member.id)
    if (!info) {
      if (members.size >= MAX_MEMBERS) return send(ws, { t: 'error', message: `This project is full (${MAX_MEMBERS} people max).` })
      info = { ...member, role, online: true }
    } else {
      info = { ...info, name: member.name, color: member.color, avatar: member.avatar, role: role === 'host' ? 'host' : role === 'editor' && info.role === 'viewer' ? 'editor' : info.role }
    }
    this.saveMember(info)
    ws.serializeAttachment({ memberId: info.id } satisfies Attachment)
    send(ws, { t: 'joined', room: this.meta('id'), you: info.id, members: this.memberList(), log: this.readLog() })
    this.broadcast({ t: 'members', members: this.memberList() }, ws)
  }

  // ---------- protocol ----------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: any
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return send(ws, { t: 'error', message: 'bad message' })
    }
    const att = (ws.deserializeAttachment() as Attachment) ?? {}
    const me = att.memberId
    switch (msg.t) {
      case 'ping':
        return send(ws, { t: 'pong' })
      case 'create': {
        if (typeof msg.adminToken !== 'string' || msg.adminToken.length < 16) return send(ws, { t: 'error', message: 'bad room' })
        const existing = this.meta('adminHash')
        if (existing && !(await this.isAdmin(msg.adminToken))) return send(ws, { t: 'error', message: 'Room exists and you are not its host.' })
        if (!existing) this.setMeta('adminHash', await sha256(msg.adminToken))
        if (!this.meta('editHash') && typeof msg.editHash === 'string' && /^[a-f0-9]{64}$/.test(msg.editHash)) this.setMeta('editHash', msg.editHash)
        return this.attach(ws, msg.member, 'host')
      }
      case 'join': {
        if (!this.meta('adminHash')) return send(ws, { t: 'error', message: 'That project was not found on this relay. Check the invite.' })
        if (this.sql.exec('SELECT 1 FROM banned WHERE id = ?', msg.member?.id).toArray().length) return send(ws, { t: 'kicked' })
        const editHash = this.meta('editHash')
        const canEdit = !editHash || (typeof msg.editToken === 'string' && (await sha256(msg.editToken)) === editHash)
        return this.attach(ws, msg.member, canEdit ? 'editor' : 'viewer')
      }
      case 'update': {
        if (!me) return
        if (this.members().get(me)?.role === 'viewer') return send(ws, { t: 'error', message: 'Viewers can not edit.' })
        const seq = this.seq() + 1
        this.setMeta('seq', String(seq))
        this.append(seq, String(msg.data))
        const count = this.sql.exec<{ n: number }>('SELECT COUNT(DISTINCT seq) AS n FROM log').one().n
        if (count > MAX_LOG) this.sql.exec('DELETE FROM log WHERE seq <= ?', seq - MAX_LOG)
        this.broadcast({ t: 'update', seq, from: me, data: msg.data }, ws)
        return
      }
      case 'awareness':
        if (me) this.broadcast({ t: 'awareness', from: me, data: msg.data }, ws)
        return
      case 'snapshot': {
        if (!me || this.members().get(me)?.role === 'viewer') return
        const upTo = Number(msg.upTo)
        if (!Number.isFinite(upTo) || upTo > this.seq()) return // can't cover entries never handed out
        // keep entries newer than the snapshot so concurrent edits aren't lost
        this.sql.exec('DELETE FROM log WHERE seq <= ?', upTo)
        this.append(upTo, String(msg.data))
        return
      }
      case 'invite:create': {
        if (!me || !(await this.isAdmin(msg.adminToken))) return send(ws, { t: 'error', message: 'Only the host can invite.' })
        if (!/^[A-Z0-9]{6}$/.test(msg.code)) return
        await this.env.INVITES.get(this.env.INVITES.idFromName('global')).put(msg.code, String(msg.sealed), Date.now() + INVITE_TTL)
        return
      }
      case 'role': {
        if (!(await this.isAdmin(msg.adminToken))) return
        const m = this.members().get(msg.memberId)
        if (m && m.role !== 'host' && (msg.role === 'editor' || msg.role === 'viewer')) {
          this.saveMember({ ...m, role: msg.role })
          this.broadcast({ t: 'members', members: this.memberList() })
        }
        return
      }
      case 'kick': {
        if (!(await this.isAdmin(msg.adminToken))) return
        const m = this.members().get(msg.memberId)
        if (!m || m.role === 'host') return
        this.sql.exec('INSERT OR IGNORE INTO banned (id) VALUES (?)', m.id)
        this.sql.exec('DELETE FROM members WHERE id = ?', m.id)
        for (const s of this.socketsOf(m.id)) {
          send(s, { t: 'kicked' })
          s.close(1000, 'removed')
        }
        this.broadcast({ t: 'members', members: this.memberList() })
        return
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.serializeAttachment({})
    this.broadcast({ t: 'members', members: this.memberList() })
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws)
  }
}

/** Invite codes → sealed room info (encrypted with a key derived from the code). Expire after 24 h. */
export class Invites extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, sealed TEXT, expires INTEGER)')
  }

  async put(code: string, sealed: string, expires: number) {
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM invites WHERE expires < ?', Date.now())
    sql.exec('INSERT OR REPLACE INTO invites (code, sealed, expires) VALUES (?, ?, ?)', code, sealed, expires)
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({} satisfies Attachment)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: any
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return
    }
    if (msg.t !== 'invite:get') return
    const att = (ws.deserializeAttachment() as Attachment) ?? {}
    const now = Date.now()
    // light rate limit against code guessing
    if (att.lastInviteGet && now - att.lastInviteGet < 1000) return send(ws, { t: 'invite', code: msg.code, sealed: null })
    ws.serializeAttachment({ ...att, lastInviteGet: now })
    const code = String(msg.code ?? '').toUpperCase()
    const row = this.ctx.storage.sql
      .exec<{ sealed: string }>('SELECT sealed FROM invites WHERE code = ? AND expires > ?', code, now)
      .toArray()[0]
    send(ws, { t: 'invite', code: msg.code, sealed: row ? row.sealed : null })
  }
}

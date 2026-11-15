import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { decrypt, encrypt, fromB64, importKey, toB64 } from './crypto'
import type { ClientMsg, MemberHello, MemberInfo, ServerMsg } from './protocol'

export type ProviderStatus = 'connecting' | 'online' | 'offline' | 'error'

export interface ProviderOptions {
  relayUrl: string
  roomId: string
  roomKey: string
  member: MemberHello
  /** Present for the host: creates the room and allows invites, roles and kicks. */
  adminToken?: string
  /** Host: sha256 of the edit token, registered when the room is created. */
  editHash?: string
  /** Joiner: proves the invite allows editing. Without it the relay makes you a viewer. */
  editToken?: string
  /** Compact the relay log into one snapshot when it grows past this many entries. */
  compactAfter?: number
}

type Listener = (...args: any[]) => void

/**
 * Syncs a Y.Doc through the Hive relay with end-to-end encryption. Works offline: local edits stay
 * in the doc and are sent as one diff when the connection comes back.
 */
export class HiveProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  status: ProviderStatus = 'connecting'
  members: MemberInfo[] = []
  error?: string
  /** True after a disconnect until the first successful resync. */
  hadOfflinePeriod = false
  private ws?: WebSocket
  private key?: CryptoKey
  private lastSeq = 0
  private backoff = 500
  private closed = false
  private listeners = new Map<string, Set<Listener>>()
  private pending: ((m: ServerMsg) => boolean)[] = []
  private pingTimer?: ReturnType<typeof setInterval>

  constructor(doc: Y.Doc, private opts: ProviderOptions) {
    this.doc = doc
    this.awareness = new Awareness(doc)
    doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
  }

  on(ev: 'status' | 'members' | 'synced' | 'error' | 'kicked', fn: Listener) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set())
    this.listeners.get(ev)!.add(fn)
    return () => this.listeners.get(ev)!.delete(fn)
  }

  private emit(ev: string, ...args: any[]) {
    this.listeners.get(ev)?.forEach((f) => f(...args))
  }

  async connect() {
    this.key ??= await importKey(this.opts.roomKey)
    this.closed = false
    this.setStatus('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(withParam(this.opts.relayUrl, 'room', this.opts.roomId))
    } catch (e: any) {
      this.fail(e?.message ?? 'Bad relay URL')
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.backoff = 500
      const m = this.opts.member
      this.send(
        this.opts.adminToken
          ? { t: 'create', room: this.opts.roomId, adminToken: this.opts.adminToken, member: m, editHash: this.opts.editHash }
          : { t: 'join', room: this.opts.roomId, member: m, editToken: this.opts.editToken }
      )
      this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 25_000)
    }
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMsg).catch((e) => this.fail(String(e?.message ?? e)))
    ws.onclose = () => {
      clearInterval(this.pingTimer)
      if (this.status === 'online') this.hadOfflinePeriod = true
      if (this.closed) return
      this.setStatus('offline')
      setTimeout(() => !this.closed && this.connect(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, 15_000)
    }
    ws.onerror = () => {
      /* onclose handles retry */
    }
  }

  disconnect() {
    this.closed = true
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    this.ws?.close()
    this.setStatus('offline')
  }

  destroy() {
    this.disconnect()
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    this.awareness.destroy()
  }

  private setStatus(s: ProviderStatus) {
    this.status = s
    this.emit('status', s)
  }

  private fail(msg: string) {
    this.error = msg
    this.setStatus('error')
    this.emit('error', msg)
  }

  private send(m: ClientMsg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m))
  }

  private async seal(u: Uint8Array) {
    return toB64(await encrypt(this.key!, u))
  }

  private async open(b64: string) {
    try {
      return await decrypt(this.key!, fromB64(b64))
    } catch {
      throw new Error('Could not decrypt room data — the invite key is wrong.')
    }
  }

  /** The relay's view of my role (viewers' edits are refused, so they are never sent). */
  get role(): MemberInfo['role'] | undefined {
    return this.members.find((m) => m.id === this.opts.member.id)?.role
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote' || this.status !== 'online' || this.role === 'viewer') return
    this.seal(update).then((data) => this.send({ t: 'update', data }))
  }

  private onAwarenessUpdate = ({ added, updated, removed }: any, origin: unknown) => {
    if (origin === 'remote' || this.status !== 'online') return
    const changed = [...added, ...updated, ...removed]
    const u = encodeAwarenessUpdate(this.awareness, changed)
    this.seal(u).then((data) => this.send({ t: 'awareness', data }))
  }

  private async onMessage(m: ServerMsg) {
    for (const p of [...this.pending]) if (p(m)) this.pending.splice(this.pending.indexOf(p), 1)
    switch (m.t) {
      case 'joined': {
        this.members = m.members
        this.emit('members', m.members)
        // Rebuild what the relay has, then send only what it lacks (our offline edits).
        const remote = new Y.Doc()
        for (const e of m.log) {
          const u = await this.open(e.data)
          Y.applyUpdate(remote, u)
          Y.applyUpdate(this.doc, u, 'remote')
          this.lastSeq = Math.max(this.lastSeq, e.seq)
        }
        const missing = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(remote))
        this.setStatus('online')
        const viewer = this.role === 'viewer'
        if (missing.length > 2 && !viewer) this.send({ t: 'update', data: await this.seal(missing) })
        if (!viewer && m.log.length > (this.opts.compactAfter ?? 300)) {
          this.send({ t: 'snapshot', data: await this.seal(Y.encodeStateAsUpdate(this.doc)), upTo: this.lastSeq })
        }
        // announce our cursor/presence
        const local = this.awareness.getLocalState()
        if (local) this.awareness.setLocalState({ ...local })
        this.emit('synced', this.hadOfflinePeriod)
        this.hadOfflinePeriod = false
        remote.destroy()
        break
      }
      case 'update': {
        Y.applyUpdate(this.doc, await this.open(m.data), 'remote')
        this.lastSeq = Math.max(this.lastSeq, m.seq)
        break
      }
      case 'awareness':
        applyAwarenessUpdate(this.awareness, await this.open(m.data), 'remote')
        break
      case 'members':
        this.members = m.members
        this.emit('members', m.members)
        break
      case 'kicked':
        this.closed = true
        this.ws?.close()
        this.fail('You were removed from this project by the host.')
        this.emit('kicked')
        break
      case 'error':
        // a refused edit is not a connection failure
        if (/Viewers can not edit/.test(m.message)) this.emit('error', m.message)
        else this.fail(m.message)
        break
    }
  }

  // ---------- host actions ----------

  private request<T extends ServerMsg['t']>(msg: ClientMsg, reply: T, timeoutMs = 8000) {
    return new Promise<Extract<ServerMsg, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Relay did not answer')), timeoutMs)
      this.pending.push((m) => {
        if (m.t === reply) {
          clearTimeout(timer)
          resolve(m as Extract<ServerMsg, { t: T }>)
          return true
        }
        return false
      })
      this.send(msg)
    })
  }

  publishInvite(code: string, sealed: string) {
    if (!this.opts.adminToken) throw new Error('Only the host can invite')
    this.send({ t: 'invite:create', code, sealed, adminToken: this.opts.adminToken })
  }

  setRole(memberId: string, role: 'editor' | 'viewer') {
    if (this.opts.adminToken) this.send({ t: 'role', adminToken: this.opts.adminToken, memberId, role })
  }

  kick(memberId: string) {
    if (this.opts.adminToken) this.send({ t: 'kick', adminToken: this.opts.adminToken, memberId })
  }

  /** Look up a code-only invite on a relay without joining a room. */
  static async fetchInvite(relayUrl: string, code: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(withParam(relayUrl, 'invite', '1'))
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('Could not reach the relay'))
      }, 8000)
      ws.onopen = () => ws.send(JSON.stringify({ t: 'invite:get', code } satisfies ClientMsg))
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as ServerMsg
        if (m.t === 'invite') {
          clearTimeout(timer)
          ws.close()
          resolve(m.sealed)
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Could not reach the relay'))
      }
    })
  }
}

/** Relays route by query string (Cloudflare picks the room's Durable Object from it). */
export function withParam(url: string, key: string, value: string) {
  const u = new URL(url)
  u.searchParams.set(key, value)
  return u.toString()
}

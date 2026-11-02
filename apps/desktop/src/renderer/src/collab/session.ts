import * as Y from 'yjs'
import {
  HiveProvider,
  docParts,
  setText,
  sha256Hex,
  toB64,
  fromB64,
  makeFeedEvent,
  shouldCoalesce,
  diffPreview,
  newRoomId,
  newRoomKey,
  newInviteCode,
  sealInvite,
  inviteLink,
  toB64Url,
  randomBytes,
  MAX_SHARED_FILE_BYTES,
  MAX_FEED,
  type ChatMsg,
  type InviteInfo
} from '@hive/collab'
import type { FeedEvent } from '@hive/shared'
import { invoke, on, COLORS } from '../lib/api'
import { useStore, actorName } from '../store'

interface CollabConfig {
  relayUrl: string
  roomId: string
  roomKey: string
  adminToken?: string
  projectName: string
  role: 'host' | 'editor' | 'viewer'
}

const CONFIG = '.hive/collab.json'
const STATE = '.hive/state.b64'
const SYNCED = '.hive/synced.json'

export function memberId(): string {
  let id = localStorage.getItem('hive.memberId')
  if (!id) {
    id = toB64Url(randomBytes(9))
    localStorage.setItem('hive.memberId', id)
  }
  return id
}

/**
 * One per open project. Holds the shared Y.Doc (chat, plan, feed, and — when shared — files) and
 * keeps it in sync with disk and the relay.
 */
export class ProjectSession {
  doc = new Y.Doc()
  parts = docParts(this.doc)
  provider: HiveProvider | null = null
  config: CollabConfig | null = null
  private saveTimer?: ReturnType<typeof setTimeout>
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private feedTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private feedBase = new Map<string, string>()
  private textPaths = new WeakMap<Y.Text, string>()
  private synced: Record<string, string> = {}
  private offs: (() => void)[] = []
  private applyingDisk = false

  constructor(public root: string) {}

  get shared() {
    return !!this.provider
  }
  get isHost() {
    return this.config?.role === 'host'
  }
  get canEdit() {
    return this.config?.role !== 'viewer'
  }

  async start() {
    // restore local state (offline edits survive restarts)
    try {
      const b64 = await invoke('fs:read', STATE)
      if (b64) Y.applyUpdate(this.doc, fromB64(b64.trim()), 'restore')
    } catch {
      /* fresh */
    }
    try {
      this.config = JSON.parse(await invoke('fs:read', CONFIG))
    } catch {
      this.config = null
    }
    try {
      this.synced = JSON.parse(await invoke('fs:read', SYNCED))
    } catch {
      this.synced = {}
    }
    this.doc.on('update', () => this.scheduleSave())
    this.observeFeed()
    this.observeFiles()
    this.offs.push(on('feed:event', (ev) => this.pushFeed(ev, false)))
    this.offs.push(on('fs:changed', (e) => this.onDiskChange(e.kind, e.path)))
    // show local history immediately
    for (const ev of this.parts.feed.toArray()) useStore.getState().addFeed(ev)
    if (this.config) await this.connect()
  }

  destroy() {
    this.offs.forEach((f) => f())
    this.provider?.destroy()
    this.provider = null
    clearTimeout(this.saveTimer)
    this.saveNow()
    useStore.getState().set({ collabStatus: 'solo', members: [] })
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveNow(), 1500)
  }

  private saveNow() {
    invoke('fs:write', STATE, toB64(Y.encodeStateAsUpdate(this.doc))).catch(() => {})
  }

  // ---------- connection ----------

  private async connect() {
    const cfg = this.config!
    const s = useStore.getState()
    const profile = s.settings?.profile
    const me = {
      id: memberId(),
      name: profile?.name ?? 'Friend',
      color: profile?.color ?? COLORS[0],
      avatar: profile?.avatar ?? '🐝'
    }
    this.provider?.destroy()
    const p = new HiveProvider(this.doc, {
      relayUrl: cfg.relayUrl,
      roomId: cfg.roomId,
      roomKey: cfg.roomKey,
      member: me,
      adminToken: cfg.adminToken
    })
    this.provider = p
    p.awareness.setLocalStateField('user', { name: me.name, color: me.color, avatar: me.avatar })
    p.on('status', (st) => useStore.getState().set({ collabStatus: st, collabError: p.error }))
    p.on('members', (m) => {
      const prev = useStore.getState().members
      useStore.getState().set({ members: m })
      for (const x of m) {
        const before = prev.find((y) => y.id === x.id)
        if (x.id !== me.id && x.online && before && !before.online) useStore.getState().toast(`${x.avatar} ${x.name} is here`)
      }
    })
    p.on('synced', (hadOffline: boolean) => {
      this.reconcileDisk().catch((e) => console.warn('reconcile', e))
      if (hadOffline) useStore.getState().toast('Back online — your offline changes were synced.', 'ok')
    })
    p.on('kicked', () => useStore.getState().toast('The host removed you from this project.', 'error'))
    await p.connect()
  }

  /** Host: turn this project into a shared room and upload its files. */
  async share(relayUrl: string): Promise<{ code: string; link: string }> {
    const name = this.root.split(/[\\/]/).pop() ?? 'project'
    if (!this.config) {
      this.config = { relayUrl, roomId: newRoomId(), roomKey: newRoomKey(), adminToken: toB64Url(randomBytes(24)), projectName: name, role: 'host' }
      await invoke('fs:write', CONFIG, JSON.stringify(this.config, null, 2))
      this.parts.meta.set('name', name)
      this.parts.meta.set('hostId', memberId())
      this.parts.meta.set('createdAt', Date.now())
      await this.uploadAllFiles()
    }
    if (!this.provider) await this.connect()
    await waitFor(() => this.provider!.status === 'online' || this.provider!.status === 'error', 10000)
    if (this.provider!.status !== 'online') throw new Error(this.provider!.error ?? 'Could not reach the relay.')
    return this.newInvite('editor')
  }

  async newInvite(role: 'editor' | 'viewer') {
    const cfg = this.config!
    const code = newInviteCode()
    const info: InviteInfo = { relayUrl: cfg.relayUrl, roomId: cfg.roomId, roomKey: cfg.roomKey, projectName: cfg.projectName, role }
    this.provider!.publishInvite(code, await sealInvite(code, info))
    return { code, link: inviteLink(info, code) }
  }

  /** Friend: write the config for a project we are joining; caller then opens the folder. */
  static async prepareJoin(dir: string, info: InviteInfo) {
    const cfg: CollabConfig = { relayUrl: info.relayUrl, roomId: info.roomId, roomKey: info.roomKey, projectName: info.projectName, role: info.role }
    await invoke('fs:write', CONFIG, JSON.stringify(cfg, null, 2))
    return dir
  }

  async leave() {
    this.provider?.destroy()
    this.provider = null
    this.config = null
    await invoke('fs:delete', CONFIG).catch(() => {})
    useStore.getState().set({ collabStatus: 'solo', members: [] })
  }

  // ---------- files: disk ⇄ Yjs ----------

  private async uploadAllFiles() {
    const hashes = await invoke('fs:hashTree')
    const paths = Object.keys(hashes)
    for (const p of paths) {
      try {
        const text = await invoke('fs:read', p)
        if (text.length > MAX_SHARED_FILE_BYTES) continue
        this.doc.transact(() => this.parts.files.set(p, new Y.Text(text)), 'disk')
        this.synced[p] = hashes[p]
      } catch {
        /* binary/unreadable */
      }
    }
    this.saveSynced()
  }

  /**
   * Join-time full-tree check. A file changed on disk since the last sync (edited while Hive was
   * closed) is pushed into the doc; otherwise the doc's version is written to disk.
   */
  private async reconcileDisk() {
    const disk = await invoke('fs:hashTree')
    for (const [p, ytext] of this.parts.files.entries()) {
      this.textPaths.set(ytext, p)
      const docText = ytext.toString()
      const docHash = await sha256Hex(docText)
      const diskHash = disk[p]
      if (diskHash === docHash) {
        this.synced[p] = docHash
        continue
      }
      if (diskHash && this.synced[p] && diskHash !== this.synced[p]) {
        // changed locally while offline → merge into the doc
        const text = await invoke('fs:read', p)
        this.applyingDisk = true
        this.doc.transact(() => setText(ytext, text), 'disk')
        this.applyingDisk = false
        this.pushFeed(makeFeedEvent({ actor: actorName(), kind: 'file.edited', files: [p], summary: `edited ${p} (offline)`, syncedLate: true }))
        this.synced[p] = diskHash
      } else {
        await invoke('fs:write', p, docText)
        this.synced[p] = docHash
      }
    }
    this.saveSynced()
    useStore.getState().set({ tree: await invoke('fs:tree') })
  }

  private saveSynced() {
    invoke('fs:write', SYNCED, JSON.stringify(this.synced)).catch(() => {})
  }

  private observeFiles() {
    this.parts.files.observe((ev, tr) => {
      if (!this.shared) return
      for (const [key, change] of ev.changes.keys) {
        if (change.action === 'add') {
          const t = this.parts.files.get(key)!
          this.textPaths.set(t, key)
          if (tr.origin !== 'disk' && tr.origin !== 'disk-local') this.scheduleWrite(key)
        } else if (change.action === 'delete' && !tr.local) {
          invoke('fs:delete', key).catch(() => {})
          delete this.synced[key]
        }
      }
      if (tr.origin !== 'disk') invoke('fs:tree').then((tree) => useStore.getState().set({ tree }))
    })
    this.parts.files.observeDeep((events, tr) => {
      if (!this.shared) return
      for (const e of events) {
        if (!(e.target instanceof Y.Text)) continue
        const path = this.textPaths.get(e.target) ?? [...this.parts.files.entries()].find(([, t]) => t === e.target)?.[0]
        if (!path) continue
        this.textPaths.set(e.target, path)
        const fromDisk = tr.origin === 'disk' || tr.origin === 'disk-local'
        if (!fromDisk) this.scheduleWrite(path)
        if (tr.local && !fromDisk && tr.origin !== 'restore') this.scheduleEditFeed(path)
      }
    })
  }

  private scheduleWrite(path: string) {
    clearTimeout(this.writeTimers.get(path))
    this.writeTimers.set(
      path,
      setTimeout(async () => {
        const t = this.parts.files.get(path)
        if (!t) return
        const text = t.toString()
        await invoke('fs:write', path, text).catch((e) => console.warn('write', path, e))
        this.synced[path] = await sha256Hex(text)
        this.saveSynced()
      }, 250)
    )
  }

  private async onDiskChange(kind: string, path: string) {
    if (path.startsWith('.hive/')) return
    if (kind === 'add' || kind === 'change') {
      if (this.shared) {
        let text: string
        try {
          text = await invoke('fs:read', path)
        } catch {
          return
        }
        if (text.length > MAX_SHARED_FILE_BYTES) return
        const existing = this.parts.files.get(path)
        const before = existing?.toString() ?? ''
        if (existing && before === text) return
        this.applyingDisk = true
        this.doc.transact(() => {
          if (existing) setText(existing, text)
          else this.parts.files.set(path, new Y.Text(text))
        }, 'disk-local')
        this.applyingDisk = false
        this.synced[path] = await sha256Hex(text)
        this.recordEdit(path, before, text, existing ? 'file.edited' : 'file.created')
      }
    } else if (kind === 'unlink') {
      if (this.shared && this.parts.files.has(path)) {
        this.doc.transact(() => this.parts.files.delete(path), 'disk-local')
        delete this.synced[path]
        this.pushFeed(makeFeedEvent({ actor: actorName(), kind: 'file.deleted', files: [path] }))
      }
    }
    if (kind !== 'change') useStore.getState().set({ tree: await invoke('fs:tree') })
  }

  /** Y.Text for a path (shared mode), creating it from disk content if needed. */
  textFor(path: string, diskText: string): Y.Text {
    let t = this.parts.files.get(path)
    if (!t) {
      t = new Y.Text(diskText)
      this.doc.transact(() => this.parts.files.set(path, t!), 'disk')
    }
    this.textPaths.set(t, path)
    return t
  }

  // ---------- feed ----------

  private scheduleEditFeed(path: string) {
    if (!this.feedBase.has(path)) {
      // first keystroke: remember the text as of the last synced write
      this.feedBase.set(path, this.parts.files.get(path)?.toString() ?? '')
    }
    clearTimeout(this.feedTimers.get(path))
    this.feedTimers.set(
      path,
      setTimeout(() => {
        const before = this.feedBase.get(path) ?? ''
        const after = this.parts.files.get(path)?.toString() ?? ''
        this.feedBase.delete(path)
        this.recordEdit(path, before, after, 'file.edited')
      }, 2500)
    )
  }

  recordEdit(path: string, before: string, after: string, kind: FeedEvent['kind'] = 'file.edited') {
    if (before === after && kind === 'file.edited') return
    this.pushFeed(makeFeedEvent({ actor: actorName(), kind, files: [path], diff: diffPreview(path, before, after) }))
  }

  /** Add an event to the shared feed (and local history). */
  pushFeed(ev: FeedEvent, persistLocal = true) {
    if (this.provider && this.provider.status !== 'online') ev = { ...ev, syncedLate: true }
    const arr = this.parts.feed
    const last = arr.length ? arr.get(arr.length - 1) : undefined
    this.doc.transact(() => {
      if (shouldCoalesce(last, ev)) {
        arr.delete(arr.length - 1, 1)
        ev = { ...ev, id: last!.id, diff: ev.diff ?? last!.diff }
      }
      arr.push([ev])
      if (arr.length > MAX_FEED) arr.delete(0, arr.length - MAX_FEED)
    })
    if (persistLocal) invoke('feed:add', ev).catch(() => {})
  }

  private observeFeed() {
    this.parts.feed.observe((e, tr) => {
      const s = useStore.getState()
      for (const item of e.changes.added) {
        for (const ev of item.content.getContent() as FeedEvent[]) {
          s.addFeed(ev, !tr.local)
          if (!tr.local) {
            invoke('feed:add', ev).catch(() => {})
            if (ev.kind !== 'file.edited' || ev.actorType === 'agent') s.toast(`${ev.actor} ${ev.summary}`)
            if (document.hidden) invoke('notify', `Hive: ${ev.actor}`, ev.summary).catch(() => {})
          }
        }
      }
    })
  }

  // ---------- chat ----------

  sendChat(text: string, channel: ChatMsg['channel']) {
    const p = useStore.getState().settings?.profile
    const msg: ChatMsg = {
      id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      author: p?.name ?? 'me',
      color: p?.color ?? COLORS[0],
      text,
      channel,
      syncedLate: this.provider && this.provider.status !== 'online' ? true : undefined
    }
    this.parts.chat.push([msg])
    return msg
  }
}

function waitFor(fn: () => boolean, ms: number) {
  return new Promise<void>((resolve) => {
    const end = Date.now() + ms
    const t = setInterval(() => {
      if (fn() || Date.now() > end) {
        clearInterval(t)
        resolve()
      }
    }, 50)
  })
}

// ---------- singleton for the open project ----------

let current: ProjectSession | null = null
export const session = () => current

export async function openSession(root: string) {
  current?.destroy()
  current = new ProjectSession(root)
  await current.start()
  return current
}

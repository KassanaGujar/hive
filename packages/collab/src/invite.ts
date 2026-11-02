import { decrypt, encrypt, fromB64, keyFromCode, randomBytes, toB64 } from './crypto'

// No 0/O/1/I/L to avoid misreads when a friend types the code.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_MEMBERS = 10

export function newInviteCode(): string {
  const b = randomBytes(6)
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('')
}

export function newRoomId(): string {
  return [...randomBytes(9)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export interface InviteInfo {
  relayUrl: string
  roomId: string
  roomKey: string
  projectName: string
  role: 'editor' | 'viewer'
}

/** hive://join?relay=…&room=…&name=…&role=…#<roomKey> — the key never reaches a server. */
export function inviteLink(i: InviteInfo, code: string): string {
  const q = new URLSearchParams({ relay: i.relayUrl, room: i.roomId, name: i.projectName, role: i.role, code })
  return `hive://join?${q.toString()}#${i.roomKey}`
}

export function parseInvite(text: string): Partial<InviteInfo> & { code?: string } {
  const t = text.trim()
  if (/^[A-Z0-9]{6}$/i.test(t)) return { code: t.toUpperCase() }
  try {
    const url = new URL(t.replace(/^hive:\/\//, 'https://hive.local/'))
    const p = url.searchParams
    return {
      relayUrl: p.get('relay') ?? undefined,
      roomId: p.get('room') ?? undefined,
      projectName: p.get('name') ?? undefined,
      role: (p.get('role') as 'editor' | 'viewer') ?? 'editor',
      code: p.get('code') ?? undefined,
      roomKey: url.hash.replace(/^#/, '') || undefined
    }
  } catch {
    return {}
  }
}

/**
 * Code-only joining: the room info is sealed with a key derived from the 6-char code and stored on
 * the relay for 24 h. Typing the code fetches and opens it. (Links carry the key directly and are
 * the stronger option.)
 */
export async function sealInvite(code: string, info: InviteInfo): Promise<string> {
  const key = await keyFromCode(code, 'invite')
  return toB64(await encrypt(key, new TextEncoder().encode(JSON.stringify(info))))
}

export async function openInvite(code: string, sealed: string): Promise<InviteInfo> {
  const key = await keyFromCode(code, 'invite')
  return JSON.parse(new TextDecoder().decode(await decrypt(key, fromB64(sealed))))
}

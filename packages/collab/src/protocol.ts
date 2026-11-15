/**
 * Wire protocol between Hive clients and the relay. JSON frames; `data` fields are base64 of
 * AES-GCM ciphertext the relay cannot read.
 */
export interface MemberHello {
  id: string
  name: string
  color: string
  avatar: string
}

export type ClientMsg =
  /** editHash = sha256 hex of the room's edit token; joiners who present the token become editors, others viewers. */
  | { t: 'create'; room: string; adminToken: string; member: MemberHello; editHash?: string }
  | { t: 'join'; room: string; member: MemberHello; editToken?: string }
  | { t: 'update'; data: string }
  | { t: 'awareness'; data: string }
  /** Replace the stored log with one encrypted full-state snapshot covering entries ≤ upTo. */
  | { t: 'snapshot'; data: string; upTo: number }
  | { t: 'invite:create'; code: string; sealed: string; adminToken: string }
  | { t: 'invite:get'; code: string }
  | { t: 'role'; adminToken: string; memberId: string; role: 'editor' | 'viewer' }
  | { t: 'kick'; adminToken: string; memberId: string }
  | { t: 'ping' }

export interface MemberInfo extends MemberHello {
  role: 'host' | 'editor' | 'viewer'
  online: boolean
}

export type ServerMsg =
  | { t: 'joined'; room: string; you: string; members: MemberInfo[]; log: { seq: number; data: string }[] }
  | { t: 'update'; seq: number; from: string; data: string }
  | { t: 'awareness'; from: string; data: string }
  | { t: 'members'; members: MemberInfo[] }
  | { t: 'invite'; code: string; sealed: string | null }
  | { t: 'kicked' }
  | { t: 'error'; message: string }
  | { t: 'pong' }

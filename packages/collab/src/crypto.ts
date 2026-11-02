/**
 * End-to-end encryption for rooms. AES-GCM-256 via WebCrypto (works in the renderer and Node).
 * The room key lives only in invite links (after '#') and on members' machines; the relay sees
 * ciphertext only.
 */
const subtle = () => globalThis.crypto.subtle

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export const toB64Url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const fromB64Url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

export function newRoomKey(): string {
  return toB64Url(randomBytes(32))
}

export async function importKey(keyB64Url: string): Promise<CryptoKey> {
  return subtle().importKey('raw', fromB64Url(keyB64Url) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encrypt(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}

export async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = data.subarray(0, 12)
  const ct = data.subarray(12)
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource))
}

/** Derive a wrapping key from a short invite code (for the code-only join path). */
export async function keyFromCode(code: string, salt: string): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(code.toUpperCase()), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(`hive:${salt}`), iterations: 300_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function sha256Hex(text: string): Promise<string> {
  const h = new Uint8Array(await subtle().digest('SHA-256', new TextEncoder().encode(text)))
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('')
}

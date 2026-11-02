import { app } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { filterCatalog, streamChat, chatOnce, type Endpoint } from '@hive/models'
import type { Catalog, CatalogEntry, ChatMessage, InstalledModel, Tier, ToolSpec } from '@hive/shared'
import { emit } from './ipc'
import { getSettings, secrets, setSettings, store } from './store'
import { listLocal, ollamaBaseUrl } from './ollama'

let catalog: Catalog | null = null

function bundledCatalog(): unknown {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'catalog.json'),
    path.join(app.getAppPath(), '../../catalog/catalog.json'),
    path.join(__dirname, '../../../../catalog/catalog.json')
  ]
  for (const c of candidates) {
    try {
      return JSON.parse(readFileSync(c, 'utf8'))
    } catch {
      /* next */
    }
  }
  return { models: [] }
}

/** Remote catalog from GitHub (so new free models appear without an update), else cache, else bundled. */
export async function loadCatalog(): Promise<Catalog> {
  const bundled = filterCatalog(bundledCatalog())
  catalog = filterCatalog(store.get('catalogCache', null))
  if (!catalog.models.length || catalog.version < bundled.version) catalog = bundled
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 5000)
    const res = await fetch(getSettings().catalogUrl, { signal: ctl.signal })
    clearTimeout(t)
    if (res.ok) {
      const remote = filterCatalog(await res.json())
      if (remote.models.length && remote.version >= catalog.version) {
        catalog = remote
        store.set('catalogCache', remote)
      }
    }
  } catch {
    /* offline: keep cache/bundled */
  }
  return catalog
}

export function getCatalog(): Catalog {
  return catalog ?? filterCatalog(bundledCatalog())
}

function connectedHosted(): string[] {
  return store.get<string[]>('connectedHosted', [])
}

export function setHostedConnected(id: string, on: boolean) {
  const cur = new Set(connectedHosted())
  if (on) cur.add(id)
  else cur.delete(id)
  store.set('connectedHosted', [...cur])
}

function matchCatalog(name: string): CatalogEntry | undefined {
  const c = getCatalog().models.filter((m) => m.source === 'ollama')
  const base = name.replace(/:latest$/, '')
  return c.find((m) => m.pullName === name || m.pullName === base) ?? c.find((m) => base.startsWith(m.pullName!.split(':')[0] + ':' + (m.pullName!.split(':')[1] ?? '')))
}

/** Everything the user can call right now: downloaded Ollama models + connected free hosted ones. */
export async function installedModels(): Promise<InstalledModel[]> {
  const overrides = getSettings().tierOverrides
  const out: InstalledModel[] = []
  for (const l of await listLocal()) {
    const e = matchCatalog(l.name)
    const id = e?.id ?? `ollama:${l.name}`
    out.push({
      id,
      name: e?.name ?? l.name,
      source: 'ollama',
      model: l.name,
      tier: overrides[id] ?? e?.tier ?? 'worker',
      codingScore: e?.codingScore ?? 40,
      sizeGB: e?.sizeGB ?? Math.round((l.size / 1024 ** 3) * 10) / 10,
      minRamGB: e?.minRamGB ?? 8,
      contextTokens: e?.contextTokens ?? 8192
    })
  }
  for (const id of connectedHosted()) {
    const e = getCatalog().models.find((m) => m.id === id)
    if (!e || e.source === 'ollama' || !secrets.has(`key:${e.source}`)) continue
    out.push({
      id,
      name: e.name,
      source: e.source,
      model: e.endpointModel!,
      tier: overrides[id] ?? e.tier,
      codingScore: e.codingScore,
      sizeGB: 0,
      minRamGB: 0,
      contextTokens: e.contextTokens
    })
  }
  return out
}

export function setTier(id: string, tier: Tier | null) {
  const o = { ...getSettings().tierOverrides }
  if (tier) o[id] = tier
  else delete o[id]
  setSettings({ tierOverrides: o })
}

export function endpointFor(m: InstalledModel): Endpoint {
  if (m.source === 'ollama') return { baseUrl: ollamaBaseUrl, model: m.model }
  const p = getCatalog().providers[m.source]
  const key = secrets.get(`key:${m.source}`)
  if (!p || !key) throw new Error(`No free key saved for ${m.source}. Add one in the Model store.`)
  return {
    baseUrl: p.baseUrl,
    apiKey: key,
    model: m.model,
    extraHeaders: m.source === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/hive-app', 'X-Title': 'Hive' } : undefined
  }
}

export async function findModel(id: string): Promise<InstalledModel> {
  const m = (await installedModels()).find((x) => x.id === id)
  if (!m) throw new Error('That model is not installed or connected.')
  return m
}

/** Paste a free key → check it works (under 5 s) before saving. */
export async function testKey(provider: string, key: string): Promise<{ ok: boolean; message: string }> {
  const p = getCatalog().providers[provider as keyof Catalog['providers']]
  if (!p) return { ok: false, message: 'Unknown provider' }
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 5000)
    const res = await fetch(`${p.baseUrl}${p.testPath}`, { headers: { Authorization: `Bearer ${key.trim()}` }, signal: ctl.signal })
    clearTimeout(t)
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'That key was rejected. Check you copied all of it.' }
    if (!res.ok) return { ok: false, message: `The provider answered ${res.status}. Try again in a minute.` }
    secrets.set(`key:${provider}`, key.trim())
    return { ok: true, message: 'Key works and is saved encrypted on this PC only.' }
  } catch (e) {
    return { ok: false, message: (e as Error).name === 'AbortError' ? 'No answer within 5 seconds. Check your internet.' : (e as Error).message }
  }
}

// ---------- chat streaming to the renderer ----------

const streams = new Map<string, AbortController>()

export async function chatStream(modelId: string, messages: ChatMessage[], tools?: ToolSpec[]): Promise<string> {
  const m = await findModel(modelId)
  const ep = endpointFor(m)
  const streamId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const ctl = new AbortController()
  streams.set(streamId, ctl)
  ;(async () => {
    try {
      for await (const chunk of streamChat(ep, messages, { tools, signal: ctl.signal })) {
        emit('chat:chunk', { streamId, chunk })
      }
    } catch (e) {
      emit('chat:chunk', { streamId, chunk: { done: true }, error: ctl.signal.aborted ? undefined : (e as Error).message })
    } finally {
      streams.delete(streamId)
    }
  })()
  return streamId
}

export function abortStream(id: string) {
  streams.get(id)?.abort()
}

export async function chatOnceById(modelId: string, messages: ChatMessage[]) {
  const m = await findModel(modelId)
  return (await chatOnce(endpointFor(m), messages)).text
}

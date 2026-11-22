import { cliModels, runCli } from './cliAgents'
import { cliInvocation, flattenMessages, isCliSource, parseCliOutput, type CliSource } from '@hive/agents'
import { tmpdir } from 'node:os'
import { app } from 'electron'
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici'
import { setModelFetch } from '@hive/models'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { filterCatalog, streamChat, chatOnce, type Endpoint } from '@hive/models'
import type { Catalog, CatalogEntry, ChatMessage, InstalledModel, Tier, ToolSpec } from '@hive/shared'
import { emit } from './ipc'
import { getSettings, secrets, setSettings, store } from './store'
import { listLocal, ollamaBaseUrl } from './ollama'
import { customProviders, openRouterModels, providerKey } from './library'

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
  await Promise.all([refreshOpenRouterFree(true), refreshGroqModels(true)])
  return catalog
}

export function getCatalog(): Catalog {
  const c = catalog ?? filterCatalog(bundledCatalog())
  return {
    ...c,
    models: c.models.filter(
      (m) => (m.source !== 'openrouter' || stillFreeOnOpenRouter(m.endpointModel!)) && (m.source !== 'groq' || stillOnGroq(m.endpointModel!))
    )
  }
}

// ---------- which Groq models exist right now ----------
// Groq retires models too (llama-3.3-70b-versatile answered 404 "does not exist" in Nov 2026). Its model list needs
// the key, so it is checked once a key is saved; catalog models Groq no longer serves are hidden like OpenRouter's.
let groqLive: { at: number; ids: Set<string> } | null = null

export async function refreshGroqModels(force = false) {
  if (!force && groqLive && Date.now() - groqLive.at < FREE_TTL) return
  const key = secrets.get('key:groq')
  const p = (catalog ?? filterCatalog(bundledCatalog())).providers.groq
  if (!key || !p) return
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    const res = await fetch(`${p.baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: ctl.signal })
    clearTimeout(t)
    if (!res.ok) return
    const ids = (((await res.json()) as { data?: { id: string }[] }).data ?? []).map((m) => m.id)
    if (!ids.length) return
    groqLive = { at: Date.now(), ids: new Set(ids) }
    store.set('groqModels', ids)
  } catch {
    /* offline: keep the last good list */
  }
}

export function stillOnGroq(model: string): boolean {
  if (!groqLive) {
    const saved = store.get<string[]>('groqModels', [])
    if (!saved.length) return true
    groqLive = { at: 0, ids: new Set(saved) }
  }
  return groqLive.ids.has(model)
}

// ---------- which OpenRouter models are free right now ----------
// OpenRouter's free list changes often (Qwen3 Coder, gpt-oss 120B and Llama 3.3 70B all stopped being free in 2026).
// Hive checks the live list (at most hourly, last good list kept across restarts) and hides catalog models that are
// no longer free, so the store never offers, and the AI team never calls, a model that would fail or cost money.
const FREE_TTL = 60 * 60 * 1000
let orFree: { at: number; ids: Set<string> } | null = null

export async function refreshOpenRouterFree(force = false) {
  if (!force && orFree && Date.now() - orFree.at < FREE_TTL) return
  try {
    const ids = (await openRouterModels()).filter((m) => m.free).map((m) => m.id)
    if (!ids.length) return
    orFree = { at: Date.now(), ids: new Set(ids) }
    store.set('openRouterFree', ids)
  } catch {
    /* offline: keep the last good list */
  }
}

/** True unless the live (or last saved) free list says this model is no longer free. No list yet = trust the catalog. */
export function stillFreeOnOpenRouter(model: string): boolean {
  if (!orFree) {
    const saved = store.get<string[]>('openRouterFree', [])
    if (!saved.length) return true
    orFree = { at: 0, ids: new Set(saved) }
  }
  return orFree.ids.has(model)
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
  const exact = c.find((m) => m.pullName === name)
  if (exact) return exact
  // "llama3.2:latest" → the catalog's default size for that family ("llama3.2:3b").
  const [repo, tag] = name.split(':')
  if (!tag || tag === 'latest') return c.find((m) => m.pullName!.split(':')[0] === repo)
  // "qwen2.5-coder:7b-instruct-q4_K_M" → "qwen2.5-coder:7b"
  return c.find((m) => name.startsWith(m.pullName! + '-'))
}

/** Everything the user can call right now: downloaded Ollama models + connected free hosted ones. */
export async function installedModels(): Promise<InstalledModel[]> {
  await Promise.all([refreshOpenRouterFree(), refreshGroqModels()])
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
    // Live OpenRouter free models are stored as "or:<model id>"; only ":free" ids are ever accepted.
    if (id.startsWith('or:')) {
      const model = id.slice(3)
      if (!model.endsWith(':free') || !secrets.has('key:openrouter') || !stillFreeOnOpenRouter(model)) continue
      out.push({ id, name: `${model.replace(/:free$/, '')} (OpenRouter free)`, source: 'openrouter', model, tier: overrides[id] ?? 'lead', codingScore: 60, sizeGB: 0, minRamGB: 0, contextTokens: 32768 })
      continue
    }
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
      contextTokens: e.contextTokens,
      ...(e.limits ? { limits: e.limits } : {})
    })
  }
  // Your own keys: whatever the user pays for. Strong by default; the tier is theirs to change.
  for (const p of customProviders()) {
    for (const model of p.models) {
      const id = `custom:${p.id}:${model}`
      out.push({ id, name: `${model} (${p.name})`, source: 'custom', model, tier: overrides[id] ?? 'top', codingScore: 88, sizeGB: 0, minRamGB: 0, contextTokens: 128000 })
    }
  }
  out.push(...(await cliModels()))
  return out
}

export function setTier(id: string, tier: Tier | null) {
  const o = { ...getSettings().tierOverrides }
  if (tier) o[id] = tier
  else delete o[id]
  setSettings({ tierOverrides: o })
}

export function endpointFor(m: InstalledModel): Endpoint {
  if (m.source === 'claude-code' || m.source === 'codex') throw new Error(`${m.name} works in the AI team only; it has no chat endpoint.`)
  // 16k tokens fits a few project files plus a long reply; never more than the model supports
  if (m.source === 'ollama') return { baseUrl: ollamaBaseUrl, model: m.model, ollamaContext: Math.max(4096, Math.min(m.contextTokens || 8192, 16384)) }
  if (m.source === 'custom') {
    const p = customProviders().find((x) => m.id.startsWith(`custom:${x.id}:`))
    if (!p) throw new Error('That provider was removed.')
    return { baseUrl: p.baseUrl, apiKey: providerKey(p.id), model: m.model }
  }
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
    // OpenRouter's /key accepts keys that cannot run models; prove the key with a 1-token request to a free model.
    const probe = provider === 'openrouter' ? getCatalog().models.find((m) => m.source === 'openrouter')?.endpointModel : undefined
    if (probe) {
      const c2 = new AbortController()
      const t2 = setTimeout(() => c2.abort(), 20000)
      const r2 = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: probe, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        signal: c2.signal
      }).catch(() => null)
      clearTimeout(t2)
      // 429/5xx = the free model is busy, which still proves the key; only an auth error rejects it.
      if (r2 && (r2.status === 401 || r2.status === 403)) {
        return { ok: false, message: 'That key exists but cannot run models (it may be a management key, or it was deleted). Create a normal API key and paste it here.' }
      }
    }
    secrets.set(`key:${provider}`, key.trim())
    if (provider === 'groq') await refreshGroqModels(true)
    return { ok: true, message: 'Key works and is saved encrypted on this PC only.' }
  } catch (e) {
    return { ok: false, message: (e as Error).name === 'AbortError' ? 'No answer within 5 seconds. Check your internet.' : (e as Error).message }
  }
}

// ---------- chat streaming to the renderer ----------

const streams = new Map<string, AbortController>()

// Model requests: no 5-minute header limit (see setModelFetch); our own timeouts apply. undici's own fetch is used
// with its own Agent: mixing it with Electron's built-in fetch (a different undici) silently broke requests.
const patientAgent = new UndiciAgent({ headersTimeout: 0, bodyTimeout: 0 })
setModelFetch(((url: string, init?: RequestInit) => undiciFetch(url, { ...(init as object), dispatcher: patientAgent } as never)) as unknown as typeof fetch)

/** First words can take a while (a local model loading into memory); after that, long silences mean trouble. */
const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.HIVE_FIRST_TOKEN_TIMEOUT_MS ?? 120_000)
const STALL_TIMEOUT_MS = Number(process.env.HIVE_STALL_TIMEOUT_MS ?? 120_000)

/**
 * Ask AI through a subscription CLI (Claude Code, Codex): no tools, the answer arrives in one piece. It used to throw
 * "works in the AI team only", though Ask AI lists the model. Automatic means Sonnet here: Ask AI replies are code
 * (Haiku is for the team's short planning calls).
 */
const CLI_CHAT_TIMEOUT_MS = 10 * 60_000
async function cliChat(m: InstalledModel, messages: ChatMessage[], signal: AbortSignal): Promise<string> {
  const source = m.source as CliSource
  const model = m.model === 'auto' && source === 'claude-code' ? 'sonnet' : m.model
  const r = await runCli(cliInvocation(source, 'ask', flattenMessages(messages), model), tmpdir(), signal, CLI_CHAT_TIMEOUT_MS)
  const out = parseCliOutput(source, r.code, r.stdout, r.stderr)
  if (!out.ok) throw new Error(out.error ?? `${m.name} did not answer.`)
  return out.text
}

export async function chatStream(modelId: string, messages: ChatMessage[], tools?: ToolSpec[]): Promise<string> {
  const m = await findModel(modelId)
  const streamId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const ctl = new AbortController()
  streams.set(streamId, ctl)
  if (isCliSource(m.source)) {
    void cliChat(m, messages, ctl.signal)
      .then((text) => {
        emit('chat:chunk', { streamId, chunk: { text } })
        emit('chat:chunk', { streamId, chunk: { done: true } })
      })
      .catch((e) => emit('chat:chunk', { streamId, chunk: { done: true }, error: ctl.signal.aborted ? undefined : (e as Error).message }))
      .finally(() => streams.delete(streamId))
    return streamId
  }
  const ep = endpointFor(m)
  // A provider that accepts the request but never answers would otherwise leave the chat waiting forever.
  let timedOut: string | null = null
  let idle: ReturnType<typeof setTimeout> | undefined
  const arm = (ms: number, why: string) => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      timedOut = why
      ctl.abort()
    }, ms)
  }
  // A model has to read the whole prompt before its first word, so allow time per prompt token on top.
  const promptTokens = Math.round(messages.reduce((n, msg) => n + (msg.content?.length ?? 0), 0) / 4)
  // local models on a modest PC can read as slowly as ~15 tokens/s; hosted ones are far faster
  const firstTokenMs = FIRST_TOKEN_TIMEOUT_MS + promptTokens * (ep.ollamaContext ? 100 : 20)
  arm(firstTokenMs, `The model didn't start answering within ${Math.round(firstTokenMs / 1000)} seconds. It may be overloaded or unreachable. Try again, or pick another model.`)
  ;(async () => {
    try {
      for await (const chunk of streamChat(ep, messages, { tools, signal: ctl.signal })) {
        arm(STALL_TIMEOUT_MS, `The model stopped answering for ${STALL_TIMEOUT_MS / 1000} seconds, so the reply was cut off. Try again.`)
        emit('chat:chunk', { streamId, chunk })
      }
    } catch (e) {
      emit('chat:chunk', { streamId, chunk: { done: true }, error: timedOut ?? (ctl.signal.aborted ? undefined : (e as Error).message) })
    } finally {
      clearTimeout(idle)
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
  if (isCliSource(m.source)) return cliChat(m, messages, new AbortController().signal)
  return (await chatOnce(endpointFor(m), messages)).text
}

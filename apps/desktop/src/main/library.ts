import type { CustomProvider, HfFile, HfModel, OpenRouterModel } from '@hive/shared'
import { secrets, store } from './store'

/**
 * The big model library, fetched live so it never goes stale:
 *  - Hugging Face: any GGUF repo can be pulled by Ollama as `hf.co/<repo>:<quant>`.
 *  - OpenRouter: the full hosted list with prices (free ones use the free key).
 * Plus "your own keys": any OpenAI-compatible provider the user pays for.
 */
async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 12000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: ctl.signal })
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

// ---------- Hugging Face (GGUF) ----------

export async function searchHF(query: string): Promise<HfModel[]> {
  const q = new URLSearchParams({ filter: 'gguf', sort: 'downloads', direction: '-1', limit: '40' })
  if (query.trim()) q.set('search', query.trim())
  const list = (await getJson(`https://huggingface.co/api/models?${q}`)) as any[]
  return list.map((m) => ({ id: String(m.id), downloads: Number(m.downloads) || 0, likes: Number(m.likes) || 0, gated: !!m.gated }))
}

const QUANT = /[-._]((?:i1-)?(?:IQ|Q)\d(?:_[A-Z0-9]+)*|F16|F32|BF16)\.gguf$/i

/** GGUF files in a repo, one per quantisation, with sizes — so the store can show what fits this PC. */
export async function hfFiles(repo: string): Promise<HfFile[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Bad repository name')
  const tree = (await getJson(`https://huggingface.co/api/models/${repo}/tree/main?recursive=false`)) as any[]
  const out: HfFile[] = []
  for (const f of tree) {
    const name = String(f.path ?? '')
    if (!name.toLowerCase().endsWith('.gguf') || /mmproj|-of-\d+/i.test(name)) continue
    const quant = QUANT.exec(name)?.[1]?.toUpperCase().replace(/^I1-/, '')
    if (!quant) continue
    const bytes = Number(f.lfs?.size ?? f.size) || 0
    out.push({ file: name, quant, sizeGB: Math.round((bytes / 1024 ** 3) * 10) / 10, pullName: `hf.co/${repo}:${quant}` })
  }
  const seen = new Set<string>()
  return out.filter((f) => (seen.has(f.quant) ? false : (seen.add(f.quant), true))).sort((a, b) => a.sizeGB - b.sizeGB)
}

// ---------- OpenRouter ----------

let orCache: { at: number; list: OpenRouterModel[] } | null = null

export async function openRouterModels(): Promise<OpenRouterModel[]> {
  if (orCache && Date.now() - orCache.at < 10 * 60 * 1000) return orCache.list
  const j = (await getJson('https://openrouter.ai/api/v1/models')) as { data: any[] }
  const list = j.data.map((m) => {
    const prompt = Number(m.pricing?.prompt) || 0
    const completion = Number(m.pricing?.completion) || 0
    return {
      id: String(m.id),
      name: String(m.name ?? m.id),
      contextTokens: Number(m.context_length) || 8192,
      // $ per million tokens
      priceIn: Math.round(prompt * 1e6 * 100) / 100,
      priceOut: Math.round(completion * 1e6 * 100) / 100,
      free: String(m.id).endsWith(':free') && prompt === 0 && completion === 0
    }
  })
  orCache = { at: Date.now(), list }
  return list
}

// ---------- your own keys (paid or self-hosted, OpenAI-compatible) ----------

const KEY = 'customProviders'
export const customProviders = (): CustomProvider[] => store.get<CustomProvider[]>(KEY, [])
const save = (list: CustomProvider[]) => store.set(KEY, list)

function authHeaders(key?: string): Record<string, string> {
  // Bearer for OpenAI-style APIs; x-api-key + version for Anthropic's native /models endpoint.
  return key ? { Authorization: `Bearer ${key}`, 'x-api-key': key, 'anthropic-version': '2023-06-01' } : {}
}

export async function listProviderModels(baseUrl: string, key?: string): Promise<string[]> {
  const j = (await getJson(`${baseUrl.replace(/\/$/, '')}/models`, authHeaders(key), 8000)) as any
  const arr: any[] = Array.isArray(j) ? j : j.data ?? j.models ?? []
  return arr.map((m) => String(m.id ?? m.name ?? '').replace(/^models\//, '')).filter(Boolean).sort()
}

/** Add or update a provider. The key is tested (by listing models) and stored encrypted on this PC only. */
export async function saveProvider(p: { id?: string; name: string; baseUrl: string; key?: string }) {
  const baseUrl = p.baseUrl.trim().replace(/\/$/, '')
  if (!/^https?:\/\/.+/.test(baseUrl)) return { ok: false, message: 'The address must start with http:// or https://', id: '', models: [] as string[] }
  const id = p.id ?? `p${Date.now().toString(36)}`
  const key = p.key?.trim() || secrets.get(`key:custom:${id}`)
  let models: string[] = []
  let message = 'Connected.'
  try {
    models = await listProviderModels(baseUrl, key)
    message = `Connected — ${models.length} models available.`
  } catch (e) {
    const msg = (e as Error).message
    if (/^(401|403)/.test(msg)) return { ok: false, message: 'That key was rejected. Check you copied all of it.', id, models }
    // Some providers have no model list; the user can type model names by hand.
    message = 'Saved. This provider does not list its models, so type the model names yourself.'
  }
  if (p.key?.trim()) secrets.set(`key:custom:${id}`, p.key.trim())
  const list = customProviders()
  const existing = list.find((x) => x.id === id)
  if (existing) Object.assign(existing, { name: p.name.trim() || existing.name, baseUrl })
  else list.push({ id, name: p.name.trim() || new URL(baseUrl).hostname, baseUrl, models: [] })
  save(list)
  return { ok: true, message, id, models }
}

export function setProviderModels(id: string, models: string[]) {
  const list = customProviders()
  const p = list.find((x) => x.id === id)
  if (!p) throw new Error('Unknown provider')
  p.models = [...new Set(models.map((m) => m.trim()).filter(Boolean))]
  save(list)
}

export function removeProvider(id: string) {
  save(customProviders().filter((p) => p.id !== id))
  secrets.delete(`key:custom:${id}`)
}

export const providerKey = (id: string) => secrets.get(`key:custom:${id}`)

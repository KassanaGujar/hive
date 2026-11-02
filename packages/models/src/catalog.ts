import type { Catalog, CatalogEntry, FitLabel, Hardware, ModelSource, Tier } from '@hive/shared'

const SOURCES: ModelSource[] = ['ollama', 'openrouter', 'groq', 'hf']
const TIERS: Tier[] = ['top', 'lead', 'worker']

/**
 * Keep only entries that are explicitly free and well-formed. This is the single gate that
 * stops a paid model from ever reaching the UI: no `free: true`, no entry.
 */
export function filterCatalog(raw: unknown): Catalog {
  const input = (raw ?? {}) as Partial<Catalog> & { models?: unknown[] }
  const models: CatalogEntry[] = []
  for (const m of input.models ?? []) {
    const e = m as Partial<CatalogEntry>
    if (!e || (e as { free?: unknown }).free !== true) continue
    if (typeof e.id !== 'string' || typeof e.name !== 'string') continue
    if (!SOURCES.includes(e.source as ModelSource)) continue
    if (e.source === 'ollama' && typeof e.pullName !== 'string') continue
    if (e.source !== 'ollama' && typeof e.endpointModel !== 'string') continue
    // OpenRouter marks free variants with ":free"; anything else there costs money.
    if (e.source === 'openrouter' && !e.endpointModel!.endsWith(':free')) continue
    models.push({
      ...(e as CatalogEntry),
      tier: TIERS.includes(e.tier as Tier) ? (e.tier as Tier) : 'worker',
      codingScore: clamp(Number(e.codingScore) || 0, 0, 100),
      sizeGB: Number(e.sizeGB) || 0,
      minRamGB: Number(e.minRamGB) || 0,
      minVramGB: Number(e.minVramGB) || 0,
      contextTokens: Number(e.contextTokens) || 8192
    })
  }
  return {
    version: Number(input.version) || 0,
    updated: String(input.updated ?? ''),
    providers: (input.providers ?? {}) as Catalog['providers'],
    models
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Runs well: fits in VRAM (GPU) or comfortably in RAM with headroom.
 * Slow: fits in RAM but not VRAM, so it runs on CPU.
 * Too big: needs more RAM than the machine has.
 */
export function fitLabel(entry: CatalogEntry, hw: Hardware): FitLabel {
  if (entry.source !== 'ollama') return 'runs-well'
  if (entry.minRamGB > hw.totalRamGB) return 'too-big'
  if (hw.vramGB >= entry.minVramGB && entry.minVramGB > 0) return 'runs-well'
  if (entry.minVramGB === 0 && entry.minRamGB <= hw.totalRamGB) return 'runs-well'
  // CPU only: small models are still fine on a decent machine.
  if (entry.sizeGB <= 2.5 && hw.totalRamGB >= 8) return 'runs-well'
  return 'slow'
}

export function fitsDisk(entry: CatalogEntry, hw: Hardware): boolean {
  return entry.sizeGB + 1 < hw.freeDiskGB
}

/** Best local coding model that runs well on this PC, preferring smaller downloads for a starter. */
export function recommendStarter(catalog: Catalog, hw: Hardware): CatalogEntry | undefined {
  const local = catalog.models.filter((m) => m.source === 'ollama' && fitsDisk(m, hw))
  const good = local.filter((m) => fitLabel(m, hw) === 'runs-well' && m.sizeGB <= 10)
  const pool = good.length ? good : local.filter((m) => fitLabel(m, hw) !== 'too-big')
  return pool.sort((a, b) => b.codingScore - a.codingScore || a.sizeGB - b.sizeGB)[0]
}

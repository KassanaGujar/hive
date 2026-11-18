import type { InstalledModel, ModelLimits } from '@hive/shared'

/** What one model can handle in a single AI-team task. Per-minute values are Infinity when unknown. */
export interface ModelCapacity {
  contextTokens: number
  maxOutput: number
  inputPerMinute: number
  outputPerMinute: number
  skill: number
}

/** The reply cap the AI team uses for every model (AGENT_MAX_REPLY_TOKENS in the desktop app). */
export const TEAM_REPLY_TOKENS = 6144
/** The context Hive asks Ollama for, at most (same cap as endpointFor in the desktop app). */
export const OLLAMA_CONTEXT_CAP = 16384

/**
 * Learned limits (from the provider's own errors) win over the catalog's, which win over defaults.
 * A small local model writes far less reliably than it can technically produce, so its reply budget comes from its size.
 */
export function capacityOf(m: InstalledModel, learned: Partial<ModelLimits> = {}): ModelCapacity {
  const lim = { ...m.limits, ...learned }
  const local = m.source === 'ollama'
  const contextTokens = local ? Math.min(m.contextTokens || 8192, OLLAMA_CONTEXT_CAP) : m.contextTokens || 8192
  const inputPerMinute = lim.inputPerMinute ?? Infinity
  const outputPerMinute = lim.outputPerMinute ?? Infinity
  const bySize = local ? (m.sizeGB < 3 ? 1500 : m.sizeGB < 6 ? 3000 : TEAM_REPLY_TOKENS) : TEAM_REPLY_TOKENS
  const maxOutput = Math.min(lim.maxOutput ?? bySize, outputPerMinute)
  return { contextTokens, maxOutput, inputPerMinute, outputPerMinute, skill: m.codingScore }
}

/** The provider states its own limit in a 413/429 ("… output tokens per minute (OTPM): Limit 1000"). Use that number. */
export function limitsFromError(msg: string): Partial<ModelLimits> | null {
  const n = (re: RegExp) => {
    const x = re.exec(msg)
    return x ? Number(x[1]) : undefined
  }
  const out = n(/output tokens per minute[^:]*:\s*Limit\s+(\d+)/i)
  const inp = n(/input tokens per minute[^:]*:\s*Limit\s+(\d+)/i) ?? n(/(?<!input |output )tokens per minute \(TPM\)[^:]*:\s*Limit\s+(\d+)/i)
  if (out === undefined && inp === undefined) return null
  return { ...(inp !== undefined ? { inputPerMinute: inp } : {}), ...(out !== undefined ? { outputPerMinute: out } : {}) }
}

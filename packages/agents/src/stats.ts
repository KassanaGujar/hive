import type { ModelLimits } from '@hive/shared'
import type { SizeClass } from './sizing'

export interface ModelOutcome {
  size: SizeClass
  outputTokens: number
  ok: boolean
}

export interface ModelRecord {
  ok: Record<SizeClass, number>
  failed: Record<SizeClass, number>
  /** The smallest task (tokens to write) that failed, per size class. */
  minFailedTokens?: Partial<Record<SizeClass, number>>
  /** Limits the provider stated in its own errors (e.g. Groq: 1,000 output tokens a minute). */
  learned?: Partial<ModelLimits>
}

/** Per model id. Saved by the app between runs. */
export type ModelStats = Record<string, ModelRecord>

const empty = (): ModelRecord => ({ ok: { small: 0, medium: 0, large: 0 }, failed: { small: 0, medium: 0, large: 0 } })
/** fits() uses 80% of maxOutput, so a cap of tokens/0.8 - 1 just excludes tasks of that many tokens. */
const HEADROOM = 0.8

/** A task finished (merged) or failed because of what the model wrote. Returns new stats; the input is not changed. */
export function recordOutcome(stats: ModelStats, modelId: string, o: ModelOutcome): ModelStats {
  const r = structuredClone(stats[modelId] ?? empty())
  if (o.ok) {
    r.ok[o.size]++
    if (r.minFailedTokens) delete r.minFailedTokens[o.size]
    r.failed[o.size] = 0
  } else {
    r.failed[o.size]++
    r.minFailedTokens = { ...r.minFailedTokens, [o.size]: Math.min(r.minFailedTokens?.[o.size] ?? Infinity, o.outputTokens) }
  }
  return { ...stats, [modelId]: r }
}

/**
 * What the router should assume from this model's history: after two failures at a size with no success there,
 * its reply budget is capped just below the smallest failed task, so it stops getting tasks that big.
 */
export function learnedCapacity(r: ModelRecord | undefined): Partial<ModelLimits> {
  if (!r) return {}
  const out: Partial<ModelLimits> = { ...r.learned }
  const caps = (['small', 'medium', 'large'] as SizeClass[])
    .filter((s) => r.failed[s] >= 2 && r.ok[s] === 0 && r.minFailedTokens?.[s] !== undefined)
    .map((s) => Math.floor(r.minFailedTokens![s]! / HEADROOM) - 1)
  if (caps.length) out.maxOutput = Math.min(...caps, out.maxOutput ?? Infinity)
  return out
}

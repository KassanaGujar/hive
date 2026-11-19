import type { classifyModelError } from './client'

export type ModelErrorKind = ReturnType<typeof classifyModelError>
export type ErrorStep = { action: 'retry' } | { action: 'wait'; ms: number } | { action: 'switch'; restMs: number } | { action: 'fail' }

const QUOTA_REST_MS = 6 * 60 * 60_000
const BUSY_REST_MS = 5 * 60_000

/**
 * After a failed call: ask the same model again, wait and ask again, move to another team model, or give up.
 * `tries` counts failures on the current model. Transient trouble used to fail the whole task while other models
 * on the team were free (a rate-limited Gemma, a gpt-oss sending broken tool calls).
 */
export function afterModelError(kind: ModelErrorKind, tries: number): ErrorStep {
  switch (kind) {
    case 'bad-tool':
      return tries < 2 ? { action: 'retry' } : { action: 'switch', restMs: 0 }
    case 'busy':
      return tries < 2 ? { action: 'wait', ms: 15000 * (tries + 1) } : { action: 'switch', restMs: BUSY_REST_MS }
    case 'quota':
      return { action: 'switch', restMs: QUOTA_REST_MS }
    case 'too-big':
      return { action: 'switch', restMs: 0 }
    default:
      return { action: 'fail' }
  }
}

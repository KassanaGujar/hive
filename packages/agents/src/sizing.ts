import type { PlanTask } from '@hive/shared'
import type { ModelCapacity } from '@hive/models'

export type SizeClass = 'small' | 'medium' | 'large'

/** Rough cost of one task, in tokens. Estimates, not measurements: they only need to rank tasks against models. */
export interface TaskSize {
  outputTokens: number
  inputTokens: number
  parts: number
  hard: number
  size: SizeClass
}

const NEW_FILE_TOKENS: Record<string, number> = { html: 500, htm: 500, css: 450 }
const CODE_FILE_TOKENS = 400
const PER_FUNCTION_TOKENS = 120
/** A task with no files listed gets a medium guess, not zero. */
const UNKNOWN_TASK_TOKENS = 1200
const PROMPT_BASE_TOKENS = 900
const HARD = /engine|physics|collision|pathfind|a\*|dijkstra|minimax|chess|topolog|websocket|server|3d|three|voxel|noise|parser|undo|sync/gi
const NOT_FUNCTIONS = new Set(['if', 'for', 'while', 'switch', 'return', 'function'])

export function estimateTask(t: PlanTask, existing: Record<string, number>, extraContextChars = 0): TaskSize {
  const description = t.description ?? ''
  const text = `${t.title}\n${description}`
  const functions = new Set([...description.matchAll(/\b([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]).filter((n) => !NOT_FUNCTIONS.has(n)))
  let outputTokens = t.files.length ? 0 : UNKNOWN_TASK_TOKENS
  for (const f of t.files) {
    const ext = f.split('.').pop()?.toLowerCase() ?? ''
    outputTokens += existing[f] ? Math.ceil(existing[f] / 4) : (NEW_FILE_TOKENS[ext] ?? CODE_FILE_TOKENS)
  }
  outputTokens += functions.size * PER_FUNCTION_TOKENS
  const numbered = (description.match(/(^|\n)\s*\d+\.\s/g) ?? []).length
  const parts = Math.max(1, numbered, t.title.split('; ').length)
  const hard = new Set((text.match(HARD) ?? []).map((w) => w.toLowerCase())).size
  const ownedChars = t.files.reduce((n, f) => n + (existing[f] ?? 0), 0)
  const inputTokens = Math.ceil((PROMPT_BASE_TOKENS * 4 + ownedChars + extraContextChars) / 4)
  const size: SizeClass = outputTokens > 2500 || parts > 1 || hard >= 2 ? 'large' : outputTokens <= 900 && hard === 0 ? 'small' : 'medium'
  return { outputTokens, inputTokens, parts, hard, size }
}

/** Size only (no skill rule): what splitting a task can change. Planning uses this; routing uses fits(). */
export function fitsSize(s: TaskSize, cap: ModelCapacity): boolean {
  return fits({ ...s, hard: 0 }, cap)
}

/** Leaves headroom: a model asked for 100% of its reply budget tends to stop short or loop. */
export function fits(s: TaskSize, cap: ModelCapacity): boolean {
  return (
    s.outputTokens <= cap.maxOutput * 0.8 &&
    s.inputTokens + s.outputTokens <= cap.contextTokens * 0.7 &&
    s.inputTokens <= cap.inputPerMinute &&
    (s.hard < 2 || cap.skill >= 70)
  )
}

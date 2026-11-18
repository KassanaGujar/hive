import type { ModelCapacity } from '@hive/models'

/** The most diff one review ever sends (the old fixed cap). */
export const MAX_REVIEW_DIFF_CHARS = 24000
const CHARS_PER_TOKEN = 4
/** Room left for the reviewer's JSON reply. */
const REPLY_TOKENS = 400

/**
 * How many characters of diff one review may carry for this lead, after the prompt around it (promptChars).
 * Groq's free Qwen3.8 allows 7,000 input tokens a minute; a 24,000-char diff plus the task text went over and the
 * review was refused (413).
 */
export function reviewBudgetChars(cap: ModelCapacity, promptChars: number): number {
  const tokens = Math.min(cap.contextTokens * 0.6, cap.inputPerMinute * 0.9) - REPLY_TOKENS
  return Math.max(2000, Math.min(MAX_REVIEW_DIFF_CHARS, Math.floor(tokens * CHARS_PER_TOKEN) - promptChars))
}

/** Split a git diff into per-file pieces grouped into chunks of at most maxChars; a file too big alone is cut. */
export function splitDiff(diff: string, maxChars: number): string[] {
  if (diff.length <= maxChars) return [diff]
  const files = diff.split(/(?=^diff --git )/m).filter(Boolean)
  const note = '\n…(rest of this diff not shown)\n'
  const chunks: string[] = []
  let cur = ''
  for (let f of files) {
    if (f.length > maxChars) f = f.slice(0, maxChars - note.length) + note
    if (cur && cur.length + f.length > maxChars) {
      chunks.push(cur)
      cur = ''
    }
    cur += f
  }
  if (cur) chunks.push(cur)
  return chunks
}

/** A review in parts passes only if every part passes; the notes of each part are kept. */
export function combineReviews(parts: { approved: boolean; notes: string }[]): { approved: boolean; notes: string } {
  const approved = parts.every((p) => p.approved)
  const notes = (approved ? parts : parts.filter((p) => !p.approved)).map((p) => p.notes).filter(Boolean).join('\n')
  return { approved, notes }
}

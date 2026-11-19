/** Exact repetition must cover at least this much text before a reply counts as stuck. */
const MIN_LOOP_CHARS = 2000
const MIN_COPIES = 5
const MIN_PERIOD = 20
const MAX_PERIOD = 1200

/**
 * A small local model can get stuck writing the same block again and again until it hits its reply cap (on a slow GPU
 * that took hours). If the reply ends with one block repeated MIN_COPIES+ times back to back, covering MIN_LOOP_CHARS+,
 * return the index just after the first copy (keep text up to there); otherwise null.
 */
export function loopingTail(text: string): number | null {
  const n = text.length
  for (let p = MIN_PERIOD; p <= MAX_PERIOD && p * MIN_COPIES <= n; p++) {
    // how far back the text keeps matching itself shifted by p
    let k = 0
    while (k + p < n && text.charCodeAt(n - 1 - k) === text.charCodeAt(n - 1 - k - p)) k++
    const span = k + p // length of the periodic tail
    const copies = Math.floor(span / p)
    if (copies >= MIN_COPIES && span >= MIN_LOOP_CHARS) return n - span + p
  }
  return null
}

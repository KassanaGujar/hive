/** About 4 characters per token for code and English. */
const CHARS_PER_TOKEN = 4
const MAX_LISTED_FILES = 60

/**
 * What another agent's file offers, one line each: functions, classes, top-level arrow functions, window globals,
 * element ids. Enough to call into it or wire it up without sending the whole file to a small model.
 */
export function interfaceSummary(code: string, file: string): string {
  const out = new Set<string>()
  for (const m of code.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm)) out.add(`function ${m[1]}(${m[2].trim()})`)
  for (const m of code.matchAll(/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm)) out.add(`class ${m[1]}`)
  for (const m of code.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm)) out.add(`const ${m[1]} = (…) =>`)
  for (const m of code.matchAll(/\b(window\.[A-Za-z_$][\w$.]*)\s*=(?!=)/g)) out.add(`${m[1]} =`)
  const ids = new Set<string>()
  for (const m of code.matchAll(/\bid=["']([A-Za-z][\w-]*)["']/g)) ids.add(m[1])
  for (const m of code.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)/g)) ids.add(m[1])
  for (const m of code.matchAll(/querySelector(?:All)?\(\s*["']#([\w-]+)["']\s*\)/g)) ids.add(m[1])
  if (ids.size) out.add(`element ids: ${[...ids].map((i) => `#${i}`).join(', ')}`)
  return out.size ? `${file}:\n${[...out].map((l) => `  ${l}`).join('\n')}` : ''
}

/**
 * The worker's context, filled in order until the token budget is used: its own files in full (cut with a note if
 * one is bigger than the whole budget), what the other files offer, the file list, then the plan document.
 */
export function buildWorkerContext(
  input: { owned: Record<string, string>; others: Record<string, string>; fileList: string[]; prd?: string },
  budgetTokens: number
): string {
  let room = Math.max(0, budgetTokens) * CHARS_PER_TOKEN
  const parts: string[] = []
  const add = (s: string) => {
    if (!s || s.length > room) return false
    parts.push(s)
    room -= s.length
    return true
  }
  for (const [f, text] of Object.entries(input.owned)) {
    const head = `\n\nCurrent ${f}:\n\`\`\`\n`
    const tail = '\n```'
    const fit = room - head.length - tail.length - 80
    if (fit <= 0) break
    const body = text.length <= fit ? text : `${text.slice(0, fit)}\n…(rest of the file not shown: read_file ${f} to see it)`
    add(head + body + tail)
  }
  const summaries = Object.entries(input.others).map(([f, t]) => interfaceSummary(t, f)).filter(Boolean)
  if (summaries.length) {
    add('\n\nWhat the other files offer (read_file one for the details):')
    for (const s of summaries) if (!add(`\n${s}`)) break
  }
  const listed = input.fileList.slice(0, MAX_LISTED_FILES)
  const more = input.fileList.length - listed.length
  add(`\n\nProject files right now:\n${listed.join('\n') || '(empty)'}${more > 0 ? `\n…and ${more} more (list_files to see them)` : ''}`)
  if (input.prd) add(`\n\nThe team's plan (PRD) for context:\n${input.prd}`)
  return parts.join('')
}

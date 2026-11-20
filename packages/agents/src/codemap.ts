import path from 'node:path'

/**
 * A small code map of the project: where things are defined and which files load which. Two uses:
 * - context: a worker sees summaries of the files its own files import or are loaded by first, instead of the
 *   first 40 files in folder order;
 * - find_code: an agent asks for one name and gets its definition, a snippet and where it is used, inside a fixed
 *   budget, instead of reading whole files. Agents may ask a few times per attempt, not endlessly.
 */
export const QUERY_BUDGET_TOKENS = 4000
/** find_code calls allowed per worker attempt. */
export const MAX_CODE_QUERIES = 3

export interface CodeDef {
  name: string
  kind: 'function' | 'class' | 'const' | 'global' | 'element' | 'def'
  file: string
  line: number
  signature: string
}

export interface CodeMap {
  files: Record<string, string>
  defs: CodeDef[]
  /** file → project files it loads (imports, require, <script src>, python imports). */
  deps: Map<string, Set<string>>
}

const JS = /\.(m?js|cjs|jsx|tsx?)$/i
const DEF_RULES: { re: RegExp; kind: CodeDef['kind']; when: RegExp }[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/, kind: 'function', when: JS },
  { re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', when: JS },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/, kind: 'const', when: JS },
  { re: /\b(window\.[A-Za-z_$][\w$.]*)\s*=(?!=)/, kind: 'global', when: JS },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, kind: 'def', when: /\.py$/i },
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class', when: /\.py$/i }
]

export function buildCodeMap(files: Record<string, string>): CodeMap {
  const defs: CodeDef[] = []
  const deps = new Map<string, Set<string>>()
  const names = new Set(Object.keys(files))
  for (const [file, text] of Object.entries(files)) {
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const r of DEF_RULES) {
        if (!r.when.test(file)) continue
        const m = r.re.exec(line)
        if (m) defs.push({ name: m[1], kind: r.kind, file, line: i + 1, signature: line.trim().slice(0, 160) })
      }
      if (/\.html?$/i.test(file)) for (const m of line.matchAll(/\bid=["']([A-Za-z][\w-]*)["']/g)) defs.push({ name: m[1], kind: 'element', file, line: i + 1, signature: `element #${m[1]}` })
    })
    const found = new Set<string>()
    for (const spec of importSpecs(file, text)) {
      const hit = resolveSpec(file, spec, names)
      if (hit && hit !== file) found.add(hit)
    }
    if (found.size) deps.set(file, found)
  }
  return { files, defs, deps }
}

function importSpecs(file: string, text: string): string[] {
  const out: string[] = []
  if (JS.test(file)) {
    for (const m of text.matchAll(/(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)) out.push(m[1])
  } else if (/\.html?$/i.test(file)) {
    for (const m of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) out.push(m[1])
    for (const m of text.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["']/gi)) out.push(m[1])
  } else if (/\.py$/i.test(file)) {
    for (const m of text.matchAll(/^\s*(?:from\s+(\.*[\w.]+)\s+import|import\s+([\w.]+))/gm)) out.push(`py:${m[1] ?? m[2]}`)
  }
  return out
}

function resolveSpec(from: string, spec: string, names: Set<string>): string | null {
  const dir = path.posix.dirname(from)
  if (spec.startsWith('py:')) {
    const mod = spec.slice(3).replace(/^\.+/, '').replace(/\./g, '/')
    for (const c of [path.posix.join(dir, `${mod}.py`), `${mod}.py`, path.posix.join(dir, mod, '__init__.py')]) if (names.has(c)) return c
    return null
  }
  if (/^[a-z]+:/i.test(spec) || spec.startsWith('//')) return null // URLs
  const base = spec.startsWith('/') ? spec.slice(1) : spec.startsWith('.') ? path.posix.join(dir, spec) : /\.html?$/i.test(from) ? path.posix.join(dir, spec) : null
  if (base === null) return null // a package name, not a project file
  const clean = path.posix.normalize(base.split(/[?#]/)[0])
  for (const c of [clean, `${clean}.js`, `${clean}.ts`, `${clean}.tsx`, `${clean}.jsx`, `${clean}.mjs`, `${clean}/index.js`, `${clean}/index.ts`]) if (names.has(c)) return c
  return null
}

/**
 * Other files ordered by how close they are to the task's files in the load graph: what they load and what loads
 * them first, then two steps away, then the rest in their original order.
 */
export function relatedFiles(map: CodeMap, owned: string[]): string[] {
  const own = new Set(owned)
  const users = new Map<string, Set<string>>()
  for (const [f, ds] of map.deps) for (const d of ds) users.set(d, (users.get(d) ?? new Set()).add(f))
  const dist = new Map<string, number>()
  let frontier = [...own]
  for (let depth = 1; depth <= 2 && frontier.length; depth++) {
    const next: string[] = []
    for (const f of frontier)
      for (const n of [...(map.deps.get(f) ?? []), ...(users.get(f) ?? [])]) {
        if (own.has(n) || dist.has(n)) continue
        dist.set(n, depth)
        next.push(n)
      }
    frontier = next
  }
  const all = Object.keys(map.files).filter((f) => !own.has(f))
  return all.map((f, i) => ({ f, i, d: dist.get(f) ?? 9 })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.f)
}

/** Definitions matching the query, with a snippet and where each is used, within QUERY_BUDGET_TOKENS. */
export function queryCodeMap(map: CodeMap, query: string, budgetTokens = QUERY_BUDGET_TOKENS): string {
  const terms = (query.match(/[A-Za-z_$#][\w$.-]*/g) ?? []).map((t) => t.replace(/^#/, '').toLowerCase())
  if (!terms.length) return 'Error: find_code needs a name to look for (a function, class, variable or element id).'
  const scored = map.defs
    .map((d) => {
      const n = d.name.toLowerCase().replace(/^window\./, '')
      const s = Math.max(...terms.map((t) => (n === t ? 3 : n.includes(t) ? 2 : t.includes(n) && n.length > 3 ? 1 : 0)))
      return { d, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.d.file.localeCompare(b.d.file) || a.d.line - b.d.line)
  if (!scored.length) return `No definition matches "${query}". Try another name, or use search for plain text.`
  const room = budgetTokens * 4
  let out = ''
  let shown = 0
  for (const { d } of scored) {
    const lines = map.files[d.file].split('\n')
    const snippet = lines.slice(Math.max(0, d.line - 2), d.line + 10).join('\n')
    const bare = d.name.replace(/^window\./, '')
    const used = Object.entries(map.files)
      .map(([f, t]) => ({ f, n: (t.match(new RegExp(`\\b${bare.replace(/[$.]/g, '\\$&')}\\b`, 'g')) ?? []).length - (f === d.file ? 1 : 0) }))
      .filter((u) => u.n > 0)
      .map((u) => `${u.f} (${u.n})`)
    const block = `${d.file}:${d.line}  ${d.kind} ${d.name}\n\`\`\`\n${snippet}\n\`\`\`\n${used.length ? `Used in: ${used.slice(0, 8).join(', ')}\n` : ''}\n`
    if (out.length + block.length > room) break
    out += block
    shown++
  }
  const left = scored.length - shown
  if (!shown) out = `${scored[0].d.file}:${scored[0].d.line}  ${scored[0].d.signature}\n`
  return out + (left > 0 ? `…${left} more matches; ask for a more exact name.` : '')
}

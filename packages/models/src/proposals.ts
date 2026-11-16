/**
 * Find the files an AI reply proposes. Models label code blocks in several ways; all of these count:
 *   ```src/app.js            (path as the info string — what Hive asks for)
 *   ```html index.html       (language, then the path)
 *   ### index.html  /  **game.js**  /  File: style.css   followed by ```js   (path on the line just before)
 * A later block for the same path replaces an earlier one.
 */
const LANGS = /^(js|javascript|ts|typescript|tsx|jsx|py|python|html|css|scss|json|bash|sh|shell|powershell|ps1|md|markdown|text|txt|plaintext|yaml|yml|xml|sql|c|cpp|java|go|rust|rs|diff)$/i
const FILE = /(?:^|[\s`*"'(:/])((?:[\w.-]+\/)*[\w.-]+\.(?:html?|css|scss|m?js|cjs|ts|tsx|jsx|json|py|md|txt|yml|yaml|xml|sql|c|cpp|h|java|go|rs|sh))\b/i

const clean = (p: string) => p.replace(/^\.?\//, '').replace(/[`*"']/g, '')

export function parseProposals(text: string): { path: string; content: string }[] {
  const found = new Map<string, string>()
  const re = /```([^\n`]*)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const info = m[1].trim()
    const content = m[2]
    let path: string | null = null
    const tokens = info.split(/\s+/).filter(Boolean)
    if (tokens.length === 1 && /\.[A-Za-z0-9]+$/.test(tokens[0]) && !LANGS.test(tokens[0])) path = clean(tokens[0])
    else if (tokens.length >= 2 && LANGS.test(tokens[0])) {
      const named = tokens.slice(1).join(' ').replace(/^(title|file|filename|path)[=:]/i, '')
      const f = FILE.exec(' ' + named)
      if (f) path = clean(f[1])
    }
    if (!path && (tokens.length === 0 || LANGS.test(tokens[0]))) {
      // a language-only block: use a file name on the last non-empty line before it
      const before = text.slice(Math.max(0, m.index - 300), m.index).split('\n').map((l) => l.trim()).filter(Boolean)
      const last = before[before.length - 1] ?? ''
      if (last.length < 160) {
        const f = FILE.exec(' ' + last)
        if (f) path = clean(f[1])
      }
    }
    if (path && !path.includes('..')) found.set(path, content)
  }
  return [...found].map(([path, content]) => ({ path, content }))
}

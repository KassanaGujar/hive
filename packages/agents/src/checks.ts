import vm from 'node:vm'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

/**
 * Checks that decide whether a task is done, run by Hive itself instead of trusting the agent or an AI reviewer.
 * An AI reviewer approved code that never ran (QA P9: "review AI code", "same feature"). A parse check of every
 * file the task owns catches a broken game.js before any model looks at it, and a project's own commands
 * (`.hive/checks.json`) catch the rest. The AI review still runs afterwards, as advice on top of passing checks.
 */

/** Syntax problems in the given files (path → content). Only JS, JSON and inline HTML scripts are checked. */
export function syntaxProblems(files: Record<string, string>): string[] {
  const out: string[] = []
  for (const [file, src] of Object.entries(files)) {
    const ext = path.extname(file).toLowerCase()
    if (ext === '.json') {
      try {
        JSON.parse(src)
      } catch (e) {
        out.push(`${file}: ${(e as Error).message}`)
      }
    } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      const p = jsProblem(src)
      if (p) out.push(`${file}${p}`)
    } else if (ext === '.html' || ext === '.htm') {
      for (const block of inlineScripts(src)) {
        const p = jsProblem(block.code, block.line - 1)
        if (p) out.push(`${file}${p}`)
      }
    }
  }
  return out
}

/** ":<line>: <message>" for the first syntax error, or null. lineOffset shifts reported lines (HTML scripts). */
function jsProblem(src: string, lineOffset = 0): string | null {
  try {
    // Wrapped in an async function so module syntax (after blanking import/export) and top-level await parse.
    new vm.Script(`(async function () {\n${blankModuleSyntax(src)}\n})`, { filename: 'check.js' })
    return null
  } catch (e) {
    const err = e as Error
    const line = /check\.js:(\d+)/.exec(err.stack ?? '')?.[1]
    return `${line ? `:${Number(line) - 1 + lineOffset}` : ''}: ${err.message}`
  }
}

/** Replace import/export syntax with blanks of the same line count, so a module parses as a plain script. */
function blankModuleSyntax(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return src
    .replace(/^\s*import\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"][^'"\n]+['"]\s*;?/gm, blank)
    .replace(/^\s*export\s+(?:\*|\{[^}]*\})(?:\s+from\s+['"][^'"\n]+['"])?\s*;?/gm, blank)
    .replace(/^(\s*)export\s+default\s+/gm, '$1void ')
    .replace(/^(\s*)export\s+(?=(?:async\s+)?function|class|const|let|var)/gm, '$1')
}

function inlineScripts(html: string): { code: string; line: number }[] {
  const out: { code: string; line: number }[] = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = m[1]
    if (/\bsrc\s*=/i.test(attrs)) continue
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase()
    if (type && !['text/javascript', 'module', 'application/javascript'].includes(type)) continue
    const before = html.slice(0, m.index + m[0].indexOf('>') + 1)
    out.push({ code: m[2], line: before.split('\n').length })
  }
  return out
}

/** Why a check command is refused, or null. Checks run without a shell prompt: no operators, pipes or substitution. */
export function checkCommandProblem(command: string): string | null {
  if (!command.trim()) return 'empty command'
  if (/&&|\|\||[;|<>`]|\$\(/.test(command)) return 'shell operators are not allowed in a check command'
  return null
}

export interface ProjectChecks {
  commands: string[]
  /** Commands in the file that were not run because they use shell operators. */
  refused: string[]
}

/**
 * The project's own check commands, from `.hive/checks.json` ({"commands": ["npm test", ...]}). The user writes this
 * file, which is their consent to run these commands after every task. Missing or unreadable = no checks.
 */
export async function loadProjectChecks(root: string): Promise<ProjectChecks> {
  let raw: unknown
  try {
    raw = JSON.parse(await fsp.readFile(path.join(root, '.hive', 'checks.json'), 'utf8'))
  } catch {
    return { commands: [], refused: [] }
  }
  const list = Array.isArray((raw as { commands?: unknown })?.commands) ? (raw as { commands: unknown[] }).commands : []
  const commands: string[] = []
  const refused: string[] = []
  for (const c of list) {
    if (typeof c !== 'string') continue
    ;(checkCommandProblem(c) ? refused : commands).push(c)
  }
  return { commands, refused }
}

/** The end of a long check output: errors are usually last. */
export function tail(text: string, max = 2000): string {
  return text.length <= max ? text : `…${text.slice(-max)}`
}

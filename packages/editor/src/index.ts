import type { RunConfig } from '@hive/shared'

/** What the project-detector needs to know about a folder; kept abstract so it is unit-testable. */
export interface ProjectProbe {
  files: string[] // top-level file names
  readJson(name: string): Record<string, any> | null
  hasTool(tool: string): boolean
  platform: string
}

export const RUNTIME_DOWNLOADS: Record<string, string> = {
  node: 'https://nodejs.org/en/download',
  python: 'https://www.python.org/downloads/',
  go: 'https://go.dev/dl/',
  cargo: 'https://www.rust-lang.org/tools/install',
  java: 'https://adoptium.net/',
  javac: 'https://adoptium.net/',
  gcc: 'https://www.msys2.org/',
  'g++': 'https://www.msys2.org/'
}

function need(tool: string, probe: ProjectProbe): RunConfig['requires'] | undefined {
  return probe.hasTool(tool) ? undefined : { tool, downloadUrl: RUNTIME_DOWNLOADS[tool] ?? '' }
}

/**
 * Pick a run command. Order: hive.json override → package.json → Python → Go → Rust → Java →
 * C/C++ → static HTML. Returns null when nothing runnable is found.
 */
export function detectProject(probe: ProjectProbe, cwd: string): RunConfig | null {
  const has = (f: string) => probe.files.includes(f)
  const hive = has('hive.json') ? probe.readJson('hive.json') : null
  const base = detectBase(probe, cwd)
  if (hive && (hive.command || hive.env || hive.port)) {
    return {
      kind: hive.command ? 'custom' : base?.kind ?? 'custom',
      command: hive.command ?? base?.command ?? '',
      cwd,
      env: { ...(base?.env ?? {}), ...(hive.env ?? {}) },
      port: hive.port ?? base?.port,
      staticDir: hive.command ? undefined : base?.staticDir,
      requires: hive.command ? undefined : base?.requires
    }
  }
  return base
}

function detectBase(probe: ProjectProbe, cwd: string): RunConfig | null {
  const has = (f: string) => probe.files.includes(f)
  const win = probe.platform === 'win32'

  if (has('package.json')) {
    const pkg = probe.readJson('package.json') ?? {}
    const scripts = pkg.scripts ?? {}
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm'
    const install = has('node_modules') ? '' : `${pm} install && `
    const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null
    const runCmd = script ? `${pm} run ${script}` : pkg.main ? `node ${pkg.main}` : has('index.js') ? 'node index.js' : null
    if (runCmd) {
      const isVite = /vite/.test(scripts[script ?? ''] ?? '') || !!pkg.devDependencies?.vite
      return {
        kind: 'node',
        command: `${install}${runCmd}`,
        cwd,
        port: isVite ? 5173 : /next/.test(scripts[script ?? ''] ?? '') ? 3000 : undefined,
        requires: need('node', probe)
      }
    }
  }
  for (const f of ['main.py', 'app.py', 'manage.py']) {
    if (has(f)) {
      const py = win ? 'python' : 'python3'
      const isFlask = f === 'app.py'
      return {
        kind: 'python',
        command: f === 'manage.py' ? `${py} manage.py runserver` : `${py} ${f}`,
        cwd,
        port: f === 'manage.py' ? 8000 : isFlask ? 5000 : undefined,
        requires: need(py === 'python3' ? 'python3' : 'python', probe)
      }
    }
  }
  if (has('go.mod') || has('main.go')) return { kind: 'go', command: 'go run .', cwd, requires: need('go', probe) }
  if (has('Cargo.toml')) return { kind: 'rust', command: 'cargo run', cwd, requires: need('cargo', probe) }
  if (has('pom.xml')) return { kind: 'java', command: win ? 'mvn -q compile exec:java' : 'mvn -q compile exec:java', cwd, requires: need('java', probe) }
  const javaMain = probe.files.find((f) => f === 'Main.java')
  if (javaMain) return { kind: 'java', command: 'java Main.java', cwd, requires: need('java', probe) }
  const c = probe.files.find((f) => f === 'main.c')
  if (c) {
    const out = win ? 'main.exe' : './main'
    return { kind: 'c', command: `gcc main.c -o main && ${out}`, cwd, requires: need('gcc', probe) }
  }
  const cpp = probe.files.find((f) => f === 'main.cpp')
  if (cpp) {
    const out = win ? 'main.exe' : './main'
    return { kind: 'cpp', command: `g++ main.cpp -o main && ${out}`, cwd, requires: need('g++', probe) }
  }
  if (has('index.html')) return { kind: 'static', command: '', cwd, staticDir: cwd }
  return null
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html',
  py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', sh: 'shell', ps1: 'powershell', yml: 'yaml', yaml: 'yaml',
  xml: 'xml', sql: 'sql', toml: 'ini', ini: 'ini', kt: 'kotlin', swift: 'swift', lua: 'lua', dart: 'dart',
  vue: 'html', svelte: 'html', dockerfile: 'dockerfile'
}

export function languageFor(path: string): string {
  const name = path.split('/').pop()!.toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return EXT_LANG[ext] ?? 'plaintext'
}

/** Folders never synced, indexed or shown by default. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'target', '__pycache__', '.venv', 'venv', '.hive'])

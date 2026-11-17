import { createServer, type Server } from 'node:http'
import { promises as fs, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { detectProject, RUNTIME_DOWNLOADS } from '@hive/editor'
import type { RunConfig, RunState } from '@hive/shared'
import { emit } from './ipc'
import { abs, projectRoot } from './project'
import { createTerminal, killTerminal, whichSync, clearWhichCache, prefetchTools } from './terminal'
import { recordFeed } from './feed'
import { getSettings } from './store'

let state: RunState = { status: 'idle' }
let staticServer: Server | null = null
let lastDir: string | undefined

function setState(s: RunState) {
  state = s
  emit('run:state', s)
}

export const runState = () => state

async function detect(dir?: string): Promise<RunConfig | null> {
  const root = dir ? abs(dir) : projectRoot()
  const files = await fs.readdir(root)
  await prefetchTools(['node', 'npm', 'pnpm', 'yarn', 'bun', 'python', 'python3', 'py', 'go', 'cargo', 'java', 'mvn', 'gcc', 'g++'])
  return detectProject(
    {
      files,
      platform: process.platform,
      hasTool: (t) => !!whichSync(t),
      readJson: (name) => {
        try {
          return JSON.parse(readFileSync(path.join(root, name), 'utf8'))
        } catch {
          return null
        }
      }
    },
    root
  )
}

const actor = () => getSettings().profile?.name ?? 'me'

/** Run the project, or a sub-folder of it (e.g. the agents' combined result before merging). */
export async function startRun(dir?: string): Promise<RunState> {
  await stopRun(true)
  lastDir = dir
  const cfg = await detect(dir)
  if (!cfg) {
    setState({ status: 'failed', message: 'Hive could not tell how to run this project. Add an index.html, main.py, package.json, or a hive.json with a "command".' })
    return state
  }
  if (cfg.requires) {
    const url = cfg.requires.downloadUrl || RUNTIME_DOWNLOADS[cfg.requires.tool] || ''
    setState({ status: 'failed', config: cfg, message: `This project needs "${cfg.requires.tool}", which isn't installed. Get it free from ${url} and then press Run again.` })
    return state
  }
  if (cfg.kind === 'static') {
    const { url } = await serveStatic(cfg.staticDir!, cfg.port)
    setState({ status: 'running', config: cfg, previewUrl: url })
    recordFeed({ actor: actor(), kind: 'run.started', summary: `started the site at ${url}` })
    return state
  }
  const termId = createTerminal({
    cwd: cfg.cwd,
    command: cfg.command,
    env: { ...cfg.env, ...(cfg.port ? { PORT: String(cfg.port) } : {}) },
    onExit: (code) => {
      if (state.terminalId !== termId) return
      const failed = code !== 0
      setState({ ...state, status: failed ? 'failed' : 'exited', exitCode: code, message: failed ? `Exited with code ${code}. See the Run terminal for details.` : 'Finished.' })
      if (failed) recordFeed({ actor: actor(), kind: 'run.failed', summary: `run failed (exit ${code}): ${cfg.command}` })
    }
  })
  setState({ status: 'running', config: cfg, terminalId: termId, previewUrl: cfg.port ? `http://localhost:${cfg.port}` : undefined })
  recordFeed({ actor: actor(), kind: 'run.started', summary: `ran ${cfg.command}` })
  return state
}

/** Called by the renderer when the run terminal prints a localhost URL. */
export function setPreviewUrl(url: string) {
  if (state.status === 'running' && state.previewUrl !== url) setState({ ...state, previewUrl: url })
}

export async function stopRun(silent = false): Promise<RunState> {
  if (state.terminalId) killTerminal(state.terminalId)
  if (staticServer) {
    staticServer.close()
    staticServer = null
  }
  const wasRunning = state.status === 'running'
  setState({ status: 'idle', config: state.config })
  if (wasRunning && !silent) recordFeed({ actor: actor(), kind: 'run.stopped' })
  return state
}

export async function restartRun() {
  await stopRun(true)
  return startRun(lastDir)
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
}

/** Tiny static file server for plain HTML projects (localhost only). */
function serveStatic(dir: string, preferredPort?: number): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
        let file = path.resolve(dir, '.' + urlPath)
        if (!file.startsWith(path.resolve(dir))) {
          res.writeHead(403).end()
          return
        }
        if (existsSync(file) && (await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html')
        const body = await fs.readFile(file)
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(body)
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
      }
    })
    server.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE' && preferredPort) server.listen(0, '127.0.0.1')
      else reject(e)
    })
    server.listen(preferredPort ?? 0, '127.0.0.1', () => {
      staticServer = server
      const port = (server.address() as { port: number }).port
      resolve({ url: `http://localhost:${port}/` })
    })
  })
}

import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import type { IpcChannel, IpcContract, IpcEventName, IpcEvents } from '@hive/shared'
import { currentProject } from './project'

type Handler<C extends IpcChannel> = (
  ...args: Parameters<IpcContract[C]>
) => ReturnType<IpcContract[C]> | Promise<Awaited<ReturnType<IpcContract[C]>>>

/** Show paths relative to the open project, so messages stay short and don't expose the user's folders. */
function shortPath(p?: string) {
  if (!p) return ''
  const root = currentProject()
  const rel = root && path.resolve(p).startsWith(path.resolve(root)) ? path.relative(root, p) : path.basename(p)
  return rel.replace(/\\/g, '/') || path.basename(p)
}

/** Turn Node's system errors (ENOENT, EACCES, …) into sentences a person can act on. */
export function friendlyError(err: unknown): string {
  const e = err as NodeJS.ErrnoException
  const p = shortPath(e?.path)
  const where = p ? ` "${p}"` : ''
  switch (e?.code) {
    case 'ENOENT':
      return `Couldn't find${where || ' that file or folder'}. It may have been moved, renamed or deleted.`
    case 'EACCES':
    case 'EPERM':
      return `Hive isn't allowed to change${where || ' that file'}. Check that it isn't read-only or open as administrator.`
    case 'EBUSY':
      return `${p ? `"${p}"` : 'That file'} is in use by another program. Close it there and try again.`
    case 'EEXIST':
      return `${p ? `"${p}"` : 'Something with that name'} already exists.`
    case 'ENOTEMPTY':
      return `The folder${where} isn't empty.`
    case 'EISDIR':
      return `${p ? `"${p}"` : 'That'} is a folder, not a file.`
    case 'ENOTDIR':
      return `Part of the path${where} is a file, not a folder.`
    case 'ENOSPC':
      return 'Your disk is full. Free up some space and try again.'
    case 'EMFILE':
      return 'Too many files are open. Close some programs and try again.'
    case 'ECONNREFUSED':
      return "Couldn't connect. The service isn't running or refused the connection."
    case 'ETIMEDOUT':
      return 'The connection timed out. Check your internet and try again.'
    case 'ENOTFOUND':
      return "Couldn't reach the server. Check your internet connection."
  }
  return e?.message ?? String(err)
}

/** Register a typed handler for a renderer → main call. */
export function handle<C extends IpcChannel>(channel: C, fn: Handler<C>) {
  ipcMain.handle(channel, async (_e, ...args) => {
    const t0 = Date.now()
    try {
      const value = await (fn as (...a: unknown[]) => unknown)(...args)
      if (Date.now() - t0 > 2000) console.warn(`[ipc] ${new Date().toISOString().slice(11, 23)} slow: ${channel} took ${Date.now() - t0} ms`)
      return { ok: true, value }
    } catch (err) {
      const e = err as Error
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') console.error(`[ipc] ${channel} failed:`, e)
      return { ok: false, error: friendlyError(err) }
    }
  })
}

/** Push an event to every window. */
export function emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(event, payload)
  }
}

/** Log when the main process's event loop stalls (anything synchronous blocking every window's calls). */
export function watchEventLoop() {
  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    const lag = now - last - 500
    if (lag > 1000) console.warn(`[main] ${new Date(now).toISOString().slice(11, 23)} event loop blocked for ${lag} ms (${Math.round(process.uptime())} s after start)`)
    last = now
  }, 500).unref()
}

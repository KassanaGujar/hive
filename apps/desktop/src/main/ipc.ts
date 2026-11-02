import { BrowserWindow, ipcMain } from 'electron'
import type { IpcChannel, IpcContract, IpcEventName, IpcEvents } from '@hive/shared'

type Handler<C extends IpcChannel> = (
  ...args: Parameters<IpcContract[C]>
) => ReturnType<IpcContract[C]> | Promise<Awaited<ReturnType<IpcContract[C]>>>

/** Register a typed handler for a renderer → main call. */
export function handle<C extends IpcChannel>(channel: C, fn: Handler<C>) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
    } catch (err) {
      const e = err as Error
      console.error(`[ipc] ${channel} failed:`, e)
      return { ok: false, error: e?.message ?? String(err) }
    }
  })
}

/** Push an event to every window. */
export function emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(event, payload)
  }
}

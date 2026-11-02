import { contextBridge, ipcRenderer } from 'electron'
import type { HiveBridge } from '@hive/shared'

/**
 * The only door between the UI and the machine. The renderer has no Node access; it can call
 * typed channels (validated in main) and subscribe to events.
 */
const bridge: HiveBridge = {
  async invoke(channel, ...args) {
    const r = await ipcRenderer.invoke(channel, ...args)
    if (!r?.ok) throw new Error(r?.error ?? `IPC ${channel} failed`)
    return r.value
  },
  on(event, cb) {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload as never)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }
}

contextBridge.exposeInMainWorld('hive', bridge)

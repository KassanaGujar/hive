import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { emit } from './ipc'

const { autoUpdater } = electronUpdater

/** Checks GitHub Releases on launch, downloads in the background, installs on restart. */
export function initUpdater() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => emit('updater:ready', { version: info.version }))
  autoUpdater.on('error', (e) => console.warn('[updater]', e?.message))
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000)
}

export async function checkForUpdates() {
  if (!app.isPackaged) return { available: false, error: 'Updates only work in the installed app.' }
  try {
    const r = await autoUpdater.checkForUpdates()
    const v = r?.updateInfo?.version
    return { available: !!v && v !== app.getVersion(), version: v }
  } catch (e) {
    return { available: false, error: (e as Error).message }
  }
}

export function installUpdate() {
  autoUpdater.quitAndInstall(false, true)
}

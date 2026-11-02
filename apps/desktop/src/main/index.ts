import { app, BrowserWindow, dialog, Menu, Notification, shell } from 'electron'
import path from 'node:path'
import { handle, emit } from './ipc'
import { initStore, getSettings, setSettings, secrets } from './store'
import * as project from './project'
import * as term from './terminal'
import * as git from './git'
import * as runner from './runner'
import * as ollama from './ollama'
import * as models from './models'
import { scanHardware } from './hardware'
import { orchestrator, startAgents, answerApproval, pendingApprovals, refreshModels, restoreRuns } from './agents'
import { gitStatus, installGit } from './setup'
import { initUpdater, checkForUpdates, installUpdate } from './updater'
import { addFeed, listFeed } from './feed'
import { startLocalRelay, stopLocalRelay, localRelayStatus } from './relayHost'

// Separate profile for tests / a second local instance (e.g. HIVE_USER_DATA=./tmp-profile).
if (process.env.HIVE_USER_DATA) app.setPath('userData', path.resolve(process.env.HIVE_USER_DATA))

// Single instance + hive:// invite links.
if (!process.env.HIVE_USER_DATA && !app.requestSingleInstanceLock()) app.quit()
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('hive', process.execPath, [path.resolve(process.argv[1])])
} else app.setAsDefaultProtocolClient('hive')

let mainWindow: BrowserWindow | null = null
let pendingInvite: string | null = process.argv.find((a) => a.startsWith('hive://')) ?? null

function deliverInvite(link: string) {
  if (mainWindow) {
    emit('app:openInvite', { link })
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else pendingInvite = link
}

app.on('second-instance', (_e, argv) => {
  const link = argv.find((a) => a.startsWith('hive://'))
  if (link) deliverInvite(link)
  else mainWindow?.focus()
})
app.on('open-url', (e, url) => {
  e.preventDefault()
  deliverInvite(url)
})

function createWindow() {
  const dark = getSettings().theme === 'dark'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Hive',
    backgroundColor: dark ? '#14161b' : '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
    if (pendingInvite) {
      const link = pendingInvite
      pendingInvite = null
      setTimeout(() => emit('app:openInvite', { link }), 1500)
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // Never navigate the app window away from the UI.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost:5173') && !url.startsWith('file://')) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  mainWindow.on('closed', () => (mainWindow = null))
}

function buildMenu() {
  const send = (action: string) => () => emit('menu:action', { action })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'File',
        submenu: [
          { label: 'New Project…', accelerator: 'CmdOrCtrl+Shift+N', click: send('newProject') },
          { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: send('openFolder') },
          { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Command: Search in files', accelerator: 'CmdOrCtrl+Shift+F', click: send('search') },
          { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+`', click: send('toggleTerminal') },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { role: 'togglefullscreen' }
        ]
      },
      { label: 'Run', submenu: [{ label: 'Run', accelerator: 'F5', click: send('run') }, { label: 'Stop', accelerator: 'Shift+F5', click: send('stop') }] },
      { role: 'help', submenu: [{ label: 'Hive on GitHub', click: () => shell.openExternal('https://github.com') }] }
    ])
  )
}

function registerHandlers() {
  // app / settings
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath('userData') }))
  handle('settings:get', () => getSettings())
  handle('settings:set', (patch) => setSettings(patch))
  handle('secrets:set', (k, v) => secrets.set(k, v))
  handle('secrets:has', (k) => secrets.has(k))
  handle('secrets:delete', (k) => secrets.delete(k))
  handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('shell:openExternal', (url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
  handle('shell:openPath', (p) => void shell.openPath(p))
  handle('notify', (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  })
  handle('updater:check', () => checkForUpdates())
  handle('updater:install', () => installUpdate())

  // project / files
  handle('project:open', async (dir) => {
    const r = await project.openProject(dir)
    restoreRuns()
    return r
  })
  handle('project:create', (parent, name, o) => project.createProject(parent, name, o?.empty))
  handle('project:current', () => project.currentProject())
  handle('fs:tree', () => project.tree())
  handle('fs:read', (rel) => project.readFile(rel))
  handle('fs:write', (rel, content) => project.writeFile(rel, content))
  handle('fs:create', (rel, type) => project.create(rel, type))
  handle('fs:rename', (a, b) => project.rename(a, b))
  handle('fs:delete', (rel) => project.remove(rel))
  handle('fs:search', (q, o) => project.search(q, o))
  handle('fs:hashTree', () => project.hashTree())

  // terminals
  handle('term:create', (o) => term.createTerminal({ cwd: o?.cwd, command: o?.command }))
  handle('term:write', (id, d) => term.writeTerminal(id, d))
  handle('term:resize', (id, c, r) => term.resizeTerminal(id, c, r))
  handle('term:kill', (id) => term.killTerminal(id))

  // git
  handle('git:status', () => git.status())
  handle('git:init', () => git.init())
  handle('git:stage', async (p) => void (await git.stage(p)))
  handle('git:unstage', async (p) => void (await git.unstage(p)))
  handle('git:commit', (m) => git.commit(m))
  handle('git:checkout', (b, c) => git.checkout(b, c))
  handle('git:log', (n) => git.log(n))
  handle('git:diff', (p, s) => git.diff(p, s))
  handle('git:show', (p, r) => git.show(p, r))

  // run
  handle('run:start', () => runner.startRun())
  handle('run:stop', () => runner.stopRun())
  handle('run:restart', () => runner.restartRun())
  handle('run:state', () => runner.runState())
  handle('run:preview', (url) => runner.setPreviewUrl(url))

  // models
  handle('hw:scan', () => scanHardware())
  handle('catalog:get', () => models.getCatalog())
  handle('ollama:status', () => ollama.status())
  handle('ollama:install', () => ollama.install())
  handle('ollama:start', () => ollama.start())
  handle('ollama:pull', (n) => void ollama.pull(n))
  handle('ollama:pause', (n) => ollama.pause(n))
  handle('ollama:cancel', (n) => ollama.cancel(n))
  handle('ollama:delete', (n) => ollama.remove(n))
  handle('ollama:pulls', () => ollama.listPulls())
  handle('models:installed', () => refreshModels())
  handle('models:setTier', (id, t) => models.setTier(id, t))
  handle('models:testKey', (p, k) => models.testKey(p, k))
  handle('models:connectHosted', (id, on) => models.setHostedConnected(id, on))
  handle('chat:stream', (id, msgs, tools) => models.chatStream(id, msgs, tools))
  handle('chat:abort', (id) => models.abortStream(id))
  handle('chat:once', (id, msgs) => models.chatOnceById(id, msgs))

  // agents
  handle('agents:start', (goal, plan) => startAgents(goal, plan))
  handle('agents:runs', () => orchestrator.list())
  handle('agents:approvePlan', (id, ok) => orchestrator.approvePlan(id, ok))
  handle('agents:approveMerge', (id, ok) => orchestrator.approveMerge(id, ok))
  handle('agents:approveCommand', (id, ok) => answerApproval(id, ok))
  handle('agents:approvals', () => pendingApprovals())
  handle('agents:pause', (r, a) => orchestrator.pause(r, a))
  handle('agents:resume', (r, a) => orchestrator.resume(r, a))
  handle('agents:stop', (r) => orchestrator.stop(r))
  handle('agents:reassign', (r, t, m) => orchestrator.reassign(r, t, m))
  handle('agents:takeOver', (r, t) => orchestrator.takeOver(r, t))
  handle('agents:team', async () => {
    await refreshModels()
    return orchestrator.team()
  })

  // setup
  handle('setup:git', () => gitStatus())
  handle('setup:installGit', () => installGit())

  // feed
  handle('feed:list', (n) => listFeed(n))
  handle('feed:add', (ev) => addFeed(ev))

  // relay on this PC
  handle('relay:startLocal', () => startLocalRelay())
  handle('relay:stopLocal', () => stopLocalRelay())
  handle('relay:status', () => localRelayStatus())
}

app.whenReady().then(async () => {
  initStore()
  registerHandlers()
  buildMenu()
  createWindow()
  initUpdater()
  // Background: catalog refresh, resume interrupted downloads, start Ollama if installed.
  models.loadCatalog().catch(() => {})
  ollama.start().then(() => ollama.resumePulls()).catch(() => {})
  scanHardware().catch(() => {})
})

app.on('window-all-closed', () => {
  term.killAllTerminals()
  runner.stopRun(true)
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

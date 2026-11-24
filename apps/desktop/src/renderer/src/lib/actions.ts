import { invoke } from './api'
import { useStore, ask } from '../store'
import { openSession, session } from '../collab/session'
import { disposeModel, renameModel, disposeAllFileModels } from './monaco'
import { makeFeedEvent } from '@hive/collab'
import { actorName } from '../store'

export async function openProject(dir: string) {
  const s = useStore.getState()
  // close the old project's editors (all of them, not only open tabs)
  session()?.destroy()
  disposeAllFileModels()
  const { root, tree } = await invoke('project:open', dir)
  s.set({
    root,
    tree,
    tabs: {},
    groups: [{ tabs: [], active: null }],
    focusedGroup: 0,
    dirty: new Set(),
    feed: [],
    unread: 0,
    runs: await invoke('agents:runs'),
    settings: await invoke('settings:get')
  })
  sessionStorage.removeItem('hive.closedProject')
  const history = await invoke('feed:list', 300)
  for (const ev of history) useStore.getState().addFeed(ev)
  await openSession(root)
  refreshModels()
  // open README or index.html if present
  const first = tree.find((n) => n.type === 'file' && /^(readme\.md|index\.html)$/i.test(n.name))
  if (first) useStore.getState().openFile(first.path)
}

export function closeProject() {
  session()?.destroy()
  disposeAllFileModels()
  invoke('project:close').catch(() => {})
  sessionStorage.setItem('hive.closedProject', '1')
  useStore.getState().set({ root: null, tree: [], tabs: {}, groups: [{ tabs: [], active: null }] })
}

function soloFeed(kind: 'file.created' | 'file.renamed' | 'file.deleted', files: string[]) {
  const s = session()
  if (s && !s.shared) s.pushFeed(makeFeedEvent({ actor: actorName(), kind, files }))
}

/** Rename or move a file/folder; open editor tabs follow it. */
export async function renameFile(from: string, to: string) {
  const st = useStore.getState()
  const wasOpen = !!st.tabs[`file:${from}`]
  const s = session()
  if (s?.shared && s.renamePath(from, to) > 0) {
    // the open editor was tied to the old shared text: drop it, reopen bound to the new one
    disposeModel(from)
  } else if (wasOpen) renameModel(from, to)
  await invoke('fs:rename', from, to)
  soloFeed('file.renamed', [from, to])
  if (wasOpen) {
    st.closeTab(`file:${from}`)
    st.openFile(to)
  }
  await refreshTree()
}

/** Move a file/folder to the Recycle Bin / Trash and close its tab. */
export async function deleteFile(rel: string) {
  await invoke('fs:delete', rel)
  soloFeed('file.deleted', [rel])
  useStore.getState().closeTab(`file:${rel}`)
  disposeModel(rel)
  await refreshTree()
}

export async function refreshTree() {
  useStore.getState().set({ tree: await invoke('fs:tree') })
}

export async function refreshModels() {
  const models = await invoke('models:installed')
  const s = useStore.getState()
  s.set({ models, chatModel: s.chatModel && models.some((m) => m.id === s.chatModel) ? s.chatModel : models[0]?.id ?? null })
  return models
}

export async function newProjectFlow() {
  const parent = await invoke('dialog:openFolder')
  if (!parent) return
  const name = await ask('Project name', 'my-app')
  if (!name) return
  const dir = await invoke('project:create', parent, name)
  await openProject(dir)
}

export async function openFolderFlow() {
  const dir = await invoke('dialog:openFolder')
  if (dir) await openProject(dir)
}

export async function runProject() {
  const s = useStore.getState()
  // save dirty files first
  window.dispatchEvent(new CustomEvent('hive:saveAll'))
  s.set({ bottomOpen: true })
  const st = await invoke('run:start')
  if (st.status === 'failed' && st.message) s.toast(st.message, 'error')
  if (st.previewUrl) openPreview(st.previewUrl)
}

export function openPreview(url: string) {
  useStore.getState().openTab({ id: 'preview', kind: 'preview', title: 'Preview', url }, useStore.getState().groups.length > 1 ? 1 : undefined)
}

export function openModelStore() {
  useStore.getState().set({ page: 'models' })
}

export function openPlanning() {
  useStore.getState().set({ page: 'chat' })
}

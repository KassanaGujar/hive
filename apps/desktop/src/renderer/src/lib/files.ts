import { MonacoBinding } from 'y-monaco'
import { invoke, on } from './api'
import { getModel, monaco, uriFor } from './monaco'
import { useStore } from '../store'
import { session } from '../collab/session'

/**
 * Open-file bookkeeping: loads Monaco models, tracks saved content for dirty state + feed diffs,
 * autosaves (solo) or binds to the shared Y.Text (live collaboration).
 */
const saved = new Map<string, string>()
const bindings = new Map<string, MonacoBinding>()
const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const listening = new Set<string>()

export async function ensureModel(path: string): Promise<monaco.editor.ITextModel> {
  const existing = monaco.editor.getModel(uriFor(path))
  if (existing) return existing
  const text = await invoke('fs:read', path)
  const model = getModel(path, text)
  saved.set(path, text)
  const s = session()
  if (s?.shared && !path.startsWith('.hive/')) {
    const ytext = s.textFor(path, text)
    if (ytext.toString() !== text) model.setValue(ytext.toString())
    bindings.set(path, new MonacoBinding(ytext, model, new Set(), s.provider!.awareness))
  } else watchForAutosave(path, model)
  model.onWillDispose(() => {
    bindings.get(path)?.destroy()
    bindings.delete(path)
    saved.delete(path)
    listening.delete(path)
  })
  return model
}

/** Register an editor with the file's live binding so remote cursors render in it. */
export function attachEditor(path: string, editor: monaco.editor.IStandaloneCodeEditor) {
  const b = bindings.get(path) as unknown as { editors?: Set<monaco.editor.IStandaloneCodeEditor> } | undefined
  b?.editors?.add(editor)
  return () => b?.editors?.delete(editor)
}

function watchForAutosave(path: string, model: monaco.editor.ITextModel) {
  if (listening.has(path)) return
  listening.add(path)
  model.onDidChangeContent(() => {
    const dirty = model.getValue() !== saved.get(path)
    useStore.getState().setDirty(path, dirty)
    if (dirty && useStore.getState().settings?.autosave) {
      clearTimeout(autosaveTimers.get(path))
      autosaveTimers.set(path, setTimeout(() => saveFile(path), 900))
    }
  })
}

export async function saveFile(path: string) {
  if (bindings.has(path)) return // shared files are written by the session
  const model = monaco.editor.getModel(uriFor(path))
  if (!model) return
  const text = model.getValue()
  const before = saved.get(path) ?? ''
  if (text === before) return
  await invoke('fs:write', path, text)
  saved.set(path, text)
  useStore.getState().setDirty(path, false)
  session()?.recordEdit(path, before, text)
}

export async function saveAll() {
  for (const p of useStore.getState().dirty) await saveFile(p).catch(() => {})
}

/** Apply new content to a file (AI proposal accepted, etc.), keeping undo history. */
export async function applyContent(path: string, text: string) {
  const model = monaco.editor.getModel(uriFor(path))
  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
    if (!bindings.has(path)) await saveFile(path)
  } else {
    const before = await invoke('fs:read', path).catch(() => '')
    const s = session()
    if (s?.shared) s.textFor(path, before) && s.doc.transact(() => {
      const t = s.parts.files.get(path)!
      t.delete(0, t.length)
      t.insert(0, text)
    })
    else {
      await invoke('fs:write', path, text)
      s?.recordEdit(path, before, text, before ? 'file.edited' : 'file.created')
    }
  }
}

/** Solo mode: reload open, unmodified files when something else (terminal, agents) changes them. */
async function reloadFromDisk(path: string) {
  const model = monaco.editor.getModel(uriFor(path))
  if (!model || useStore.getState().dirty.has(path)) return
  const text = await invoke('fs:read', path).catch(() => null)
  if (text === null || text === model.getValue()) return
  saved.set(path, text)
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
  useStore.getState().setDirty(path, false)
}

export function startDiskReload() {
  // Agents write inside .hive (not watched): refresh open copies and, if following, show the file.
  const offAgents = on('agents:file', async ({ path }) => {
    await reloadFromDisk(path)
    const st = useStore.getState()
    if (st.followAgents) st.openFile(path)
  })
  const offDisk = on('fs:changed', async (e) => {
    if (e.kind !== 'change' || bindings.has(e.path)) return
    const model = monaco.editor.getModel(uriFor(e.path))
    if (!model || useStore.getState().dirty.has(e.path)) return
    const text = await invoke('fs:read', e.path).catch(() => null)
    if (text === null || text === model.getValue()) return
    saved.set(e.path, text)
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
    useStore.getState().setDirty(e.path, false)
  })
  return () => {
    offAgents()
    offDisk()
  }
}

window.addEventListener('hive:saveAll', () => saveAll())

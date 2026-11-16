import { MonacoBinding } from 'y-monaco'
import * as Y from 'yjs'
import { setText, applyChangeOnto } from '@hive/collab'
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
/** Shared files: undo/redo only your own edits (a teammate's typing is never undone by your Ctrl+Z). */
const undoManagers = new Map<string, Y.UndoManager>()
type Binding = MonacoBinding & { editors: Set<monaco.editor.IStandaloneCodeEditor>; ytext: Y.Text; monacoModel: monaco.editor.ITextModel; _rerenderDecorations: () => void }

export async function ensureModel(path: string): Promise<monaco.editor.ITextModel> {
  const existing = monaco.editor.getModel(uriFor(path))
  if (existing) return existing
  const s = session()
  const sharedText = s?.shared && !path.startsWith('.hive/') ? s.parts.files.get(path)?.toString() : undefined
  // shared files load from the shared copy (a file a teammate just made may not be on disk yet)
  const text = sharedText ?? (await invoke('fs:read', path))
  const model = getModel(path, text)
  saved.set(path, text)
  if (s?.shared && !path.startsWith('.hive/')) {
    const ytext = s.textFor(path, text)
    if (ytext.toString() !== text) model.setValue(ytext.toString())
    const awareness = s.provider!.awareness
    const binding = new MonacoBinding(ytext, model, new Set(), awareness) as Binding
    bindings.set(path, binding)
    undoManagers.set(path, new Y.UndoManager(ytext, { trackedOrigins: new Set([binding]), captureTimeout: 400 }))
    // y-monaco only wires cursors for editors present at construction; editors attach later (attachEditor)
    awareness.on('change', binding._rerenderDecorations)
    // route the model's own undo/redo (menu, commands) to the shared-aware undo
    const um = undoManagers.get(path)!
    ;(model as unknown as { undo: () => void; redo: () => void }).undo = () => void um.undo()
    ;(model as unknown as { undo: () => void; redo: () => void }).redo = () => void um.redo()
  } else watchForAutosave(path, model)
  model.onWillDispose(() => {
    const b = bindings.get(path) as Binding | undefined
    if (b) session()?.provider?.awareness.off('change', b._rerenderDecorations)
    b?.destroy()
    bindings.delete(path)
    undoManagers.get(path)?.destroy()
    undoManagers.delete(path)
    saved.delete(path)
    listening.delete(path)
  })
  return model
}

/** Register an editor with the file's live binding: broadcast my cursor, draw teammates', shared undo. */
export function attachEditor(path: string, editor: monaco.editor.IStandaloneCodeEditor) {
  const b = bindings.get(path) as Binding | undefined
  if (!b) return () => {}
  b.editors.add(editor)
  const awareness = session()?.provider?.awareness
  const subs: monaco.IDisposable[] = []
  if (awareness) {
    const send = () => {
      if (editor.getModel() !== b.monacoModel) return
      const sel = editor.getSelection()
      if (!sel) return
      let anchor = b.monacoModel.getOffsetAt(sel.getStartPosition())
      let head = b.monacoModel.getOffsetAt(sel.getEndPosition())
      if (sel.getDirection() === monaco.SelectionDirection.RTL) [anchor, head] = [head, anchor]
      awareness.setLocalStateField('selection', {
        anchor: Y.createRelativePositionFromTypeIndex(b.ytext, anchor),
        head: Y.createRelativePositionFromTypeIndex(b.ytext, head)
      })
    }
    subs.push(editor.onDidChangeCursorSelection(send), editor.onDidFocusEditorText(send))
  }
  const um = undoManagers.get(path)
  if (um) {
    const K = monaco.KeyMod, C = monaco.KeyCode
    editor.addCommand(K.CtrlCmd | C.KeyZ, () => void um.undo())
    editor.addCommand(K.CtrlCmd | K.Shift | C.KeyZ, () => void um.redo())
    editor.addCommand(K.CtrlCmd | C.KeyY, () => void um.redo())
  }
  b._rerenderDecorations()
  return () => {
    b.editors.delete(editor)
    subs.forEach((d) => d.dispose())
  }
}

/** Shared-aware undo for a file (used by the Edit menu and tests). */
export function undo(path: string) {
  undoManagers.get(path)?.undo()
}
export function redo(path: string) {
  undoManagers.get(path)?.redo()
}

/** A teammate deleted a file: close its editor and say so (its text is in History if needed). */
window.addEventListener('hive:remoteDelete', ((e: CustomEvent<{ path: string }>) => {
  const { path } = e.detail
  const st = useStore.getState()
  const open = !!st.tabs[`file:${path}`]
  monaco.editor.getModel(uriFor(path))?.dispose()
  if (open) {
    st.closeTab(`file:${path}`)
    st.toast(`A teammate deleted ${path}, so its tab was closed. History has its last changes.`, 'info')
  }
}) as EventListener)

/**
 * A teammate renamed a file I may have open: move my editor to the new name. (Edits I made to the old
 * name at the same moment still reach the renamer, whose Hive carries them over to the new file.)
 */
window.addEventListener('hive:remoteRename', ((e: CustomEvent<{ from: string; to: string; by: string }>) => {
  const { from, to, by } = e.detail
  const st = useStore.getState()
  const wasOpen = !!st.tabs[`file:${from}`]
  monaco.editor.getModel(uriFor(from))?.dispose()
  if (wasOpen) {
    st.closeTab(`file:${from}`)
    st.openFile(to)
  }
  st.toast(`${by} renamed ${from} to ${to}`)
}) as EventListener)

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

/** Replace only the part of the model that differs (keeps cursors, teammates' edits elsewhere and undo tidy). */
function minimalEdit(model: monaco.editor.ITextModel, next: string) {
  const prev = model.getValue()
  if (prev === next) return
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  const a = model.getPositionAt(start)
  const b = model.getPositionAt(endPrev)
  model.pushEditOperations([], [{ range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), text: next.slice(start, endNext) }], () => null)
}

/** Current text of a file: the open editor's copy, the shared copy, or disk. */
async function currentText(path: string) {
  const model = monaco.editor.getModel(uriFor(path))
  if (model) return model.getValue()
  const s = session()
  const shared = s?.shared ? s.parts.files.get(path)?.toString() : undefined
  return shared ?? (await invoke('fs:read', path).catch(() => ''))
}

/**
 * Accept an AI proposal. `base` is the file as the AI saw it. Only the AI's changes (base → proposed)
 * are applied on top of the current file, so edits made meanwhile by you or a teammate survive.
 * Returns false (nothing changed) when both changed the same lines.
 */
export async function applyProposal(path: string, base: string, proposed: string): Promise<{ ok: boolean; merged?: boolean }> {
  const current = await currentText(path)
  if (current === base || current === '') {
    await applyContent(path, proposed)
    return { ok: true }
  }
  if (current === proposed) return { ok: true }
  const merged = applyChangeOnto(base, proposed, current)
  if (merged === false) return { ok: false }
  await applyContent(path, merged)
  return { ok: true, merged: true }
}

/** Apply new content to a file (AI proposal accepted, etc.), keeping undo history. */
export async function applyContent(path: string, text: string) {
  const model = monaco.editor.getModel(uriFor(path))
  if (model) {
    minimalEdit(model, text)
    if (!bindings.has(path)) await saveFile(path)
  } else {
    const before = await invoke('fs:read', path).catch(() => '')
    const s = session()
    if (s?.shared) s.textFor(path, before) && setText(s.parts.files.get(path)!, text)
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

/** For QA scripts: which open files are bound to the shared copy. */
export const _debug = { boundPaths: () => [...bindings.keys()], undoPaths: () => [...undoManagers.keys()] }

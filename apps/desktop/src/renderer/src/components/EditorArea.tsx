import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Columns2, RotateCw, X } from 'lucide-react'
import { monaco } from '../lib/monaco'
import { ensureModel, attachEditor, applyProposal, startDiskReload } from '../lib/files'
import { useStore, type Tab } from '../store'
import { languageFor } from '@hive/editor'
import { ModelStore } from '../pages/ModelStore'
import { PlanningRoom } from '../pages/PlanningRoom'
import { session } from '../collab/session'
import icon from '../assets/icon.png'

export function EditorArea() {
  const groups = useStore((s) => s.groups)
  useEffect(() => startDiskReload(), [])
  return (
    <div className="flex h-full">
      {groups.map((g, i) => (
        <div key={i} className={`flex min-w-0 flex-1 flex-col ${i > 0 ? 'border-l border-line' : ''}`}>
          <TabBar group={i} />
          <div className="relative min-h-0 flex-1">{g.active ? <TabContent key={g.active.startsWith('file:') ? 'file' : g.active} tabId={g.active} group={i} /> : <Empty />}</div>
        </div>
      ))}
    </div>
  )
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
      <img src={icon} alt="" className="h-16 w-16 opacity-60" />
      <div>Open a file from the Explorer, or ask the Agents to build something.</div>
      <div className="text-[11px]">F5 runs the project · Ctrl+Shift+F searches · Ctrl+` toggles the terminal</div>
    </div>
  )
}

function TabBar({ group }: { group: number }) {
  const g = useStore((s) => s.groups[group])
  const tabs = useStore((s) => s.tabs)
  const dirty = useStore((s) => s.dirty)
  const focused = useStore((s) => s.focusedGroup === group)
  const { activate, closeTab, splitRight, groups } = useStore.getState()
  if (!g) return null
  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel">
      {g.tabs.map((id) => {
        const t = tabs[id]
        if (!t) return null
        const active = g.active === id
        const isDirty = t.kind === 'file' && dirty.has(t.path)
        return (
          <div
            key={id}
            onMouseDown={(e) => (e.button === 1 ? closeTab(id) : activate(id, group))}
            className={`group relative flex cursor-pointer items-center gap-2 border-r border-line px-3 text-[12.5px] ${active ? `bg-bg ${focused ? 'text-fg' : 'text-muted'}` : 'text-muted hover:text-fg'}`}
            title={t.kind === 'file' ? t.path : t.title}
          >
            {active && focused && <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" />}
            <span className="max-w-48 truncate">
              {t.title}
              {t.kind === 'file' && g.tabs.some((o) => o !== id && tabs[o]?.title === t.title) && (
                <span className="ml-1 text-[10px] text-muted">{t.path.split('/').slice(-3, -1).join('/')}</span>
              )}
            </span>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => closeTab(id)}
              className={`rounded p-0.5 hover:bg-panel2 ${isDirty ? '' : 'opacity-0 group-hover:opacity-100'}`}
              aria-label="Close tab"
            >
              {isDirty ? <span className="block h-2 w-2 rounded-full bg-fg" /> : <X size={12} />}
            </button>
          </div>
        )
      })}
      <div className="flex-1" />
      {groups.length < 2 && g.active && (
        <button className="btn-ghost mx-1 self-center" onClick={splitRight} title="Split editor right">
          <Columns2 size={14} />
        </button>
      )}
    </div>
  )
}

function TabContent({ tabId, group }: { tabId: string; group: number }) {
  const tab = useStore((s) => s.tabs[tabId])
  if (!tab) return null
  switch (tab.kind) {
    case 'file':
      return <CodeEditor path={tab.path} group={group} />
    case 'diff':
      return <DiffView tab={tab} />
    case 'preview':
      return <Preview url={tab.url} />
    case 'models':
      return <ModelStore />
    case 'planning':
      return <PlanningRoom />
  }
}

function CodeEditor({ path, group }: { path: string; group: number }) {
  const el = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const theme = useStore((s) => s.settings?.theme)
  const reveal = useStore((s) => s.reveal)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  // One editor per pane, kept across file tabs: creating a Monaco editor on every tab switch cost ~45 ms a switch
  // and lost the scroll position. Switching swaps the document and restores where you were in it.
  const getEditor = () => {
    if (editorRef.current) return editorRef.current
    const editor = monaco.editor.create(el.current!, {
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono Variable', 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace",
      fontLigatures: false,
      lineHeight: 20,
      padding: { top: 10 },
      cursorBlinking: 'smooth',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 2,
      readOnly: session()?.canEdit === false,
      theme: theme === 'dark' ? 'hive-dark' : 'vs',
      ...NORMAL_FILE
    })
    editor.onDidFocusEditorText(() => useStore.getState().set({ focusedGroup: group }))
    editorRef.current = editor
    return editor
  }

  useEffect(() => {
    let disposed = false
    let detach = () => {}
    const editor = getEditor()
    const key = `${group}:${path}`
    setError(null)
    ensureModel(path)
      .then((model) => {
        if (disposed) return
        editor.setModel(model)
        // Very large files: drop the per-keystroke extras so typing stays smooth.
        editor.updateOptions(model.getLineCount() > 50_000 ? LARGE_FILE : NORMAL_FILE)
        const view = viewStates.get(key)
        if (view) editor.restoreViewState(view)
        detach = attachEditor(path, editor)
        const r = useStore.getState().reveal
        if (r && r.path === path) jump(editor, r.line, r.col)
      })
      .catch((e) => setError(e.message))
    return () => {
      disposed = true
      if (editor.getModel()) viewStates.set(key, editor.saveViewState())
      detach()
    }
  }, [path])
  // declared after the effect above so its cleanup (saving the view) runs before the editor is disposed
  useEffect(
    () => () => {
      editorRef.current?.dispose()
      editorRef.current = null
    },
    []
  )

  useEffect(() => {
    if (reveal && reveal.path === path && editorRef.current?.getModel()) jump(editorRef.current, reveal.line, reveal.col)
  }, [reveal?.nonce])

  // the editor's element stays mounted (the same editor serves the next file tab); the error covers it
  return (
    <>
      <div ref={el} className="absolute inset-0" />
      {error && <div className="absolute inset-0 bg-bg p-6 text-muted">Can't open {path}: {error}</div>}
    </>
  )
}

const NORMAL_FILE: monaco.editor.IEditorOptions = {
  minimap: { enabled: true, scale: 1 },
  folding: true,
  bracketPairColorization: { enabled: true },
  occurrencesHighlight: 'singleFile',
  renderLineHighlight: 'line',
  matchBrackets: 'always',
  stickyScroll: { enabled: true }
}
const LARGE_FILE: monaco.editor.IEditorOptions = {
  minimap: { enabled: false },
  folding: false,
  bracketPairColorization: { enabled: false },
  occurrencesHighlight: 'off',
  renderLineHighlight: 'none',
  matchBrackets: 'never',
  // sticky scroll rebuilds the file's outline after every edit
  stickyScroll: { enabled: false }
}
/** Where each file was scrolled to and its cursor, per pane, so switching tabs comes back to the same place. */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

function jump(editor: monaco.editor.IStandaloneCodeEditor, line: number, col = 1) {
  editor.revealLineInCenter(line)
  editor.setPosition({ lineNumber: line, column: col })
  editor.focus()
}

function DiffView({ tab }: { tab: Extract<Tab, { kind: 'diff' }> }) {
  const el = useRef<HTMLDivElement>(null)
  const theme = useStore((s) => s.settings?.theme)
  useEffect(() => {
    const lang = languageFor(tab.path)
    const original = monaco.editor.createModel(tab.original, lang)
    const modified = monaco.editor.createModel(tab.modified, lang)
    const diff = monaco.editor.createDiffEditor(el.current!, {
      automaticLayout: true,
      readOnly: !tab.proposal,
      renderSideBySide: true,
      theme: theme === 'dark' ? 'hive-dark' : 'vs'
    })
    diff.setModel({ original, modified })
    ;(window as any).__hiveDiff = { [tab.id]: modified }
    return () => {
      diff.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [tab.id])

  const decide = async (accept: boolean) => {
    const st = useStore.getState()
    if (accept) {
      const m = (window as any).__hiveDiff?.[tab.id] as monaco.editor.ITextModel | undefined
      const r = await applyProposal(tab.path, tab.original, m?.getValue() ?? tab.modified)
      if (!r.ok) {
        // keep the tab open so nothing is lost
        st.toast(`${tab.path} changed in the same place since the AI read it. Ask again, or copy the parts you want from the right side.`, 'error')
        return
      }
      st.toast(r.merged ? `Applied the AI's changes to ${tab.path}, keeping the edits made since` : `Applied changes to ${tab.path}`, 'ok')
      st.openFile(tab.path)
    }
    st.closeTab(tab.id)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-[12px]">
        <span className="flex-1 truncate text-muted">
          {tab.proposal ? 'AI-proposed change — you can edit the right side before accepting' : 'Changes'} · {tab.path}
        </span>
        {tab.proposal && (
          <>
            <button className="btn" onClick={() => decide(false)}>
              Reject
            </button>
            <button className="btn-primary" onClick={() => decide(true)}>
              Accept
            </button>
          </>
        )}
      </div>
      <div ref={el} className="min-h-0 flex-1" />
    </div>
  )
}

function Preview({ url }: { url: string }) {
  const ref = useRef<any>(null)
  const [addr, setAddr] = useState(url)
  useEffect(() => setAddr(url), [url])
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line bg-panel px-2 py-1">
        <button className="btn-ghost" onClick={() => ref.current?.goBack()} aria-label="Back">
          <ArrowLeft size={14} />
        </button>
        <button className="btn-ghost" onClick={() => ref.current?.goForward()} aria-label="Forward">
          <ArrowRight size={14} />
        </button>
        <button className="btn-ghost" onClick={() => ref.current?.reload()} aria-label="Reload">
          <RotateCw size={13} />
        </button>
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(addr)) ref.current?.loadURL(addr)
          }}
        >
          <input className="input font-mono" value={addr} onChange={(e) => setAddr(e.target.value)} />
        </form>
      </div>
      {/* Preview is limited to localhost apps the user runs. */}
      <webview ref={ref} src={url} className="min-h-0 flex-1 bg-white" partition="hive-preview" />
    </div>
  )
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string }
    }
  }
}

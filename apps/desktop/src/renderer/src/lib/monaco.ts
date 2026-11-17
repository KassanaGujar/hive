import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { languageFor } from '@hive/editor'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

monaco.editor.defineTheme('hive-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8c7f6b', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f7ab0a' },
    { token: 'string', foreground: 'b5d39a' },
    { token: 'number', foreground: 'f0c27a' },
    { token: 'type', foreground: '63cdc4' },
    { token: 'tag', foreground: 'f7ab0a' },
    { token: 'attribute.name', foreground: '63cdc4' },
    { token: 'attribute.value', foreground: 'b5d39a' }
  ],
  colors: {
    'editor.background': '#16130f',
    'editor.foreground': '#f1e8d9',
    'editorGutter.background': '#16130f',
    'editor.lineHighlightBackground': '#1f1a15',
    'editorLineNumber.foreground': '#5d5345',
    'editorLineNumber.activeForeground': '#c9bca6',
    'editorCursor.foreground': '#f7ab0a',
    'editor.selectionBackground': '#f7ab0a40',
    'editor.inactiveSelectionBackground': '#f7ab0a22',
    'editorIndentGuide.background1': '#2a241c',
    'editorWidget.background': '#1d1915',
    'editorWidget.border': '#3a3228',
    'input.background': '#16130f',
    'minimap.background': '#16130f',
    'scrollbarSlider.background': '#3a322880',
    'scrollbarSlider.hoverBackground': '#4a4033a0'
  }
})

export function setMonacoTheme(theme: 'dark' | 'light') {
  monaco.editor.setTheme(theme === 'dark' ? 'hive-dark' : 'vs')
}

export const uriFor = (path: string) => monaco.Uri.parse(`hive:///${path}`)

/** One Monaco model per open file, shared across split editors. */
export function getModel(path: string, content?: string): monaco.editor.ITextModel {
  const uri = uriFor(path)
  const existing = monaco.editor.getModel(uri)
  if (existing) return existing
  const model = monaco.editor.createModel(content ?? '', languageFor(path), uri)
  // Same line endings for Windows and Mac teammates: LF unless the file already uses CRLF.
  const CRLF = String.fromCharCode(13, 10)
  if (!(content ?? '').includes(CRLF)) model.setEOL(monaco.editor.EndOfLineSequence.LF)
  return model
}

export function disposeModel(path: string) {
  monaco.editor.getModel(uriFor(path))?.dispose()
}

/**
 * Drop every open file document. Paths repeat between projects (README.md, index.html): a document left over
 * from the previous project would be reused, showing its old text and syncing into the old project's session.
 */
export function disposeAllFileModels() {
  for (const m of monaco.editor.getModels()) if (m.uri.scheme === 'hive') m.dispose()
}

export function renameModel(from: string, to: string) {
  const m = monaco.editor.getModel(uriFor(from))
  if (!m) return
  const text = m.getValue()
  m.dispose()
  getModel(to, text)
}

export { monaco }

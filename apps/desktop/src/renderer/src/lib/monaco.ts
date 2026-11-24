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
    { token: 'comment', foreground: '6177a3', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f5b521' },
    { token: 'string', foreground: '9fe0b4' },
    { token: 'number', foreground: 'ffcf70' },
    { token: 'type', foreground: '7fb4ff' },
    { token: 'tag', foreground: 'f5b521' },
    { token: 'attribute.name', foreground: '7fb4ff' },
    { token: 'attribute.value', foreground: '9fe0b4' }
  ],
  colors: {
    'editor.background': '#05070c',
    'editor.foreground': '#eef2fa',
    'editorGutter.background': '#05070c',
    'editor.lineHighlightBackground': '#0c1630',
    'editorLineNumber.foreground': '#34477a',
    'editorLineNumber.activeForeground': '#b9c6e2',
    'editorCursor.foreground': '#f5b521',
    'editor.selectionBackground': '#7fb4ff40',
    'editor.inactiveSelectionBackground': '#7fb4ff22',
    'editorIndentGuide.background1': '#14213f',
    'editorWidget.background': '#0c1630',
    'editorWidget.border': '#1f3158',
    'input.background': '#05070c',
    'minimap.background': '#05070c',
    'scrollbarSlider.background': '#1f315880',
    'scrollbarSlider.hoverBackground': '#2b4274a0'
  }
})

monaco.editor.defineTheme('hive-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a7a9c', fontStyle: 'italic' },
    { token: 'keyword', foreground: '9a6a00' },
    { token: 'string', foreground: '1d7a46' },
    { token: 'number', foreground: 'a35a00' },
    { token: 'type', foreground: '2f6fd6' },
    { token: 'tag', foreground: '0b1a36' },
    { token: 'attribute.name', foreground: '2f6fd6' },
    { token: 'attribute.value', foreground: '1d7a46' }
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#0b1a36',
    'editor.lineHighlightBackground': '#eef2f8',
    'editorLineNumber.foreground': '#a3b0c8',
    'editorLineNumber.activeForeground': '#0b1a36',
    'editorCursor.foreground': '#0b1a36',
    'editor.selectionBackground': '#2f6fd630'
  }
})

export function setMonacoTheme(theme: 'dark' | 'light') {
  monaco.editor.setTheme(theme === 'dark' ? 'hive-dark' : 'hive-light')
}

export const uriFor = (path: string) => monaco.Uri.parse(`hive:///${path}`)

/** One Monaco model per open file, shared across split editors. */
/** Above this size a file opens without language features (colours, outline, suggestions) so typing stays smooth. */
export const LARGE_FILE_CHARS = 2_000_000

export function getModel(path: string, content?: string): monaco.editor.ITextModel {
  const uri = uriFor(path)
  const existing = monaco.editor.getModel(uri)
  if (existing) return existing
  // Very large files open as plain text, like VS Code's large-file mode: the language worker re-analysed all 4.5 MB
  // and rebuilt its outline after every keystroke, which made typing in a 100,000-line file lag (p95 50-77 ms).
  const language = (content?.length ?? 0) > LARGE_FILE_CHARS ? 'plaintext' : languageFor(path)
  const model = monaco.editor.createModel(content ?? '', language, uri)
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

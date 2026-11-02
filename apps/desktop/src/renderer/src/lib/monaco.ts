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
  rules: [],
  colors: { 'editor.background': '#14161b', 'editorGutter.background': '#14161b', 'editor.lineHighlightBackground': '#1d2027' }
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
  return monaco.editor.createModel(content ?? '', languageFor(path), uri)
}

export function disposeModel(path: string) {
  monaco.editor.getModel(uriFor(path))?.dispose()
}

export function renameModel(from: string, to: string) {
  const m = monaco.editor.getModel(uriFor(from))
  if (!m) return
  const text = m.getValue()
  m.dispose()
  getModel(to, text)
}

export { monaco }

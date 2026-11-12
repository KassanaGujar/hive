import { useEffect, useRef, useState } from 'react'
import type { SearchMatch } from '@hive/shared'
import { invoke } from '../lib/api'
import { useStore } from '../store'

/** Search across files (Ctrl+Shift+F). */
export function SearchPanel() {
  const [q, setQ] = useState('')
  const [regex, setRegex] = useState(false)
  const [cs, setCs] = useState(false)
  const [results, setResults] = useState<SearchMatch[]>([])
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    clearTimeout(timer.current)
    if (!q) return setResults([])
    timer.current = setTimeout(async () => {
      setBusy(true)
      try {
        setResults(await invoke('fs:search', q, { regex, caseSensitive: cs }))
      } catch {
        setResults([])
      }
      setBusy(false)
    }, 250)
  }, [q, regex, cs])

  const grouped = results.reduce<Record<string, SearchMatch[]>>((acc, r) => ((acc[r.path] ??= []).push(r), acc), {})
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-3">
        <span className="pane-title">Search</span>
        <input className="input" autoFocus placeholder="Search in files" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-3 text-[11px] text-muted">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regex
          </label>
          <span className="flex-1 text-right">{busy ? 'searching…' : q ? `${results.length} results` : ''}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-6">
        {Object.entries(grouped).map(([path, list]) => (
          <div key={path}>
            <div className="truncate px-3 py-1 font-medium">{path}</div>
            {list.map((m) => (
              <button
                key={`${m.line}:${m.col}`}
                className="block w-full truncate py-0.5 pr-2 pl-6 text-left font-mono text-[11px] text-muted hover:bg-panel2 hover:text-fg"
                onClick={() => useStore.getState().openFile(path, { line: m.line, col: m.col })}
              >
                <span className="mr-2 text-accent">{m.line}</span>
                {m.text.trim()}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

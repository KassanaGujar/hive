import { useEffect, useRef } from 'react'
import { Bot, Maximize2 } from 'lucide-react'
import { languageFor } from '@hive/editor'
import { monaco } from '../lib/monaco'
import { invoke } from '../lib/api'
import { useStore, type LiveFile } from '../store'

/** Agent cursor colours: blues and greens, kept apart from the gold people use for actions. */
const AGENT_TONES = ['#7fb4ff', '#5fd3e6', '#a99bff', '#62e0b0', '#8fc8ff', '#c3b4ff']
const toneFor = (name: string) => AGENT_TONES[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AGENT_TONES.length]

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The Code page's live view: every file the AI team is writing, side by side, each with the writing agent's cursor.
 * Agents save whole files, so each change is typed out briefly (at most ~1.2 s) where it happened.
 */
export function LiveGrid() {
  const live = useStore((s) => s.live)
  const runs = useStore((s) => s.runs)
  if (!live.length) {
    const working = runs.some((r) => ['planning', 'working', 'merging'].includes(r.phase))
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <Bot size={28} className="text-wing" />
        <div className="display text-[20px]">{working ? 'The team is getting started' : 'Nothing being written yet'}</div>
        <p className="max-w-sm text-muted">{working ? 'Files show up here the moment an agent writes them.' : 'Start a build on the AI team page and every file the agents write appears here as they write it.'}</p>
        <div className="flex gap-2">
          {!working && (
            <button className="btn-primary" onClick={() => useStore.getState().set({ page: 'team' })}>
              Go to AI team
            </button>
          )}
          <button className="btn" onClick={() => useStore.getState().set({ codeView: 'files' })}>
            Show my files
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="live-grid h-full overflow-auto bg-bg p-3">
      {live.map((f) => (
        <LiveTile key={f.path} f={f} />
      ))}
    </div>
  )
}

function LiveTile({ f }: { f: LiveFile }) {
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const typing = useRef<number | null>(null)
  const tone = toneFor(f.agent)
  const name = f.path.split('/').pop() ?? f.path
  const task = /^\.hive\/worktrees\/[^/]+\/([^/]+)\//.exec(f.path)?.[1]

  useEffect(() => {
    const model = monaco.editor.createModel('', languageFor(f.path))
    const e = monaco.editor.create(host.current!, {
      model,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      fontSize: 12,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      folding: false,
      automaticLayout: true,
      fontFamily: "'JetBrains Mono Variable', 'Cascadia Code', Consolas, monospace"
    })
    ed.current = e
    return () => {
      if (typing.current) cancelAnimationFrame(typing.current)
      e.dispose()
      model.dispose()
    }
  }, [f.path])

  // every write: read the file, then type the changed part with the agent's cursor
  useEffect(() => {
    let alive = true
    invoke('fs:read', f.path)
      .then((text: string) => alive && ed.current && typeChange(ed.current, text, f.agent, tone, typing))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [f.at, f.path, f.agent, tone])

  return (
    <section className="live-tile" style={{ ['--agent' as string]: tone }}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} aria-hidden="true" />
        <span className="min-w-0 truncate text-[12.5px] font-semibold">{name}</span>
        <span className="truncate text-[11.5px] text-muted">
          {f.agent}
          {task && task !== '_integration' ? `, task ${task}` : ''}
        </span>
        <div className="flex-1" />
        <button
          className="btn-ghost !px-1.5"
          title="Work on this file on its own"
          aria-label={`Open ${name} on its own`}
          onClick={() => {
            useStore.getState().set({ codeView: 'files' })
            useStore.getState().openFile(f.path)
          }}
        >
          <Maximize2 size={13} /> Open
        </button>
      </header>
      <div ref={host} className="min-h-0 flex-1" />
    </section>
  )
}

/** The agent's name, floating just above its cursor (one per editor, moved as it types). */
const tags = new WeakMap<monaco.editor.IStandaloneCodeEditor, { widget: monaco.editor.IContentWidget; position: monaco.IPosition | null; node: HTMLElement; hide?: ReturnType<typeof setTimeout> }>()
function nameTag(e: monaco.editor.IStandaloneCodeEditor, agent: string) {
  let t = tags.get(e)
  if (!t) {
    const node = document.createElement('div')
    node.className = 'agent-tag'
    const entry = { position: null as monaco.IPosition | null, node, widget: null as unknown as monaco.editor.IContentWidget }
    entry.widget = {
      getId: () => 'hive.agentTag',
      getDomNode: () => node,
      getPosition: () => (entry.position ? { position: entry.position, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW] } : null)
    }
    e.addContentWidget(entry.widget)
    t = entry
    tags.set(e, t)
  }
  t.node.textContent = agent
  clearTimeout(t.hide)
  return t
}

/** Once the agent stops writing, its name tag goes after a moment (it would cover the code above); the cursor stays. */
function hideTagSoon(e: monaco.editor.IStandaloneCodeEditor) {
  const t = tags.get(e)
  if (!t) return
  clearTimeout(t.hide)
  t.hide = setTimeout(() => {
    t.position = null
    e.layoutContentWidget(t.widget)
  }, 2500)
}

/** Show `next` in the editor: the part that changed is typed in with the agent's cursor and name tag. */
function typeChange(e: monaco.editor.IStandaloneCodeEditor, next: string, agent: string, tone: string, typing: { current: number | null }) {
  const model = e.getModel()
  if (!model) return
  if (typing.current) cancelAnimationFrame(typing.current)
  const prev = model.getValue()
  if (prev === next) return
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++
  let endP = prev.length
  let endN = next.length
  while (endP > start && endN > start && prev[endP - 1] === next[endN - 1]) endP--, endN--
  const inserted = next.slice(start, endN)
  const head = prev.slice(0, start)
  const tail = prev.slice(endP)
  let decorations: string[] = []
  const tag = nameTag(e, agent)
  const caretAt = (offset: number) => {
    const pos = model.getPositionAt(offset)
    decorations = e.deltaDecorations(decorations, [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), options: { beforeContentClassName: 'agent-caret' } }])
    tag.position = pos
    e.layoutContentWidget(tag.widget)
    e.revealLineInCenterIfOutsideViewport(pos.lineNumber)
  }
  e.getDomNode()?.style.setProperty('--agent', tone)
  if (reduceMotion() || inserted.length === 0) {
    model.setValue(next)
    caretAt(start + inserted.length)
    hideTagSoon(e)
    return
  }
  // ~1.2 s at most, whatever the size of the change
  const frames = Math.min(72, Math.max(8, Math.ceil(inserted.length / 6)))
  let frame = 0
  const step = () => {
    frame++
    const n = Math.ceil((inserted.length * frame) / frames)
    model.setValue(head + inserted.slice(0, n) + tail)
    caretAt(start + n)
    if (frame < frames) typing.current = requestAnimationFrame(step)
    else {
      typing.current = null
      hideTagSoon(e)
    }
  }
  typing.current = requestAnimationFrame(step)
}

import { useEffect, useRef, useState } from 'react'
import { Columns2, Plus, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { invoke, on } from '../lib/api'
import { useStore } from '../store'
import { session } from '../collab/session'

interface TermTab {
  id: string
  title: string
  remoteKey?: string // read-only mirror of a teammate's terminal
}

// Buffers survive tab switches: xterm instances are kept per terminal id.
const instances = new Map<string, { term: Terminal; fit: FitAddon; host: HTMLDivElement }>()
const mirrorBuf = new Map<string, string>()
const mirrorTimers = new Map<string, ReturnType<typeof setTimeout>>()

function themeFor(dark: boolean) {
  return dark
    ? { background: '#14161b', foreground: '#e3e6ec', cursor: '#f5b400', selectionBackground: '#f5b40055' }
    : { background: '#ffffff', foreground: '#1c1f26', cursor: '#e09a00', selectionBackground: '#e09a0040' }
}

/** Turn "src/app.ts:12:5" style text into clickable links that open the file. */
function addFileLinks(term: Terminal) {
  const re = /((?:[\w.-]+[\\/])*[\w.-]+\.[a-zA-Z]{1,6})(?::(\d+))?(?::(\d+))?/g
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? ''
      const links: any[] = []
      let m: RegExpExecArray | null
      re.lastIndex = 0
      while ((m = re.exec(line))) {
        const path = m[1].replace(/\\/g, '/').replace(/^\.\//, '')
        if (/^https?:/.test(line.slice(Math.max(0, m.index - 8), m.index + 1)) || /^\d+\.\d+/.test(path)) continue
        const lineNo = m[2] ? Number(m[2]) : undefined
        const col = m[3] ? Number(m[3]) : undefined
        links.push({
          range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } },
          text: m[0],
          activate: () => {
            const root = useStore.getState().root ?? ''
            const rel = path.startsWith(root.replace(/\\/g, '/')) ? path.slice(root.length + 1) : path
            invoke('fs:read', rel)
              .then(() => useStore.getState().openFile(rel, lineNo ? { line: lineNo, col } : undefined))
              .catch(() => {})
          }
        })
      }
      callback(links)
    }
  })
}

function getInstance(id: string, readOnly = false) {
  let inst = instances.get(id)
  if (inst) return inst
  const dark = useStore.getState().settings?.theme !== 'light'
  const term = new Terminal({ fontFamily: "'Cascadia Mono', Consolas, monospace", fontSize: 13, cursorBlink: !readOnly, disableStdin: readOnly, theme: themeFor(dark), scrollback: 5000, allowProposedApi: true })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon((_e, uri) => invoke('shell:openExternal', uri)))
  addFileLinks(term)
  const host = document.createElement('div')
  host.style.height = '100%'
  term.open(host)
  if (!readOnly) {
    term.onData((d) => invoke('term:write', id, d))
    term.onResize(({ cols, rows }) => invoke('term:resize', id, cols, rows))
  }
  inst = { term, fit, host }
  instances.set(id, inst)
  return inst
}

export function TerminalPanel() {
  const [tabs, setTabs] = useState<TermTab[]>([])
  const [active, setActive] = useState<string[]>([]) // 1 or 2 visible (split)
  const run = useStore((s) => s.run)
  const theme = useStore((s) => s.settings?.theme)
  const [remote, setRemote] = useState<string[]>([])
  const collabStatus = useStore((st) => st.collabStatus)

  // data/exit events
  useEffect(() => {
    const offData = on('term:data', ({ id, data }) => {
      getInstance(id).term.write(data)
      // Detect a dev server URL in run output → offer the preview.
      if (id === useStore.getState().run.terminalId) {
        const m = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/.exec(data.replace(/\x1b\[[0-9;]*m/g, ''))
        if (m && useStore.getState().run.previewUrl !== m[1]) invoke('run:preview', m[1])
      }
      mirror(id, data)
    })
    const offExit = on('term:exit', ({ id, code }) => {
      instances.get(id)?.term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  // run terminal appears as its own tab
  useEffect(() => {
    if (run.terminalId && !tabs.some((t) => t.id === run.terminalId)) {
      setTabs((t) => [...t.filter((x) => x.title !== 'Run'), { id: run.terminalId!, title: 'Run' }])
      setActive([run.terminalId])
    }
  }, [run.terminalId])

  // one shell on first open
  useEffect(() => {
    if (tabs.length === 0) newTerm()
  }, [])

  // theme switch
  useEffect(() => {
    for (const i of instances.values()) i.term.options.theme = themeFor(theme !== 'light')
  }, [theme])

  // teammates' terminals (shared projects)
  useEffect(() => {
    const s = session()
    if (!s) return
    const update = () => setRemote([...s.parts.terminals.keys()].filter((k) => !k.startsWith(`${myName()}:`)))
    update()
    s.parts.terminals.observe(update)
    return () => s.parts.terminals.unobserve(update)
  }, [collabStatus])

  const newTerm = async () => {
    const id = await invoke('term:create')
    setTabs((t) => [...t, { id, title: `Terminal ${t.filter((x) => !x.remoteKey && x.title !== 'Run').length + 1}` }])
    setActive([id])
  }

  const split = async () => {
    const id = await invoke('term:create')
    setTabs((t) => [...t, { id, title: `Terminal ${t.length + 1}` }])
    setActive((a) => [a[0], id].filter(Boolean))
  }

  const close = (id: string) => {
    const t = tabs.find((x) => x.id === id)
    if (!t?.remoteKey) invoke('term:kill', id)
    instances.get(id)?.term.dispose()
    instances.delete(id)
    const rest = tabs.filter((x) => x.id !== id)
    setTabs(rest)
    setActive((a) => {
      const next = a.filter((x) => x !== id)
      return next.length ? next : rest.length ? [rest[rest.length - 1].id] : []
    })
  }

  const openRemote = (key: string) => {
    const id = `remote:${key}`
    if (!tabs.some((t) => t.id === id)) setTabs((t) => [...t, { id, title: `👀 ${key}`, remoteKey: key }])
    setActive([id])
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-1">
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => setActive([t.id])}
            className={`group flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[12px] ${active.includes(t.id) ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg'}`}
          >
            {t.title}
            <button className="opacity-0 group-hover:opacity-100" onClick={(e) => (e.stopPropagation(), close(t.id))} aria-label="Close terminal">
              <X size={11} />
            </button>
          </div>
        ))}
        <button className="btn-ghost" onClick={newTerm} title="New terminal">
          <Plus size={13} />
        </button>
        <button className="btn-ghost" onClick={split} title="Split terminal">
          <Columns2 size={13} />
        </button>
        <div className="flex-1" />
        {remote.map((k) => (
          <button key={k} className="btn-ghost text-[11px]" onClick={() => openRemote(k)} title="Watch a teammate's terminal">
            👀 {k}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        {active.map((id) => {
          const t = tabs.find((x) => x.id === id)
          return t ? <TermView key={id} tab={t} /> : null
        })}
      </div>
    </div>
  )
}

function TermView({ tab }: { tab: TermTab }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const inst = getInstance(tab.id, !!tab.remoteKey)
    box.current!.appendChild(inst.host)
    const ro = new ResizeObserver(() => {
      try {
        inst.fit.fit()
      } catch {
        /* hidden */
      }
    })
    ro.observe(box.current!)
    inst.term.focus()
    let unobserve = () => {}
    if (tab.remoteKey) {
      const s = session()
      const render = () => {
        inst.term.reset()
        inst.term.write(s?.parts.terminals.get(tab.remoteKey!) ?? '')
      }
      render()
      s?.parts.terminals.observe(render)
      unobserve = () => s?.parts.terminals.unobserve(render)
    }
    return () => {
      ro.disconnect()
      unobserve()
      inst.host.remove()
    }
  }, [tab.id])
  return <div ref={box} className="min-w-0 flex-1 border-r border-line last:border-r-0" />
}

const myName = () => useStore.getState().settings?.profile?.name ?? 'me'

/** Share recent output of my terminals with teammates (throttled, last 16 KB). */
function mirror(id: string, data: string) {
  const s = session()
  if (!s?.shared) return
  const isRun = id === useStore.getState().run.terminalId
  const key = `${myName()}:${isRun ? 'run' : id}`
  mirrorBuf.set(key, ((mirrorBuf.get(key) ?? '') + data).slice(-16000))
  if (mirrorTimers.has(key)) return
  mirrorTimers.set(
    key,
    setTimeout(() => {
      mirrorTimers.delete(key)
      s.parts.terminals.set(key, mirrorBuf.get(key) ?? '')
    }, 500)
  )
}

import { useEffect, useRef, useState } from 'react'
import { FileDiff, Send, Square, Trash2 } from 'lucide-react'
import { stripThinking } from '@hive/models'
import type { ChatMessage } from '@hive/shared'
import { invoke, on } from '../lib/api'
import { useStore } from '../store'
import { monaco, uriFor } from '../lib/monaco'
import { openModelStore, refreshModels } from '../lib/actions'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  file?: string
}

const SYSTEM = `You are Hive's coding assistant inside a code editor. Be concise and practical.
When you want to change a file, output the COMPLETE new content of that file in a fenced code block
whose info string is the file path, like:
\`\`\`src/app.js
...full file...
\`\`\`
The user will see it as a diff and can accept or reject it. Never output partial files in path blocks.`

/** Code blocks tagged with a file path = proposed edits. */
export function parseProposals(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = []
  const re = /```([^\s`]+\.[A-Za-z0-9]+)\s*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const path = m[1].replace(/^\.?\//, '')
    if (/^(js|ts|tsx|jsx|py|html|css|json|bash|sh)$/i.test(path)) continue
    out.push({ path, content: m[2] })
  }
  return out
}

export function ChatPanel() {
  const models = useStore((s) => s.models)
  const chatModel = useStore((s) => s.chatModel)
  const activeTab = useStore((s) => {
    const g = s.groups[s.focusedGroup]
    const t = g?.active ? s.tabs[g.active] : undefined
    return t?.kind === 'file' ? t.path : null
  })
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streamId, setStreamId] = useState<string | null>(null)
  const [includeFile, setIncludeFile] = useState(true)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    refreshModels()
  }, [])

  useEffect(
    () =>
      on('chat:chunk', ({ streamId: id, chunk, error }) => {
        if (id !== streamIdRef.current) return
        if (chunk.text) setMsgs((m) => [...m.slice(0, -1), { ...m[m.length - 1], content: m[m.length - 1].content + chunk.text }])
        if (error) setMsgs((m) => [...m.slice(0, -1), { ...m[m.length - 1], content: m[m.length - 1].content + `\n\n⚠ ${error}` }])
        if (chunk.done) setStreamId(null)
      }),
    []
  )
  const streamIdRef = useRef<string | null>(null)
  streamIdRef.current = streamId

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs])

  const send = async () => {
    const text = input.trim()
    if (!text || !chatModel || streamId) return
    const file = includeFile ? activeTab : null
    const fileText = file ? monaco.editor.getModel(uriFor(file))?.getValue() : undefined
    const userMsg: Msg = { role: 'user', content: text, file: file ?? undefined }
    const history: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      ...msgs.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: fileText !== undefined ? `Open file: ${file}\n\`\`\`${file}\n${fileText.slice(0, 40000)}\n\`\`\`\n\n${text}` : text }
    ]
    setMsgs((m) => [...m, userMsg, { role: 'assistant', content: '' }])
    setInput('')
    try {
      const id = await invoke('chat:stream', chatModel, history)
      streamIdRef.current = id
      setStreamId(id)
    } catch (e) {
      setMsgs((m) => [...m.slice(0, -1), { role: 'assistant', content: `⚠ ${(e as Error).message}` }])
    }
  }

  const review = async (path: string, content: string) => {
    const original = monaco.editor.getModel(uriFor(path))?.getValue() ?? (await invoke('fs:read', path).catch(() => ''))
    useStore.getState().openTab({ id: `proposal:${path}:${Date.now()}`, kind: 'diff', title: `✨ ${path.split('/').pop()}`, path, original, modified: content, proposal: true })
  }

  if (!models.length)
    return (
      <div className="flex flex-col gap-3 p-4">
        <span className="label">AI chat</span>
        <div className="text-muted">No models yet. Download a free one to start chatting.</div>
        <button className="btn-primary self-start" onClick={openModelStore}>
          Open Model store
        </button>
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-line px-3">
        <span className="label">AI chat</span>
        <select className="input flex-1" value={chatModel ?? ''} onChange={(e) => useStore.getState().set({ chatModel: e.target.value })}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button className="btn-ghost" title="Clear chat" onClick={() => setMsgs([])}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {msgs.length === 0 && <div className="text-muted">Ask about the open file, request a change, or get help with an error.</div>}
        {msgs.map((m, i) => {
          const visible = m.role === 'assistant' ? stripThinking(m.content) : m.content
          const proposals = m.role === 'assistant' && !(streamId && i === msgs.length - 1) ? parseProposals(visible) : []
          return (
            <div key={i} className={`mb-3 ${m.role === 'user' ? 'ml-6' : ''}`}>
              <div className="mb-0.5 text-[11px] text-muted">
                {m.role === 'user' ? 'You' : 'AI'}
                {m.file && ` · about ${m.file}`}
              </div>
              <div className={`rounded-lg px-3 py-2 whitespace-pre-wrap ${m.role === 'user' ? 'bg-accent/15' : 'bg-panel2'} font-[inherit] leading-relaxed`}>
                <RichText text={visible || (streamId && i === msgs.length - 1 ? '…' : '')} />
              </div>
              {proposals.map((p) => (
                <button key={p.path} className="btn mt-1 mr-1" onClick={() => review(p.path, p.content)}>
                  <FileDiff size={12} /> Review change to {p.path}
                </button>
              ))}
            </div>
          )
        })}
        <div ref={end} />
      </div>
      <div className="border-t border-line p-2">
        {activeTab && (
          <label className="mb-1 flex items-center gap-1 text-[11px] text-muted">
            <input type="checkbox" checked={includeFile} onChange={(e) => setIncludeFile(e.target.checked)} /> Include {activeTab}
          </label>
        )}
        <div className="flex gap-2">
          <textarea
            className="input h-16 resize-none"
            placeholder="Ask the AI… (Enter to send, Shift+Enter for a new line)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          {streamId ? (
            <button className="btn" onClick={() => invoke('chat:abort', streamId)} aria-label="Stop">
              <Square size={14} />
            </button>
          ) : (
            <button className="btn-primary" onClick={send} disabled={!input.trim()} aria-label="Send">
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Minimal formatting: fenced code blocks in mono. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('```') ? (
          <pre key={i} className="my-1 overflow-x-auto rounded bg-bg p-2 font-mono text-[11.5px] whitespace-pre">
            {p.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}
          </pre>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Loader2, Send, Server, UserX } from 'lucide-react'
import type { ChatMsg } from '@hive/collab'
import { invoke, timeAgo } from '../lib/api'
import { useStore } from '../store'
import { session, memberId } from '../collab/session'

/** Invite, members (roles, remove), relay settings and the project chat. */
export function TeamPanel() {
  const status = useStore((s) => s.collabStatus)
  const members = useStore((s) => s.members)
  const settings = useStore((s) => s.settings)!
  const toast = useStore((s) => s.toast)
  const s = session()
  const [invite, setInvite] = useState<{ code: string; link: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [relay, setRelay] = useState(settings.relayUrl)
  const [local, setLocal] = useState<{ running: boolean; urls: string[] }>({ running: false, urls: [] })

  useEffect(() => {
    invoke('relay:status').then(setLocal)
  }, [])

  const share = async (role: 'editor' | 'viewer' = 'editor') => {
    if (!s) return
    setBusy(true)
    try {
      if (relay !== settings.relayUrl) useStore.getState().set({ settings: await invoke('settings:set', { relayUrl: relay }) })
      setInvite(s.shared ? await s.newInvite(role) : await s.share(relay))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    setBusy(false)
  }

  const hostLocally = async () => {
    try {
      const r = await invoke('relay:startLocal')
      setLocal({ running: true, urls: r.urls })
      setRelay(r.urls.find((u) => !u.includes('localhost')) ?? r.urls[0])
      toast('Relay running on this PC. Friends on other networks need a tunnel — see the help link.', 'ok')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const copy = (t: string) => {
    navigator.clipboard.writeText(t)
    toast('Copied', 'ok')
  }

  const me = memberId()
  const isHost = s?.isHost ?? false

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center px-3">
        <span className="pane-title flex-1">People</span>
        <span className="text-[11px] text-muted">{status === 'solo' ? 'not shared' : status}</span>
      </div>
      <div className="flex flex-col gap-3 px-3 pb-3">
        {(!s?.shared || isHost) && (
          <div className="card flex flex-col gap-2 p-3">
            {!s?.shared && (
              <>
                <div className="text-muted">Share this project so up to 10 friends can edit it live. Everything is end-to-end encrypted; the relay can't read your code.</div>
                <div>
                  <div className="label mb-1">Relay server</div>
                  <input className="input font-mono" value={relay} onChange={(e) => setRelay(e.target.value)} />
                </div>
                {!local.running ? (
                  <button className="btn self-start" onClick={hostLocally}>
                    <Server size={12} /> Host the relay on this PC
                  </button>
                ) : (
                  <div className="text-[11px] text-muted">Relay on this PC: {local.urls.join(' · ')}</div>
                )}
              </>
            )}
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => share('editor')}>
                {busy && <Loader2 size={12} className="animate-spin" />} {s?.shared ? 'New invite' : 'Share & invite'}
              </button>
              {s?.shared && (
                <button className="btn" disabled={busy} onClick={() => share('viewer')}>
                  Viewer invite
                </button>
              )}
            </div>
            {invite && (
              <div className="rounded-md bg-panel2 p-2">
                <div className="mb-1 text-[11px] text-muted">Send your friend the link (best) or the code. Expires in 24 hours.</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[20px] font-bold tracking-widest text-accent">{invite.code}</span>
                  <button className="btn-ghost" onClick={() => copy(invite.code)} aria-label="Copy code">
                    <Copy size={13} />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <input className="input font-mono text-[10px]" readOnly value={invite.link} onFocus={(e) => e.target.select()} />
                  <button className="btn" onClick={() => copy(invite.link)}>
                    Copy link
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {members.length > 0 && (
          <div>
            <div className="label mb-1">People ({members.length}/10)</div>
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-panel2">
                <span className="relative text-lg">
                  {m.avatar}
                  <span className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2 ring-panel ${m.online ? 'bg-ok' : 'bg-muted'}`} />
                </span>
                <span className="flex-1 truncate" style={{ color: m.color }}>
                  {m.name}
                  {m.id === me && ' (you)'}
                </span>
                {isHost && m.role !== 'host' ? (
                  <>
                    <select className="input w-auto text-[11px]" value={m.role} onChange={(e) => s?.provider?.setRole(m.id, e.target.value as 'editor' | 'viewer')}>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button className="btn-ghost" title="Remove" onClick={() => confirm(`Remove ${m.name} from the project?`) && s?.provider?.kick(m.id)}>
                      <UserX size={13} />
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-muted">{m.role}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {s?.shared && !isHost && (
          <button className="btn self-start" onClick={() => confirm('Stop syncing this project? Your local copy stays.') && s.leave()}>
            Leave project
          </button>
        )}
      </div>
      <ChatChannel channel="project" />
    </div>
  )
}

/** Shared chat with @mentions and file:line links. Used by the Team panel and the Planning room. */
export function ChatChannel({ channel, onSend }: { channel: ChatMsg['channel']; onSend?: (m: ChatMsg) => void }) {
  const s = session()
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const members = useStore((st) => st.members)
  const myName = useStore((st) => st.settings?.profile?.name)

  useEffect(() => {
    if (!s) return
    const update = () => setMsgs(s.parts.chat.toArray().filter((m) => m.channel === channel))
    update()
    s.parts.chat.observe(update)
    const notify = (e: import('yjs').YArrayEvent<ChatMsg>, tr: import('yjs').Transaction) => {
      if (tr.local) return
      for (const item of e.changes.added)
        for (const m of item.content.getContent() as ChatMsg[]) {
          if (myName && m.text.includes(`@${myName}`)) {
            useStore.getState().toast(`${m.author} mentioned you: ${m.text.slice(0, 80)}`)
            if (document.hidden) invoke('notify', `${m.author} mentioned you`, m.text)
          }
        }
    }
    s.parts.chat.observe(notify)
    return () => {
      s.parts.chat.unobserve(update)
      s.parts.chat.unobserve(notify)
    }
  }, [s, channel])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs.length])

  const mention = useMemo(() => /@(\w*)$/.exec(text)?.[1], [text])
  const suggestions = mention !== undefined ? members.filter((m) => m.name.toLowerCase().startsWith(mention.toLowerCase())).slice(0, 5) : []

  const send = () => {
    if (!s || !text.trim()) return
    const m = s.sendChat(text.trim(), channel)
    setText('')
    onSend?.(m)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line">
      <div className="label px-3 pt-2">{channel === 'project' ? 'Project chat' : 'Team chat'}</div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {msgs.length === 0 && <div className="text-muted">{channel === 'planning' ? 'Pitch ideas here. The Planner turns them into the plan.' : 'Say hi. Use @name to mention someone and path:line to link code.'}</div>}
        {msgs.map((m) => (
          <div key={m.id} className="mb-2">
            <div className="text-[11px]">
              <b style={{ color: m.color }}>{m.author}</b> <span className="text-muted">{timeAgo(m.at)}</span>
              {m.syncedLate && <span className="ml-1 text-warn">synced late</span>}
              <span className="ml-1 font-mono text-[9px] text-muted/60">{m.id.slice(-4)}</span>
            </div>
            <div className="whitespace-pre-wrap">
              <ChatText text={m.text} />
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="relative border-t border-line p-2">
        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-2 mb-1 rounded-md border border-line bg-panel py-1 shadow-lg">
            {suggestions.map((m) => (
              <button key={m.id} className="block w-full px-3 py-0.5 text-left hover:bg-panel2" onClick={() => setText(text.replace(/@\w*$/, `@${m.name} `))}>
                {m.avatar} {m.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="input"
            placeholder={channel === 'planning' ? 'Pitch an idea…' : 'Message the team…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button className="btn-primary" onClick={send} aria-label="Send">
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Linkify @mentions and file:line references. */
function ChatText({ text }: { text: string }) {
  const parts = text.split(/(@\w+|(?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,5}(?::\d+)?)/gi)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('@')) return <b key={i} className="text-accent">{p}</b>
        const m = /^((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,5})(?::(\d+))?$/i.exec(p)
        if (m && i % 2 === 1)
          return (
            <button key={i} className="text-accent underline" onClick={() => useStore.getState().openFile(m[1], m[2] ? { line: Number(m[2]) } : undefined)}>
              {p}
            </button>
          )
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

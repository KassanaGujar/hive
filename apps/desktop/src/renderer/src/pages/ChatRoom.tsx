import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, History, Plus, RotateCcw } from 'lucide-react'
import { PLAN_SECTIONS } from '@hive/collab'
import { useStore, actorName } from '../store'
import { session } from '../collab/session'
import { reopenThread, startNewThread, threadsOf, type Thread } from '../collab/threads'
import { PlanningRoom } from './PlanningRoom'

/**
 * The Chat page: the group chat with the plan the Planner keeps beside it. Keep one running chat and plan, or put the
 * current one away with "New chat" and pick old ones back up from "Past chats".
 */
export function ChatRoom() {
  const s = session()
  const toast = useStore((st) => st.toast)
  const [threads, setThreads] = useState<Thread[]>([])
  const [viewing, setViewing] = useState<Thread | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!s) return
    const list = threadsOf(s)
    const u = () => setThreads(list.toArray().slice().reverse())
    u()
    list.observe(u)
    return () => list.unobserve(u)
  }, [s])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [menu])

  if (!s) return null

  const newChat = () => {
    const t = startNewThread(s, actorName())
    toast(t ? `Saved "${t.title}" to past chats. New chat started.` : 'This chat is already empty.', t ? 'ok' : 'info')
  }
  const reopen = (t: Thread) => {
    reopenThread(s, t.id, actorName())
    setViewing(null)
    toast(`Picked "${t.title}" back up.`, 'ok')
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
        {viewing ? (
          <>
            <button className="btn" onClick={() => setViewing(null)}>
              <ArrowLeft size={13} /> Current chat
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="display truncate text-[20px] leading-tight">{viewing.title}</h1>
              <div className="text-[12px] text-muted">
                Saved {new Date(viewing.at).toLocaleString()} by {viewing.by}. Read only.
              </div>
            </div>
            <button className="btn-primary" onClick={() => reopen(viewing)}>
              <RotateCcw size={13} /> Pick this back up
            </button>
          </>
        ) : (
          <>
            <h1 className="display flex-1 text-[24px] leading-none">Chat</h1>
            <div className="relative" ref={menuRef}>
              <button className="btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={!threads.length} title={threads.length ? 'Read or reopen an earlier chat and its plan' : 'No past chats yet'}>
                <History size={13} /> Past chats {threads.length ? `(${threads.length})` : ''} <ChevronDown size={12} />
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 z-30 mt-1 max-h-80 w-80 overflow-auto rounded-xl border border-line bg-panel p-1 shadow-[var(--shadow)]">
                  {threads.map((t) => (
                    <button
                      key={t.id}
                      role="menuitem"
                      className="block w-full rounded-lg px-3 py-2 text-left hover:bg-panel2"
                      onClick={() => {
                        setViewing(t)
                        setMenu(false)
                      }}
                    >
                      <div className="truncate text-[13px] font-semibold">{t.title}</div>
                      <div className="text-[11.5px] text-muted">
                        {new Date(t.at).toLocaleDateString()}, {t.chat.length} message{t.chat.length === 1 ? '' : 's'}, {t.plan.length} plan item{t.plan.length === 1 ? '' : 's'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn" onClick={newChat} title="Save this chat and plan to past chats and start fresh">
              <Plus size={13} /> New chat
            </button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1">{viewing ? <ThreadView t={viewing} /> : <PlanningRoom />}</div>
    </div>
  )
}

/** A saved chat and its plan, side by side, read only. */
function ThreadView({ t }: { t: Thread }) {
  return (
    <div className="planning-room flex h-full">
      <div className="planning-chat flex w-[38%] min-w-72 flex-col overflow-auto border-r border-line bg-panel p-3">
        {t.chat.length === 0 && <div className="text-muted">No messages.</div>}
        {t.chat.map((m) => (
          <div key={m.id} className="mb-2">
            <span className="font-semibold">{m.author}</span> <span className="text-[11px] text-muted">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <div className="whitespace-pre-wrap">{m.text}</div>
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-auto px-5 py-4">
        {t.plan.length === 0 && <div className="text-muted">No plan was written for this chat.</div>}
        {PLAN_SECTIONS.map(({ id: section, title: label }) => {
          const items = t.plan.filter((i) => i.section === section)
          if (!items.length) return null
          return (
            <section key={section} className="mb-4">
              <h2 className="mb-1 text-[13px] font-bold">{label}</h2>
              <ul className="list-disc pl-5">
                {items.map((i) => (
                  <li key={i.id}>{i.text}</li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

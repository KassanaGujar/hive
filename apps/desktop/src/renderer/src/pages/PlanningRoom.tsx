import { useEffect, useState } from 'react'
import { Bot, FileDown, Loader2, Plus, RefreshCw, Send, Undo2, X } from 'lucide-react'
import { PLAN_SECTIONS, humanEdit, planToMarkdown, replaceById, type AppliedEdit, type ChatMsg, type PlanItem, type PlanSection, type Proposal } from '@hive/collab'
import { invoke } from '../lib/api'
import { useStore, actorName } from '../store'
import { session } from '../collab/session'
import { ChatChannel } from '../panels/TeamPanel'
import { AUTO_EVERY, resolveProposal, runPlanner, undoPlannerEdit, unreadPlanning } from '../collab/planner'

/** F7: team chat on the left, the living plan doc on the right. */
export function PlanningRoom() {
  const s = session()
  const toast = useStore((st) => st.toast)
  const [items, setItems] = useState<PlanItem[]>([])
  const [log, setLog] = useState<AppliedEdit[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [busy, setBusy] = useState(false)
  const [highlight, setHighlight] = useState<string[]>([])

  useEffect(() => {
    if (!s) return
    const u = () => {
      setItems(s.parts.plan.toArray())
      setLog(s.parts.planLog.toArray())
      setProposals(s.parts.proposals.toArray().filter((p) => p.state === 'open'))
      setChat(s.parts.chat.toArray().filter((m) => m.channel === 'planning'))
    }
    u()
    s.doc.on('update', u)
    return () => s.doc.off('update', u)
  }, [s])

  if (!s) return null

  const update = async () => {
    setBusy(true)
    try {
      const r = await runPlanner(s)
      toast(r.applied || r.proposals ? `Plan updated: ${r.applied} change(s)${r.proposals ? `, ${r.proposals} proposal(s) for human-edited items` : ''}` : 'Nothing new to add.', 'ok')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    setBusy(false)
  }

  // Auto-update every few messages. Only the host (or a solo user) runs it, so the team doesn't
  // trigger several Planners at once.
  const onSend = () => {
    if (s.shared && !s.isHost) return
    if (unreadPlanning(s).length >= AUTO_EVERY) update()
  }

  const sendToAgents = async () => {
    const tasks = items.filter((i) => i.section === 'tasks' && i.status !== 'done')
    const goal = items.find((i) => i.section === 'goal')?.text ?? 'Build what the plan describes'
    if (!tasks.length) return toast('Add some tasks to the plan first.', 'error')
    try {
      await invoke('agents:start', goal, tasks.map((t) => ({ title: t.text, description: [t.owner && `owner: ${t.owner}`].filter(Boolean).join('') })))
      useStore.getState().set({ right: 'agents' })
      toast('Sent to the agents. Approve their plan in the Agents panel.', 'ok')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const exportMd = async () => {
    const name = s.root.split(/[\\/]/).pop() ?? 'Plan'
    await invoke('fs:write', 'PLAN.md', planToMarkdown(items, `${name} — plan`))
    toast('Exported PLAN.md', 'ok')
    useStore.getState().openFile('PLAN.md')
  }

  const add = (section: PlanSection) => {
    const item: PlanItem = { id: `i${Date.now().toString(36)}`, section, text: 'New item', by: actorName(), sources: [], humanEdited: true, at: Date.now(), status: section === 'tasks' ? 'todo' : undefined }
    s.parts.plan.push([item])
  }
  const edit = (item: PlanItem, patch: Partial<Pick<PlanItem, 'text' | 'owner' | 'status'>>) => replaceById(s.parts.plan, item.id, humanEdit(item, patch, actorName()))
  const remove = (item: PlanItem) => replaceById(s.parts.plan, item.id, null)
  const unread = unreadPlanning(s).length

  return (
    <div className="flex h-full">
      <div className="flex w-[38%] min-w-72 flex-col border-r border-line bg-panel">
        <ChatChannel channel="planning" onSend={onSend} />
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-5 py-2 backdrop-blur">
          <div className="flex-1 text-[15px] font-bold">Plan</div>
          <button className="btn" disabled={busy || unread === 0} onClick={update} title="Planner reads new messages and updates the doc">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Update plan {unread ? `(${unread} new)` : ''}
          </button>
          <button className="btn" onClick={exportMd}>
            <FileDown size={12} /> Export PLAN.md
          </button>
          <button className="btn-primary" onClick={sendToAgents}>
            <Send size={12} /> Send to agents
          </button>
        </div>
        <div className="px-5 py-4">
          {proposals.length > 0 && (
            <div className="card mb-4 border-accent/50 p-3">
              <div className="label mb-2">Planner suggestions for items people edited</div>
              {proposals.map((p) => {
                const target = items.find((i) => i.id === p.itemId)
                return (
                  <div key={p.id} className="mb-2 flex items-start gap-2">
                    <div className="flex-1 text-[12px]">
                      {p.op === 'remove' ? 'Remove' : 'Change'} “{target?.text}” {p.op === 'update' && <>→ “{p.text}”</>}
                    </div>
                    <button className="btn" onClick={() => resolveProposal(s, p, true, actorName())}>
                      Accept
                    </button>
                    <button className="btn" onClick={() => resolveProposal(s, p, false, actorName())}>
                      Dismiss
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {PLAN_SECTIONS.map((sec) => (
            <div key={sec.id} className="mb-5">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-[13px] font-bold">{sec.title}</h3>
                <button className="btn-ghost" onClick={() => add(sec.id)} title="Add item">
                  <Plus size={12} />
                </button>
              </div>
              {items.filter((i) => i.section === sec.id).length === 0 && <div className="text-[12px] text-muted italic">empty</div>}
              {items
                .filter((i) => i.section === sec.id)
                .map((i) => (
                  <PlanRow
                    key={i.id}
                    item={i}
                    chat={chat}
                    lastEdit={log.filter((l) => !l.undone && (l.after?.id === i.id || l.before?.id === i.id)).pop()}
                    onEdit={(p) => edit(i, p)}
                    onRemove={() => remove(i)}
                    onUndo={(e) => !undoPlannerEdit(s, e) && toast('Someone edited that item since; undo it by hand.', 'error')}
                    onShowSources={() => setHighlight(i.sources)}
                    highlighted={highlight.length > 0 && i.sources.some((x) => highlight.includes(x))}
                  />
                ))}
            </div>
          ))}
          {log.length > 0 && (
            <details className="mt-6 text-[12px]">
              <summary className="cursor-pointer text-muted">Planner history ({log.length} edits)</summary>
              {[...log].reverse().map((e) => (
                <div key={e.id} className={`flex items-center gap-2 py-0.5 ${e.undone ? 'line-through opacity-50' : ''}`}>
                  <Bot size={11} className="text-accent" />
                  <span className="flex-1 truncate">
                    {e.op} “{(e.after ?? e.before)?.text}” · from {e.sources.length} message(s)
                  </span>
                  {!e.undone && (
                    <button className="btn-ghost" onClick={() => !undoPlannerEdit(s, e) && toast('Someone edited that item since; undo it by hand.', 'error')}>
                      <Undo2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

function PlanRow(p: {
  item: PlanItem
  chat: ChatMsg[]
  lastEdit?: AppliedEdit
  onEdit: (patch: Partial<Pick<PlanItem, 'text' | 'owner' | 'status'>>) => void
  onRemove: () => void
  onUndo: (e: AppliedEdit) => void
  onShowSources: () => void
  highlighted: boolean
}) {
  const { item } = p
  const [text, setText] = useState(item.text)
  useEffect(() => setText(item.text), [item.text])
  const sources = p.chat.filter((m) => item.sources.includes(m.id))
  return (
    <div className={`group mb-1 flex items-start gap-2 rounded-md px-2 py-1 ${p.highlighted ? 'bg-accent/10' : 'hover:bg-panel'}`}>
      {item.section === 'tasks' && (
        <select className="input w-20 text-[11px]" value={item.status ?? 'todo'} onChange={(e) => p.onEdit({ status: e.target.value as PlanItem['status'] })}>
          <option value="todo">todo</option>
          <option value="doing">doing</option>
          <option value="done">done</option>
        </select>
      )}
      <div className="min-w-0 flex-1">
        <input
          className="w-full bg-transparent text-[13px] outline-none focus:rounded focus:bg-panel2 focus:px-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== item.text && p.onEdit({ text })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-muted">
          {item.by === 'ai' ? (
            <span className="flex items-center gap-1 text-accent">
              <Bot size={10} /> Planner{item.humanEdited ? ' · edited by a person' : ''}
            </span>
          ) : (
            <span>by {item.by}</span>
          )}
          {sources.length > 0 && (
            <button className="underline" onClick={p.onShowSources} title={sources.map((m) => `${m.author}: ${m.text}`).join('\n')}>
              from {sources.map((m) => m.author).filter((v, i, a) => a.indexOf(v) === i).join(', ')} ({sources.length} msg)
            </button>
          )}
          {(item.section === 'tasks' || item.section === 'who') && (
            <input className="w-24 bg-transparent outline-none placeholder:text-muted/60" placeholder="owner" defaultValue={item.owner ?? ''} onBlur={(e) => e.target.value !== (item.owner ?? '') && p.onEdit({ owner: e.target.value })} />
          )}
        </div>
      </div>
      {p.lastEdit && !item.humanEdited && (
        <button className="btn-ghost opacity-0 group-hover:opacity-100" title="Undo the Planner's edit" onClick={() => p.onUndo(p.lastEdit!)}>
          <Undo2 size={12} />
        </button>
      )}
      <button className="btn-ghost opacity-0 group-hover:opacity-100" title="Remove" onClick={p.onRemove}>
        <X size={12} />
      </button>
    </div>
  )
}

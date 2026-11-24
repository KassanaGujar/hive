import { setArray, type ChatMsg, type PlanItem } from '@hive/collab'
import type { ProjectSession } from './session'

/** A finished chat and its plan, kept so it can be read again or picked back up. Shared with the whole team. */
export interface Thread {
  id: string
  title: string
  at: number
  by: string
  chat: ChatMsg[]
  plan: PlanItem[]
}

const GROUP = (m: ChatMsg) => m.channel === 'planning' || m.channel === 'project'

export const threadsOf = (s: ProjectSession) => s.doc.getArray<Thread>('threads')

/** Name a thread by its goal, else its first message. */
export function threadTitle(chat: ChatMsg[], plan: PlanItem[]): string {
  const goal = plan.find((i) => i.section === 'goal')?.text
  const first = chat[0]?.text
  const t = (goal ?? first ?? 'Untitled').replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 57) + '…' : t
}

/** Put the current group chat and plan away and start both empty. Does nothing when both are already empty. */
export function startNewThread(s: ProjectSession, by: string): Thread | null {
  const chat = s.parts.chat.toArray().filter(GROUP)
  const plan = s.parts.plan.toArray()
  if (!chat.length && !plan.length) return null
  const thread: Thread = { id: `t${Date.now().toString(36)}`, title: threadTitle(chat, plan), at: Date.now(), by, chat, plan }
  s.doc.transact(() => {
    threadsOf(s).push([thread])
    setArray(s.parts.chat, s.parts.chat.toArray().filter((m) => !GROUP(m)))
    setArray(s.parts.plan, [])
    s.parts.plannerCursor.set('at', Date.now())
  })
  return thread
}

/** Pick an old thread back up: the current one is put away first (if it has anything), then the old one returns. */
export function reopenThread(s: ProjectSession, id: string, by: string) {
  const list = threadsOf(s)
  const idx = list.toArray().findIndex((t) => t.id === id)
  if (idx < 0) return
  const old = list.get(idx)
  s.doc.transact(() => {
    startNewThread(s, by)
    const at = list.toArray().findIndex((t) => t.id === id)
    if (at >= 0) list.delete(at, 1)
    setArray(s.parts.chat, [...s.parts.chat.toArray(), ...old.chat])
    setArray(s.parts.plan, old.plan)
    // everything in it was already planned from
    s.parts.plannerCursor.set('at', Math.max(0, ...old.chat.map((m) => m.at)))
  })
}

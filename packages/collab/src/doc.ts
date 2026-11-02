import * as Y from 'yjs'
import type { FeedEvent } from '@hive/shared'
import type { AppliedEdit, PlanItem, Proposal } from './plan'

export interface ChatMsg {
  id: string
  at: number
  author: string
  color: string
  text: string
  /** 'project' channel or 'planning' room */
  channel: 'project' | 'planning'
  syncedLate?: boolean
}

export interface ProjectMeta {
  name: string
  hostId: string
  createdAt: number
}

/** Every shared piece of a project lives in one Y.Doc. */
export function docParts(doc: Y.Doc) {
  return {
    meta: doc.getMap<unknown>('meta'),
    /** path → Y.Text for every shared text file */
    files: doc.getMap<Y.Text>('files'),
    /** path → sha256 of content, for the join-time hash check */
    hashes: doc.getMap<string>('hashes'),
    chat: doc.getArray<ChatMsg>('chat'),
    plan: doc.getArray<PlanItem>('plan'),
    planLog: doc.getArray<AppliedEdit>('planLog'),
    proposals: doc.getArray<Proposal>('proposals'),
    /** chat ids the Planner has already read */
    plannerCursor: doc.getMap<number>('plannerCursor'),
    feed: doc.getArray<FeedEvent>('feed'),
    /** terminal output mirror: terminal id → recent text */
    terminals: doc.getMap<string>('terminals')
  }
}

export const MAX_SHARED_FILE_BYTES = 512 * 1024
export const MAX_FEED = 1000

/** Replace the full content of a Y.Text with a minimal splice (keeps others' cursors stable). */
export function setText(ytext: Y.Text, next: string) {
  const prev = ytext.toString()
  if (prev === next) return
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  ytext.doc!.transact(() => {
    if (endPrev > start) ytext.delete(start, endPrev - start)
    if (endNext > start) ytext.insert(start, next.slice(start, endNext))
  })
}

/** Replace a whole array item by id (Yjs arrays hold immutable JSON values). */
export function replaceById<T extends { id: string }>(arr: Y.Array<T>, id: string, next: T | null) {
  const idx = arr.toArray().findIndex((x) => x.id === id)
  if (idx < 0) return
  arr.doc!.transact(() => {
    arr.delete(idx, 1)
    if (next) arr.insert(idx, [next])
  })
}

export function setArray<T>(arr: Y.Array<T>, items: T[]) {
  arr.doc!.transact(() => {
    arr.delete(0, arr.length)
    arr.insert(0, items)
  })
}

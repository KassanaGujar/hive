import { diffArrays } from 'diff'
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

/** Line changes from a → b, as replacements of base line ranges [start, end). */
function lineChanges(a: string[], b: string[]) {
  const out: { start: number; end: number; lines: string[] }[] = []
  let i = 0
  for (const part of diffArrays(a, b)) {
    if (part.added) {
      const last = out[out.length - 1]
      if (last && last.end === i) last.lines.push(...part.value)
      else out.push({ start: i, end: i, lines: [...part.value] })
    } else if (part.removed) {
      const last = out[out.length - 1]
      if (last && last.end === i) last.end += part.count ?? part.value.length
      else out.push({ start: i, end: i + (part.count ?? part.value.length), lines: [] })
      i += part.count ?? part.value.length
    } else i += part.count ?? part.value.length
  }
  return out
}

/**
 * Apply the change base → proposed on top of current: a line-based 3-way merge for AI proposals made
 * against an older copy. Returns the merged text, or false when both sides changed the same lines.
 */
export function applyChangeOnto(base: string, proposed: string, current: string): string | false {
  if (current === base) return proposed
  if (current === proposed || base === proposed) return current
  const B = base.split('\n')
  const mine = lineChanges(B, proposed.split('\n'))
  const theirs = lineChanges(B, current.split('\n'))
  // conflict: ranges overlap, or both insert at the same spot
  for (const x of mine)
    for (const y of theirs) {
      const overlap = x.start < y.end && y.start < x.end
      const sameInsert = x.start === x.end && y.start === y.end && x.start === y.start
      const insertInside = (x.start === x.end && x.start > y.start && x.start < y.end) || (y.start === y.end && y.start > x.start && y.start < x.end)
      if (overlap || sameInsert || insertInside) return false
    }
  const all = [...mine, ...theirs].sort((p, q) => p.start - q.start || p.end - q.end)
  const out: string[] = []
  let i = 0
  for (const c of all) {
    out.push(...B.slice(i, c.start), ...c.lines)
    i = Math.max(i, c.end)
  }
  out.push(...B.slice(i))
  return out.join('\n')
}

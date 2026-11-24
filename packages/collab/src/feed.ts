import { createTwoFilesPatch } from 'diff'
import type { FeedEvent, FeedKind } from '@hive/shared'

export const MAX_DIFF_CHARS = 4000
export const COALESCE_MS = 60_000

export function diffPreview(path: string, before: string, after: string): string {
  const patch = createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, '', '', { context: 2 })
  // drop the "Index/===" header lines createTwoFilesPatch adds
  const body = patch.split('\n').filter((l) => !l.startsWith('====') && !l.startsWith('Index:')).join('\n')
  return body.length > MAX_DIFF_CHARS ? body.slice(0, MAX_DIFF_CHARS) + '\n… (diff truncated)' : body
}

export function makeFeedEvent(p: {
  actor: string
  actorType?: FeedEvent['actorType']
  kind: FeedKind
  files?: string[]
  summary?: string
  diff?: string
  syncedLate?: boolean
  at?: number
}): FeedEvent {
  return {
    id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    at: p.at ?? Date.now(),
    actor: p.actor,
    actorType: p.actorType ?? 'person',
    kind: p.kind,
    files: p.files ?? [],
    summary: p.summary ?? defaultSummary(p.kind, p.files ?? []),
    diff: p.diff,
    syncedLate: p.syncedLate || undefined
  }
}

function defaultSummary(kind: FeedKind, files: string[]): string {
  const f = files[0] ?? ''
  switch (kind) {
    case 'file.created': return `created ${f}`
    case 'file.edited': return `edited ${f}`
    case 'file.renamed': return `renamed ${files[0]} → ${files[1]}`
    case 'file.deleted': return `deleted ${f}`
    case 'git.commit': return 'committed'
    case 'agent.merge': return 'merged agent work'
    case 'agent.task': return 'started a task'
    case 'run.started': return 'started the app'
    case 'run.failed': return 'run failed'
    case 'run.stopped': return 'stopped the app'
    case 'member.joined': return 'joined'
    case 'member.left': return 'left'
    case 'plan.updated': return 'updated the plan'
  }
}

/**
 * Typing produces many edits; fold consecutive edits of the same file by the same actor within
 * a minute into one feed entry. Returns true when `ev` should replace `last` instead of appending.
 */
export function shouldCoalesce(last: FeedEvent | undefined, ev: FeedEvent): boolean {
  return (
    !!last &&
    last.kind === 'file.edited' &&
    ev.kind === 'file.edited' &&
    last.actor === ev.actor &&
    last.files[0] === ev.files[0] &&
    ev.at - last.at < COALESCE_MS
  )
}


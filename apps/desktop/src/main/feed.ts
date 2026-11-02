import { makeFeedEvent } from '@hive/collab'
import type { FeedEvent } from '@hive/shared'
import { emit } from './ipc'
import { currentProject } from './project'
import { store } from './store'

/** Record an event that happened in the main process (run, agent merge, …) and tell the renderer. */
export function recordFeed(p: Parameters<typeof makeFeedEvent>[0]): FeedEvent {
  const ev = makeFeedEvent(p)
  const project = currentProject()
  if (project) store.feedAdd(project, ev)
  emit('feed:event', ev)
  return ev
}

export function addFeed(ev: FeedEvent) {
  const project = currentProject()
  if (project) store.feedAdd(project, ev)
}

export function listFeed(limit = 200) {
  const project = currentProject()
  return project ? store.feedList(project, limit) : []
}

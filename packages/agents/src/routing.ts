import type { InstalledModel } from '@hive/shared'
import type { ModelCapacity } from '@hive/models'
import { fits, type TaskSize } from './sizing'

export interface PoolWorker {
  name: string
  model: InstalledModel
  busy: boolean
}

export type Pick = { worker: PoolWorker; reason: string } | { wait: true; reason: string }

/**
 * The cheapest free worker whose model can do the task. Strong models stay free for big tasks; on a small GPU the
 * local model already in memory beats swapping in another (swaps took most of a 184-minute local Snake run).
 * Never deadlocks: if no model on the team can do the task, the strongest free one gets it and the reason says so.
 */
export function pickWorker(
  size: TaskSize,
  pool: PoolWorker[],
  cap: (m: InstalledModel) => ModelCapacity,
  opts: { loadedLocal?: string; prefer?: string } = {}
): Pick {
  const able = pool.filter((w) => fits(size, cap(w.model)))
  const free = able.filter((w) => !w.busy)
  const preferred = free.find((w) => w.name === opts.prefer)
  if (preferred) return { worker: preferred, reason: '' }
  if (free.length) {
    const rank = (w: PoolWorker) => [
      cap(w.model).skill,
      w.model.source === 'ollama' && w.model.model === opts.loadedLocal ? 0 : 1,
      w.model.source === 'ollama' ? 1 : 0
    ]
    const best = [...free].sort((a, b) => {
      const x = rank(a)
      const y = rank(b)
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
    })[0]
    return { worker: best, reason: '' }
  }
  if (able.length) return { wait: true, reason: `waiting for ${able.map((w) => w.name).join(' or ')}, the only model(s) that can do it` }
  // Nothing fits: the strongest model is the best bet (it frees up, so waiting for it cannot deadlock).
  const top = Math.max(...pool.map((w) => cap(w.model).skill))
  const strongest = pool.find((w) => !w.busy && cap(w.model).skill === top)
  if (!strongest) return { wait: true, reason: 'waiting for the strongest model (no model on the team is big enough for this task)' }
  return { worker: strongest, reason: 'no model on the team is big enough for this task; using the strongest one' }
}

import type { InstalledModel } from '@hive/shared'

/**
 * Limits how many local model calls run at once so several models don't exhaust RAM/VRAM.
 * Each local model "costs" its size in GB; the budget comes from free memory. Calls to the same
 * model share one loaded copy, so they only pay once. Hosted models cost nothing.
 * A model bigger than the whole budget may still run, alone.
 */
export class ResourceGuard {
  private loaded = new Map<string, { gb: number; users: number }>()
  private queue: { model: InstalledModel; resolve: () => void; signal?: AbortSignal }[] = []
  /** Calls to one model run one-at-a-time-ish: Ollama queues beyond its own parallel limit. */
  maxPerModel = 2

  constructor(private budgetGB: () => number) {}

  private cost(m: InstalledModel) {
    return m.source === 'ollama' ? Math.max(m.sizeGB, 0.5) * 1.2 : 0
  }

  private usedGB() {
    let n = 0
    for (const v of this.loaded.values()) n += v.gb
    return n
  }

  canRun(m: InstalledModel): boolean {
    if (m.source !== 'ollama') return true
    const cur = this.loaded.get(m.model)
    if (cur) return cur.users < this.maxPerModel
    if (this.loaded.size === 0) return true // always allow one model alone
    return this.usedGB() + this.cost(m) <= this.budgetGB()
  }

  acquire(m: InstalledModel, signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        if (m.source === 'ollama') {
          const cur = this.loaded.get(m.model) ?? { gb: this.cost(m), users: 0 }
          cur.users++
          this.loaded.set(m.model, cur)
        }
        let released = false
        resolve(() => {
          if (released) return
          released = true
          const cur = this.loaded.get(m.model)
          if (cur && --cur.users <= 0) this.loaded.delete(m.model)
          this.drain()
        })
      }
      if (signal?.aborted) return reject(new Error('Run stopped'))
      if (this.canRun(m) && this.queue.length === 0) return grant()
      this.queue.push({ model: m, resolve: grant, signal })
      signal?.addEventListener('abort', () => {
        const i = this.queue.findIndex((q) => q.resolve === grant)
        if (i >= 0) {
          this.queue.splice(i, 1)
          reject(new Error('Run stopped'))
        }
      })
    })
  }

  private drain() {
    for (let i = 0; i < this.queue.length; ) {
      const q = this.queue[i]
      if (this.canRun(q.model)) {
        this.queue.splice(i, 1)
        q.resolve()
      } else i++
    }
  }

  get waiting() {
    return this.queue.length
  }
}

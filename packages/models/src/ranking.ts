import type { InstalledModel, Tier } from '@hive/shared'

const TIER_RANK: Record<Tier, number> = { top: 3, lead: 2, worker: 1 }

export interface Team {
  architect?: InstalledModel
  leads: InstalledModel[]
  workers: InstalledModel[]
}

export function effectiveTier(m: InstalledModel, overrides: Record<string, Tier> = {}): Tier {
  return overrides[m.id] ?? m.tier
}

/** Sort strongest first: tier, then coding score, then bigger context. */
export function sortByStrength(models: InstalledModel[], overrides: Record<string, Tier> = {}) {
  return [...models].sort(
    (a, b) =>
      TIER_RANK[effectiveTier(b, overrides)] - TIER_RANK[effectiveTier(a, overrides)] ||
      b.codingScore - a.codingScore ||
      b.contextTokens - a.contextTokens ||
      a.name.localeCompare(b.name)
  )
}

/**
 * Highest model becomes Architect. Models whose (effective) tier is top/lead become Leads, the
 * rest Workers. With fewer models the same model fills several roles; with one model it plays
 * every role.
 */
export function rankTeam(models: InstalledModel[], overrides: Record<string, Tier> = {}): Team {
  const sorted = sortByStrength(models, overrides)
  if (sorted.length === 0) return { leads: [], workers: [] }
  const [architect, ...rest] = sorted
  let leads = rest.filter((m) => effectiveTier(m, overrides) !== 'worker')
  let workers = rest.filter((m) => effectiveTier(m, overrides) === 'worker')
  if (leads.length === 0) leads = [architect]
  if (workers.length === 0) workers = rest.length ? [rest[rest.length - 1]] : [architect]
  return { architect, leads, workers }
}

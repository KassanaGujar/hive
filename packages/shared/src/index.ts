export * from './types'
export * from './ipc'

export const DEFAULT_RELAY_URL = 'wss://hive-relay.kassanagujar.workers.dev'
export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/KassanaGujar/hive/main/catalog/catalog.json'

export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

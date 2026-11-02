export * from './types'
export * from './ipc'

export const DEFAULT_RELAY_URL = 'ws://localhost:4455'
export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/Beanman/hive/main/catalog/catalog.json'

export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

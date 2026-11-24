import type { HiveBridge } from '@hive/shared'

declare global {
  interface Window {
    hive: HiveBridge
  }
}

export const api = window.hive

export const invoke: HiveBridge['invoke'] = (channel, ...args) => window.hive.invoke(channel, ...args)
export const on: HiveBridge['on'] = (event, cb) => window.hive.on(event, cb)

export function timeAgo(at: number) {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(at).toLocaleDateString()
}

export function fmtGB(gb: number) {
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(gb * 1024)} MB`
}

export function fmtBytes(b: number) {
  return fmtGB(b / 1024 ** 3)
}

export const COLORS = ['#f5b400', '#3ccf7a', '#5aa9ff', '#ff6b8b', '#b98cff', '#ff9f43', '#2ed1c4', '#e86bff']
/** Badge ids (see components/Avatar): drawn icons, never emoji. */
export const AVATARS = ['zap', 'rocket', 'leaf', 'flame', 'star', 'code', 'compass', 'anchor', 'feather', 'mountain', 'music', 'hexagon']

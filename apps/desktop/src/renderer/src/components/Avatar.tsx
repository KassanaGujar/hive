import { Anchor, Code2, Compass, Feather, Flame, Hexagon, Leaf, Mountain, Music, Rocket, Star, Zap, type LucideIcon } from 'lucide-react'

/** Badge icons a person can pick (stored as the id in profile.avatar). No emoji: drawn icons only. */
export const BADGES: Record<string, LucideIcon> = { zap: Zap, rocket: Rocket, leaf: Leaf, flame: Flame, star: Star, code: Code2, compass: Compass, anchor: Anchor, feather: Feather, mountain: Mountain, music: Music, hexagon: Hexagon }
export const BADGE_IDS = Object.keys(BADGES)

const HEX = '50,3 94,27.5 94,76.5 50,101 6,76.5 6,27.5'

/**
 * A person's badge: a hexagon in their cursor colour holding their icon. Profiles saved before badges existed hold an
 * emoji; those show the person's initial instead.
 */
export function Avatar({ name, color, avatar, size = 20, title }: { name?: string; color?: string; avatar?: string; size?: number; title?: string }) {
  const Icon = avatar ? BADGES[avatar] : undefined
  const fill = color || 'var(--accent)'
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size * 1.04 }} title={title ?? name} aria-label={title ?? name} role="img">
      <svg viewBox="0 0 100 104" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <polygon points={HEX} fill={fill} />
      </svg>
      {Icon ? (
        <Icon size={Math.round(size * 0.52)} strokeWidth={2.4} className="relative" style={{ color: '#05070c' }} />
      ) : (
        <span className="display relative leading-none" style={{ color: '#05070c', fontSize: Math.round(size * 0.5) }}>
          {initial}
        </span>
      )}
    </span>
  )
}

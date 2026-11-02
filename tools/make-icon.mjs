// Generates the Hive honeycomb clipart icon: build/icon.svg + icon.png (1024) + site favicon.
import { writeFileSync, mkdirSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const S = 1024, R = 150, GAP = 14
const cx = 512, cy = 470
const hex = (x, y, r) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = ((60 * k - 90) * Math.PI) / 180
    return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`
  }).join(' ')

// centre + 6 neighbours (pointy-top grid)
const d = Math.sqrt(3) * R + GAP
const cells = [[0, 0], ...Array.from({ length: 6 }, (_, k) => [d * Math.cos((60 * k * Math.PI) / 180), d * Math.sin((60 * k * Math.PI) / 180)])]
// a couple of cells are "filled with honey", the rest are empty wax
const filled = new Set([0, 1, 3, 5])

let body = ''
cells.forEach(([dx, dy], i) => {
  const x = cx + dx, y = cy + dy
  body += `<polygon points="${hex(x, y, R)}" fill="url(#wax)" stroke="#7a4300" stroke-width="16" stroke-linejoin="round"/>`
  body += `<polygon points="${hex(x, y, R - 30)}" fill="${filled.has(i) ? 'url(#honey)' : 'url(#cellEmpty)'}" stroke="#a85d00" stroke-width="6" stroke-linejoin="round"/>`
  if (filled.has(i)) body += `<ellipse cx="${x - 38}" cy="${y - 52}" rx="34" ry="18" fill="#fff6c8" opacity="0.75" transform="rotate(-30 ${x - 38} ${y - 52})"/>`
})

// honey drip from the bottom cell
const bx = cx + cells[2][0] - 40, by = cy + cells[2][1] + R - 22
const drip = `<path d="M ${bx - 46} ${by} C ${bx - 46} ${by + 40}, ${bx - 18} ${by + 30}, ${bx - 18} ${by + 80} C ${bx - 18} ${by + 128}, ${bx + 30} ${by + 128}, ${bx + 30} ${by + 80} C ${bx + 30} ${by + 40}, ${bx + 52} ${by + 30}, ${bx + 52} ${by} Z" fill="url(#honey)" stroke="#7a4300" stroke-width="10" stroke-linejoin="round"/>
<ellipse cx="${bx - 2}" cy="${by + 92}" rx="9" ry="16" fill="#fff6c8" opacity="0.8"/>`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>
  <linearGradient id="wax" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd54a"/><stop offset="1" stop-color="#f0a400"/></linearGradient>
  <radialGradient id="honey" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="#ffcf3a"/><stop offset="0.6" stop-color="#f29a00"/><stop offset="1" stop-color="#c96a00"/></radialGradient>
  <radialGradient id="cellEmpty" cx="0.5" cy="0.4" r="0.75"><stop offset="0" stop-color="#ffe58a"/><stop offset="1" stop-color="#f5bd2e"/></radialGradient>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#3a2000" flood-opacity="0.35"/></filter>
</defs>
<g filter="url(#shadow)">${body}${drip}</g>
</svg>`

mkdirSync('apps/desktop/build', { recursive: true })
writeFileSync('apps/desktop/build/icon.svg', svg)
const png = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
writeFileSync('apps/desktop/build/icon.png', png(1024))
writeFileSync('apps/desktop/src/renderer/src/assets/icon.png', png(256))
writeFileSync('site/icon.png', png(256))
writeFileSync('site/favicon.png', png(64))
console.log('icons written')

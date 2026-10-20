import type { Map as MapLibreMap } from 'maplibre-gl'

import { ROUTE_COLORS } from './risk'

export const CAUSE_ICONS = {
  wind: 'wind',
  rain: 'rain',
  snow: 'snow',
} as const

export type CauseKind = keyof typeof CAUSE_ICONS

const SIZE = 64

function sdfImage(draw: (ctx: CanvasRenderingContext2D, size: number) => void): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return new ImageData(SIZE, SIZE)
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  draw(ctx, SIZE)
  return ctx.getImageData(0, 0, SIZE, SIZE)
}

function drawArrow(ctx: CanvasRenderingContext2D, size: number) {
  ctx.beginPath()
  ctx.moveTo(size * 0.5, size * 0.08)
  ctx.lineTo(size * 0.88, size * 0.5)
  ctx.lineTo(size * 0.64, size * 0.5)
  ctx.lineTo(size * 0.64, size * 0.92)
  ctx.lineTo(size * 0.36, size * 0.92)
  ctx.lineTo(size * 0.36, size * 0.5)
  ctx.lineTo(size * 0.12, size * 0.5)
  ctx.closePath()
  ctx.fill()
}

function drawDrop(ctx: CanvasRenderingContext2D, size: number) {
  ctx.beginPath()
  ctx.moveTo(size * 0.5, size * 0.1)
  ctx.bezierCurveTo(size * 0.5, size * 0.22, size * 0.16, size * 0.48, size * 0.16, size * 0.64)
  ctx.bezierCurveTo(size * 0.16, size * 0.86, size * 0.31, size * 0.94, size * 0.5, size * 0.94)
  ctx.bezierCurveTo(size * 0.69, size * 0.94, size * 0.84, size * 0.86, size * 0.84, size * 0.64)
  ctx.bezierCurveTo(size * 0.84, size * 0.48, size * 0.5, size * 0.22, size * 0.5, size * 0.1)
  ctx.closePath()
  ctx.fill()
}

function drawFlake(ctx: CanvasRenderingContext2D, size: number) {
  const cx = size / 2
  const cy = size / 2
  ctx.lineWidth = size * 0.09
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 0; i < 6; i += 1) {
    const angle = (i * Math.PI) / 3
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + dx * size * 0.38, cy + dy * size * 0.38)
    ctx.stroke()
    const bx = cx + dx * size * 0.22
    const by = cy + dy * size * 0.22
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + Math.cos(angle + 0.75) * size * 0.14, by + Math.sin(angle + 0.75) * size * 0.14)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + Math.cos(angle - 0.75) * size * 0.14, by + Math.sin(angle - 0.75) * size * 0.14)
    ctx.stroke()
  }
}

const DRAWINGS: Record<CauseKind, (ctx: CanvasRenderingContext2D, size: number) => void> = {
  wind: drawArrow,
  rain: drawDrop,
  snow: drawFlake,
}

/** SDF icons so MapLibre can tint them with `icon-color` (risk colour or white). */
export function registerCauseIcons(map: MapLibreMap) {
  for (const [kind, draw] of Object.entries(DRAWINGS) as Array<[CauseKind, typeof drawArrow]>) {
    const id = CAUSE_ICONS[kind]
    if (map.hasImage(id)) continue
    map.addImage(id, sdfImage(draw), { sdf: true, pixelRatio: 2 })
  }
}

function routeBadgeImage(letter: string, fill: string): ImageData {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new ImageData(size, size)
  ctx.clearRect(0, 0, size, size)
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = size * 0.08
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${size * 0.48}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter, size / 2, size / 2 + size * 0.02)
  return ctx.getImageData(0, 0, size, size)
}

const ROUTE_LETTERS = ['A', 'B', 'C'] as const

/** Painted A/B/C discs so route identity stays readable without depending on map fonts. */
export function registerRouteBadges(map: MapLibreMap) {
  ROUTE_LETTERS.forEach((letter, index) => {
    const id = `route-${letter}`
    if (map.hasImage(id)) return
    map.addImage(id, routeBadgeImage(letter, ROUTE_COLORS[index] ?? '#2563eb'), { pixelRatio: 2 })
  })
}

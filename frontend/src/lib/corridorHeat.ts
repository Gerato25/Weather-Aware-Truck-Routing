import type { ExpressionSpecification, FilterSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { Feature, FeatureCollection, Point } from 'geojson'

import type { CorridorResponse, Route } from '../types'

import { RISK_COLORS, type HeatLayers, type HeatMetric } from './risk'

export type OverlayMode = 'all' | 'wind' | 'rain' | 'snow' | 'off'

export const CORRIDOR_SOURCE = 'corridor-hours'
export const CORRIDOR_FILL_LAYER = 'corridor-fill'
export const CORRIDOR_CAUSE_LAYER = 'corridor-cause'
export const WX_FILL_SOURCE = 'wx-fill'
export const WX_FILL_LAYER = 'wx-fill'
export const WX_ARROW_SOURCE = 'wx-arrows'
export const WX_ARROW_LAYER = 'wx-arrows'
export const WX_MASK_SOURCE = 'wx-mask'
export const WX_MASK_LAYER = 'wx-mask'

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] }
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function overlayFromHeatLayers(layers: HeatLayers): OverlayMode {
  if (layers.risk) return 'all'
  if (layers.wind) return 'wind'
  if (layers.rain) return 'rain'
  if (layers.snow) return 'snow'
  return 'off'
}

/** One feature per cell per hour so the slider can `setFilter` instead of reloading. */
export function corridorHourGeoJSON(
  corridor: CorridorResponse | null | undefined,
): FeatureCollection<Point> {
  if (!corridor?.points.length) return EMPTY

  const hours = corridor.hours.length
  const features: Feature<Point>[] = []

  const spread: [number, number][] = [
    [0, 0],
    [0.09, 0.03],
    [-0.09, 0.03],
    [0, -0.08],
  ]

  corridor.points.forEach((coord, index) => {
    for (let hour = 0; hour < hours; hour += 1) {
      const risk = corridor.risk[index]?.[hour]
      const wind = corridor.wind[index]?.[hour]
      const rain = corridor.rain[index]?.[hour]
      const snow = corridor.snow[index]?.[hour]
      const windDir = corridor.wind_dir?.[index]?.[hour]
      const cause = corridor.cause?.[index]?.[hour] ?? ''
      const properties = {
        hour,
        risk: risk == null || !Number.isFinite(risk) ? -1 : risk,
        wind: wind == null || !Number.isFinite(wind) ? 0 : wind,
        rain: rain == null || !Number.isFinite(rain) ? 0 : rain,
        snow: snow == null || !Number.isFinite(snow) ? 0 : snow,
        windDir: windDir == null || !Number.isFinite(windDir) ? 0 : windDir,
        cause,
      }
      const hot =
        properties.risk >= 1 || properties.wind >= 25 || properties.rain >= 0.1 || properties.snow >= 0.5
      const copies = hot ? spread : ([[0, 0]] as [number, number][])
      for (const [dx, dy] of copies) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [coord[0] + dx, coord[1] + dy] },
          properties: {
            ...properties,
            cause: dx === 0 && dy === 0 ? properties.cause : '',
          },
        })
      }
    }
  })

  return { type: 'FeatureCollection', features }
}

export function hourFilter(hour: number): FilterSpecification {
  return ['==', ['get', 'hour'], hour]
}

export function overlayMetric(mode: OverlayMode): 'risk' | 'wind' | 'rain' | 'snow' {
  if (mode === 'wind' || mode === 'rain' || mode === 'snow') return mode
  return 'risk'
}

export function bandFilter(hour: number, mode: OverlayMode): FilterSpecification {
  if (mode === 'off') return ['==', ['get', 'hour'], -1]
  return ['all', ['==', ['get', 'hour'], hour], ['==', ['get', 'metric'], overlayMetric(mode)]]
}

export function bandFillColor(mode: OverlayMode): ExpressionSpecification {
  if (mode === 'rain') {
    return ['match', ['get', 'band'], 1, '#93c5fd', 2, '#3b82f6', 3, '#1d4ed8', 4, '#1e3a8a', '#93c5fd']
  }
  if (mode === 'snow') {
    return ['match', ['get', 'band'], 1, '#c4b5fd', 2, '#a78bfa', 3, '#7c3aed', 4, '#4c1d95', '#c4b5fd']
  }
  if (mode === 'all') {
    return [
      'match',
      ['get', 'band'],
      1,
      RISK_COLORS.MODERATE,
      2,
      RISK_COLORS.HIGH,
      3,
      RISK_COLORS.SEVERE,
      4,
      RISK_COLORS.NO_TRAVEL,
      RISK_COLORS.MODERATE,
    ]
  }
  return ['match', ['get', 'band'], 1, '#facc15', 2, '#fb923c', 3, '#ef4444', 4, '#b91c1c', '#facc15']
}

export function bandFillOpacity(): ExpressionSpecification {
  return ['match', ['get', 'band'], 1, 0.22, 2, 0.3, 3, 0.4, 4, 0.5, 0.28]
}

export function areaFillGeoJSON(corridor: CorridorResponse | null | undefined): FeatureCollection {
  return (corridor?.fill as FeatureCollection | undefined) ?? EMPTY_FC
}

export function areaMaskGeoJSON(corridor: CorridorResponse | null | undefined): FeatureCollection {
  return (corridor?.mask as FeatureCollection | undefined) ?? EMPTY_FC
}

export function areaArrowGeoJSON(corridor: CorridorResponse | null | undefined): FeatureCollection {
  return (corridor?.arrows as FeatureCollection | undefined) ?? EMPTY_FC
}

export function causeFilter(hour: number, mode: OverlayMode): FilterSpecification {
  const atHour: FilterSpecification = ['==', ['get', 'hour'], hour]
  if (mode === 'off') return ['==', ['get', 'hour'], -1]
  if (mode === 'wind') return ['all', atHour, ['>=', ['get', 'wind'], 25]]
  if (mode === 'rain') return ['all', atHour, ['>=', ['get', 'rain'], 0.1]]
  if (mode === 'snow') return ['all', atHour, ['>=', ['get', 'snow'], 0.5]]
  return [
    'all',
    atHour,
    ['>=', ['get', 'risk'], 1],
    ['in', ['get', 'cause'], ['literal', ['wind', 'rain', 'snow']]],
  ]
}

/** Meteorological from-direction plus 180° so the arrow points where the wind is going. */
export const WIND_ICON_ROTATE: ExpressionSpecification = [
  '+',
  ['to-number', ['coalesce', ['get', 'windDir'], 0]],
  180,
]

function pushSeed(seeds: [number, number][], seen: Set<string>, seed: [number, number]) {
  const key = `${seed[0].toFixed(2)},${seed[1].toFixed(2)}`
  if (seen.has(key)) return
  seen.add(key)
  seeds.push(seed)
}

/** Merge every route’s corridor so the heatmap covers A, B, and C at once. */
export function mergeCorridorSeeds(routes: Route[]): [number, number][] {
  const seen = new Set<string>()
  const seeds: [number, number][] = []
  const perRoute = Math.max(20, Math.floor(120 / Math.max(routes.length, 1)))
  for (const route of routes) {
    const src = route.corridor_seeds
    if (!src.length) continue
    const step = Math.max(1, Math.ceil(src.length / perRoute))
    for (let i = 0; i < src.length; i += step) pushSeed(seeds, seen, src[i])
    pushSeed(seeds, seen, src[src.length - 1])
  }
  return seeds
}

export function overlayFillColor(mode: OverlayMode): ExpressionSpecification {
  if (mode === 'wind') {
    return [
      'interpolate',
      ['linear'],
      ['get', 'wind'],
      0,
      'rgba(250,204,21,0)',
      20,
      'rgba(250,204,21,0)',
      25,
      '#facc15',
      35,
      '#fb923c',
      45,
      '#ef4444',
      55,
      '#b91c1c',
    ]
  }
  if (mode === 'rain') {
    return [
      'interpolate',
      ['linear'],
      ['get', 'rain'],
      0,
      'rgba(37,99,235,0)',
      0.04,
      'rgba(37,99,235,0)',
      0.1,
      '#93c5fd',
      0.25,
      '#3b82f6',
      0.5,
      '#1d4ed8',
      1,
      '#1e3a8a',
    ]
  }
  if (mode === 'snow') {
    return [
      'interpolate',
      ['linear'],
      ['get', 'snow'],
      0,
      'rgba(167,139,250,0)',
      0.15,
      'rgba(167,139,250,0)',
      0.5,
      '#c4b5fd',
      1,
      '#a78bfa',
      2,
      '#7c3aed',
      3,
      '#4c1d95',
    ]
  }
  return [
    'case',
    ['<', ['get', 'risk'], 0],
    'rgba(148,163,184,0)',
    ['<', ['get', 'risk'], 1],
    'rgba(34,197,94,0.08)',
    [
      'match',
      ['round', ['get', 'risk']],
      1,
      RISK_COLORS.MODERATE,
      2,
      RISK_COLORS.HIGH,
      3,
      RISK_COLORS.SEVERE,
      4,
      RISK_COLORS.NO_TRAVEL,
      RISK_COLORS.MODERATE,
    ],
  ]
}

export function overlayFillOpacity(mode: OverlayMode): ExpressionSpecification | number {
  if (mode === 'all') {
    return ['case', ['<', ['get', 'risk'], 1], 0.12, 0.62]
  }
  if (mode === 'wind') {
    return ['interpolate', ['linear'], ['get', 'wind'], 20, 0, 25, 0.42, 40, 0.72, 55, 0.8]
  }
  return 0.55
}

/** Kept for older call sites that still key off a metric name. */
export function heatColorExpression(_hour: number, metric: HeatMetric): ExpressionSpecification {
  if (metric === 'risk') return overlayFillColor('all')
  return overlayFillColor(metric)
}

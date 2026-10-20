import type { ExpressionSpecification, FilterSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { Feature, FeatureCollection, Point } from 'geojson'

import type { CorridorResponse } from '../types'

import { RISK_COLORS, type HeatLayers, type HeatMetric } from './risk'

export type OverlayMode = 'all' | 'wind' | 'rain' | 'snow' | 'off'

export const CORRIDOR_SOURCE = 'corridor-hours'
export const CORRIDOR_FILL_LAYER = 'corridor-fill'
export const CORRIDOR_CAUSE_LAYER = 'corridor-cause'

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] }

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

  corridor.points.forEach((coord, index) => {
    for (let hour = 0; hour < hours; hour += 1) {
      const risk = corridor.risk[index]?.[hour]
      const wind = corridor.wind[index]?.[hour]
      const rain = corridor.rain[index]?.[hour]
      const snow = corridor.snow[index]?.[hour]
      const windDir = corridor.wind_dir?.[index]?.[hour]
      const cause = corridor.cause?.[index]?.[hour] ?? ''
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coord },
        properties: {
          hour,
          risk: risk == null || !Number.isFinite(risk) ? -1 : risk,
          wind: wind == null || !Number.isFinite(wind) ? 0 : wind,
          rain: rain == null || !Number.isFinite(rain) ? 0 : rain,
          snow: snow == null || !Number.isFinite(snow) ? 0 : snow,
          windDir: windDir == null || !Number.isFinite(windDir) ? 0 : windDir,
          cause,
        },
      })
    }
  })

  return { type: 'FeatureCollection', features }
}

export function hourFilter(hour: number): FilterSpecification {
  return ['==', ['get', 'hour'], hour]
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

export function overlayFillColor(mode: OverlayMode): ExpressionSpecification {
  if (mode === 'wind') {
    return [
      'interpolate',
      ['linear'],
      ['get', 'wind'],
      0,
      'rgba(14,165,233,0)',
      12,
      'rgba(14,165,233,0)',
      25,
      '#38bdf8',
      35,
      '#0284c7',
      45,
      '#1d4ed8',
      55,
      '#4c1d95',
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
    return ['case', ['<', ['get', 'risk'], 1], 0.12, 0.58]
  }
  return 0.55
}

/** Kept for older call sites that still key off a metric name. */
export function heatColorExpression(_hour: number, metric: HeatMetric): ExpressionSpecification {
  if (metric === 'risk') return overlayFillColor('all')
  return overlayFillColor(metric)
}

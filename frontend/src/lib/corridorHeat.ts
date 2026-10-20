import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { Feature, FeatureCollection, Point } from 'geojson'

import type { CorridorResponse } from '../types'

import { RISK_COLORS, type HeatMetric } from './risk'

/** One interpolated vertex between neighbouring corridor samples. */
const DENSIFY_STEPS = 1
/** Skip pairs farther than ~55 miles so laterals do not stitch across gaps. */
const MAX_STEP_DEG = 0.8

export const HEAT_SOURCE_IDS: Record<HeatMetric, string> = {
  risk: 'heat-risk',
  wind: 'heat-wind',
  rain: 'heat-rain',
  snow: 'heat-snow',
}

export const HEAT_LAYER_IDS: Record<HeatMetric, string> = {
  risk: 'heat-risk-layer',
  wind: 'heat-wind-layer',
  rain: 'heat-rain-layer',
  snow: 'heat-snow-layer',
}

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] }

function hourProps(row: number[]): Record<string, number> {
  const props: Record<string, number> = {}
  for (let hour = 0; hour < row.length; hour += 1) {
    props[`h${hour}`] = row[hour] ?? 0
  }
  return props
}

function lerpProps(
  a: Record<string, number>,
  b: Record<string, number>,
  t: number,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(a)) {
    out[key] = a[key] + ((b[key] ?? a[key]) - a[key]) * t
  }
  return out
}

function tooFar(a: [number, number], b: [number, number]): boolean {
  const dlon = a[0] - b[0]
  const dlat = a[1] - b[1]
  return dlon * dlon + dlat * dlat > MAX_STEP_DEG * MAX_STEP_DEG
}

/** Shift stacked overlays so Risk / Wind / Rain / Snow do not sit on the same pixels. */
const METRIC_OFFSET_DEG: Record<HeatMetric, [number, number]> = {
  risk: [0, 0],
  wind: [0, 0.16],
  rain: [0, -0.16],
  snow: [0.18, 0.06],
}

function offsetCoord(coord: [number, number], metric: HeatMetric): [number, number] {
  const [dlon, dlat] = METRIC_OFFSET_DEG[metric]
  return [coord[0] + dlon, coord[1] + dlat]
}

/** Corridor samples as GeoJSON. Extra vertices are lerped locally so the ribbon looks continuous. */
export function corridorHeatGeoJSON(
  corridor: CorridorResponse | null | undefined,
  metric: HeatMetric,
): FeatureCollection<Point> {
  if (!corridor?.points.length) return EMPTY

  const grid = corridor[metric]
  const samples: { coord: [number, number]; props: Record<string, number> }[] = []

  corridor.points.forEach((coord, index) => {
    samples.push({ coord: offsetCoord(coord, metric), props: hourProps(grid[index] ?? []) })
  })

  const features: Feature<Point>[] = []
  samples.forEach((sample, index) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: sample.coord },
      properties: sample.props,
    })
    const next = samples[index + 1]
    if (!next || tooFar(sample.coord, next.coord)) return
    for (let step = 1; step <= DENSIFY_STEPS; step += 1) {
      const t = step / (DENSIFY_STEPS + 1)
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            sample.coord[0] + (next.coord[0] - sample.coord[0]) * t,
            sample.coord[1] + (next.coord[1] - sample.coord[1]) * t,
          ],
        },
        properties: lerpProps(sample.props, next.props, t),
      })
    }
  })

  return { type: 'FeatureCollection', features }
}

export function heatColorExpression(hour: number, metric: HeatMetric): ExpressionSpecification {
  const value: ExpressionSpecification = ['coalesce', ['get', `h${hour}`], 0]
  if (metric === 'risk') {
    return [
      'case',
      ['<', value, 0.35],
      'rgba(34,197,94,0)',
      [
        'interpolate',
        ['linear'],
        value,
        0.35,
        'rgba(34,197,94,0.35)',
        1,
        RISK_COLORS.MODERATE,
        2,
        RISK_COLORS.HIGH,
        3,
        RISK_COLORS.SEVERE,
        4,
        RISK_COLORS.NO_TRAVEL,
      ],
    ]
  }
  if (metric === 'wind') {
    return [
      'interpolate',
      ['linear'],
      value,
      0,
      'rgba(14,165,233,0)',
      12,
      'rgba(14,165,233,0)',
      20,
      '#38bdf8',
      35,
      '#0284c7',
      45,
      '#1d4ed8',
      55,
      '#4c1d95',
    ]
  }
  if (metric === 'rain') {
    return [
      'interpolate',
      ['linear'],
      value,
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
  return [
    'interpolate',
    ['linear'],
    value,
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

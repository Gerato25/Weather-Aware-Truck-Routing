import { RISK_LEVELS } from './risk'
import type { CorridorResponse, RiskDisplaySlug } from '../types'

export interface CorridorHourStats {
  wind: number | null
  windDir: number | null
  rain: number | null
  snow: number | null
  temp: number | null
  risk: number | null
}

function seriesAt(
  rows: (number | null)[][] | undefined,
  hour: number,
  min = Number.NEGATIVE_INFINITY,
): number[] {
  if (!rows?.length) return []
  const index = Math.max(0, Math.round(hour))
  return rows
    .map((row) => row[index])
    .filter((value): value is number => value != null && Number.isFinite(value) && value >= min)
}

function peak(values: number[]): number | null {
  return values.length ? Math.max(...values) : null
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Worst-case corridor weather at one forecast hour, for the live status readout. */
export function corridorHourStats(
  corridor: CorridorResponse | null,
  hour: number,
): CorridorHourStats | null {
  if (!corridor?.points.length) return null
  return {
    wind: peak(seriesAt(corridor.wind, hour)),
    windDir: mean(seriesAt(corridor.wind_dir, hour)),
    rain: peak(seriesAt(corridor.rain, hour)),
    snow: peak(seriesAt(corridor.snow, hour)),
    temp: mean(seriesAt(corridor.temperature, hour)),
    risk: peak(seriesAt(corridor.risk, hour, 0)),
  }
}

export function levelFromScore(score: number | null | undefined): RiskDisplaySlug {
  if (score == null || !Number.isFinite(score) || score < 0) return 'UNKNOWN'
  const index = Math.max(0, Math.min(RISK_LEVELS.length - 1, Math.round(score)))
  return RISK_LEVELS[index]
}

export function nearestCorridorIndex(
  points: [number, number][],
  lon: number,
  lat: number,
): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i += 1) {
    const dx = points[i][0] - lon
    const dy = points[i][1] - lat
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

function cellAt(
  rows: (number | null)[][] | undefined,
  index: number,
  hour: number,
): number | null {
  const value = rows?.[index]?.[Math.max(0, Math.round(hour))]
  return value == null || !Number.isFinite(value) ? null : value
}

export function corridorRiskAt(
  corridor: CorridorResponse | null,
  lon: number,
  lat: number,
  hour: number,
): RiskDisplaySlug | null {
  if (!corridor?.points.length || !corridor.risk.length) return null
  const index = nearestCorridorIndex(corridor.points, lon, lat)
  return levelFromScore(corridor.risk[index]?.[hour])
}

/** Forecast values at the corridor sample nearest a checkpoint, for one overlay hour. */
export function corridorSampleAt(
  corridor: CorridorResponse | null,
  lon: number,
  lat: number,
  hour: number,
): CorridorHourStats & { level: RiskDisplaySlug; cause: string } | null {
  if (!corridor?.points.length) return null
  const index = nearestCorridorIndex(corridor.points, lon, lat)
  const risk = cellAt(corridor.risk, index, hour)
  const listed = corridor.cause?.[index]?.[Math.max(0, Math.round(hour))]
  return {
    wind: cellAt(corridor.wind, index, hour),
    windDir: cellAt(corridor.wind_dir, index, hour),
    rain: cellAt(corridor.rain, index, hour),
    snow: cellAt(corridor.snow, index, hour),
    temp: cellAt(corridor.temperature, index, hour),
    risk,
    level: levelFromScore(risk),
    cause: listed === 'wind' || listed === 'rain' || listed === 'snow' ? listed : '',
  }
}

export interface CorridorRiskStop {
  t: number
  level: RiskDisplaySlug
}

/** Overlay risk along a single route, origin → destination, at one forecast hour. */
export function corridorRiskStops(
  corridor: CorridorResponse | null,
  hour: number,
  route?: {
    checkpoints: Array<{ lon: number; lat: number; mile: number }>
    summary: { distance_miles: number }
  } | null,
): CorridorRiskStop[] {
  if (route?.checkpoints.length) {
    const total = Math.max(1, route.summary.distance_miles)
    const stops: CorridorRiskStop[] = []
    for (const checkpoint of route.checkpoints) {
      const sample = corridor ? corridorSampleAt(corridor, checkpoint.lon, checkpoint.lat, hour) : null
      const level = sample?.level ?? 'UNKNOWN'
      const t = Math.max(0, Math.min(1, checkpoint.mile / total))
      const prev = stops[stops.length - 1]
      if (prev && prev.level === level) prev.t = t
      else stops.push({ t, level })
    }
    return stops
  }
  if (!corridor?.points.length || !corridor.risk.length) return []
  const last = Math.max(1, corridor.points.length - 1)
  return corridor.points.map((_, index) => ({
    t: index / last,
    level: levelFromScore(corridor.risk[index]?.[hour]),
  }))
}

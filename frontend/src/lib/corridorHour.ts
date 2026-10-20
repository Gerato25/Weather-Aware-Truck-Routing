import { RISK_LEVELS } from './risk'
import type { CorridorResponse, RiskDisplaySlug } from '../types'

export interface CorridorHourStats {
  wind: number | null
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
  return rows
    .map((row) => row[hour])
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

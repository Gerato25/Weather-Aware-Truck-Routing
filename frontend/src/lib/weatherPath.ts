import { formatClock } from './format'
import type { OverlayMode } from './corridorHeat'
import {
  RISK_LABELS,
  classifyRain,
  classifySnow,
  classifyWind,
  valueToMetricScore,
} from './risk'
import type { RiskDisplaySlug, Route, WeatherPathSample } from '../types'

export interface WeatherStripSegment {
  start: number
  end: number
  level: WeatherPathSample['level']
  score: number
}

export function collapseWeatherPath(path: WeatherPathSample[] | undefined): WeatherStripSegment[] {
  if (!path?.length) return []
  const segments: WeatherStripSegment[] = []
  let current: WeatherStripSegment = {
    start: path[0].t,
    end: path[0].t,
    level: path[0].level,
    score: path[0].score,
  }
  for (let i = 1; i < path.length; i += 1) {
    const sample = path[i]
    if (sample.level === current.level) {
      current.end = sample.t
      continue
    }
    current.end = sample.t
    segments.push(current)
    current = { start: sample.t, end: sample.t, level: sample.level, score: sample.score }
  }
  segments.push(current)
  return segments
}

export function sampleAtHour(route: Route, hour: number): WeatherPathSample | null {
  const path = route.weather_path
  if (!path?.length) return null
  let chosen = path[0]
  for (const sample of path) {
    if (sample.t <= hour + 1e-6) chosen = sample
    else break
  }
  return chosen
}

export interface LiveStatus {
  arrived: boolean
  level: RiskDisplaySlug
  text: string
  detail: string
}

export function sampleMetricScore(sample: WeatherPathSample, mode: OverlayMode): number {
  if (mode === 'wind') return valueToMetricScore('wind', sample.wind)
  if (mode === 'rain') return valueToMetricScore('rain', sample.rain)
  if (mode === 'snow') return valueToMetricScore('snow', sample.snow)
  return sample.score
}

function metricStatus(sample: WeatherPathSample, mode: OverlayMode): { level: RiskDisplaySlug; text: string } {
  if (mode === 'wind') {
    const value = sample.wind ?? 0
    const level = classifyWind(value)
    return { level, text: `${RISK_LABELS[level]} · ${Math.round(value)} mph` }
  }
  if (mode === 'rain') {
    const value = sample.rain ?? 0
    const level = classifyRain(value)
    return { level, text: `${RISK_LABELS[level]} · ${value.toFixed(2)} in/hr` }
  }
  if (mode === 'snow') {
    const value = sample.snow ?? 0
    const level = classifySnow(value)
    return { level, text: `${RISK_LABELS[level]} · ${value.toFixed(1)} in/hr` }
  }
  const label = RISK_LABELS[sample.level] ?? sample.level
  const details = [`mi ${Math.round(sample.mile)}`]
  if (sample.driver === 'wind' && sample.wind != null) details.push(`wind ${Math.round(sample.wind)} mph`)
  else if (sample.driver === 'rain' && sample.rain != null) details.push(`rain ${sample.rain.toFixed(2)} in/hr`)
  else if (sample.driver === 'snow' && sample.snow != null) details.push(`snow ${sample.snow.toFixed(1)} in/hr`)
  else if (sample.wind != null && sample.wind >= 25) details.push(`wind ${Math.round(sample.wind)} mph`)
  return { level: sample.level, text: `${label} · ${details.join(' · ')}` }
}

export function routeLiveStatus(route: Route, hour: number, mode: OverlayMode = 'all'): LiveStatus {
  const arrived = hour + 1e-6 >= route.summary.duration_hours
  if (arrived) {
    return {
      arrived: true,
      level: 'LOW',
      text: route.summary.arrival ? `Arrived ${formatClock(route.summary.arrival)}` : 'Arrived',
      detail: '',
    }
  }
  const sample = sampleAtHour(route, hour)
  if (!sample) return { arrived: false, level: 'UNKNOWN', text: 'En route', detail: 'En route' }
  const { level, text } = metricStatus(sample, mode)
  return { arrived: false, level, text, detail: text }
}

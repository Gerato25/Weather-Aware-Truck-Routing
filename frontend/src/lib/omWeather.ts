import { addProtocol } from 'maplibre-gl'
import { omProtocol } from '@openmeteo/weather-map-layer'

import type { HeatMetric } from './risk'

const CAPTURE = 'https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/latest.json'

const VARIABLES: Record<HeatMetric, string> = {
  risk: 'temperature_2m',
  wind: 'wind_speed_10m',
  rain: 'precipitation',
  snow: 'snowfall_water_equivalent',
}

export const OM_SOURCE_IDS: Record<HeatMetric, string> = {
  risk: 'om-src-temp',
  wind: 'om-src-wind',
  rain: 'om-src-rain',
  snow: 'om-src-snow',
}

export const OM_LAYER_IDS: Record<HeatMetric, string> = {
  risk: 'om-layer-temp',
  wind: 'om-layer-wind',
  rain: 'om-layer-rain',
  snow: 'om-layer-snow',
}

let protocolReady = false

export function registerOmProtocol() {
  if (protocolReady) return
  addProtocol('om', omProtocol)
  protocolReady = true
}

export function omTileUrl(metric: HeatMetric, timeStep: string): string {
  const params = new URLSearchParams({
    variable: VARIABLES[metric],
    time_step: timeStep,
  })
  return `om://${CAPTURE}?${params.toString()}`
}

export function timeStepForHour(validTimes: string[], hour: number): string {
  if (!validTimes.length) return 'current_time_1H'
  const target = Date.now() + hour * 3_600_000
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  validTimes.forEach((stamp, index) => {
    const dist = Math.abs(new Date(stamp).getTime() - target)
    if (dist < bestDist) {
      best = index
      bestDist = dist
    }
  })
  return `valid_times_${best}`
}

export async function fetchOmValidTimes(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(CAPTURE, { signal })
  if (!response.ok) return []
  const body = (await response.json()) as { valid_times?: string[] }
  return body.valid_times ?? []
}

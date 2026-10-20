import type { Route } from '../types'

/** Where the truck is on a route after this many hours from departure. */
export interface TruckAtHour {
  lon: number
  lat: number
  mile: number
  elapsedMinutes: number
  arrived: boolean
  nearestIndex: number
}

export function truckAtHour(route: Route | null | undefined, hoursFromDeparture: number): TruckAtHour | null {
  if (!route?.checkpoints.length) return null
  const points = route.checkpoints
  const target = Math.max(0, hoursFromDeparture) * 60
  const first = points[0]
  const last = points[points.length - 1]

  if (target <= first.elapsed_minutes) {
    return {
      lon: first.lon,
      lat: first.lat,
      mile: first.mile,
      elapsedMinutes: first.elapsed_minutes,
      arrived: false,
      nearestIndex: first.index,
    }
  }

  if (target >= last.elapsed_minutes) {
    return {
      lon: last.lon,
      lat: last.lat,
      mile: last.mile,
      elapsedMinutes: last.elapsed_minutes,
      arrived: true,
      nearestIndex: last.index,
    }
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    if (target > to.elapsed_minutes) continue
    const span = to.elapsed_minutes - from.elapsed_minutes
    const t = span <= 0 ? 0 : (target - from.elapsed_minutes) / span
    return {
      lon: from.lon + (to.lon - from.lon) * t,
      lat: from.lat + (to.lat - from.lat) * t,
      mile: from.mile + (to.mile - from.mile) * t,
      elapsedMinutes: target,
      arrived: false,
      nearestIndex: t < 0.5 ? from.index : to.index,
    }
  }

  return {
    lon: last.lon,
    lat: last.lat,
    mile: last.mile,
    elapsedMinutes: last.elapsed_minutes,
    arrived: true,
    nearestIndex: last.index,
  }
}

import type { PlanResponse, Route } from '../types'

export interface RouteWeatherStats {
  wind: number
  rain: number
  snow: number
}

export function routeWeatherStats(route: Route): RouteWeatherStats {
  const points = route.checkpoints
  if (!points.length) return { wind: 0, rain: 0, snow: 0 }
  const n = points.length
  return {
    wind: points.reduce((sum, cp) => sum + (cp.weather.wind_mph ?? 0), 0) / n,
    rain: points.reduce((sum, cp) => sum + (cp.weather.rain_in_hr ?? 0), 0) / n,
    snow: points.reduce((sum, cp) => sum + (cp.weather.snow_in_hr ?? 0), 0) / n,
  }
}

const CORRIDOR_NAMES = ['Northern', 'Central', 'Southern']
const ROUTE_LETTERS = ['A', 'B', 'C']

export function corridorName(index: number): string {
  return CORRIDOR_NAMES[index] ?? `Option ${index + 1}`
}

export function routeLetter(index: number): string {
  return ROUTE_LETTERS[index] ?? String(index + 1)
}

/** Unique roles matching the dispatch-card pattern: best / faster / safer. */
export function routeRoles(plan: PlanResponse): Record<string, string> {
  const roles: Record<string, string> = {}
  roles[plan.recommendation.route_id] = 'Balanced & safest'

  const others = plan.routes.filter((route) => route.id !== plan.recommendation.route_id)
  const fastest = [...others].sort((a, b) => a.summary.duration_hours - b.summary.duration_hours)[0]
  if (fastest) roles[fastest.id] = 'Fastest option'

  for (const route of others) {
    if (!roles[route.id]) roles[route.id] = 'Alternative corridor'
  }
  return roles
}

export function routeBadge(role: string, blocked: boolean): { label: string; tone: string } {
  if (blocked) return { label: 'No Travel', tone: 'blocked' }
  if (role === 'Balanced & safest' || role === 'Balanced' || role === 'Best Overall') {
    return { label: 'Recommended', tone: 'safest' }
  }
  if (role === 'Fastest option' || role === 'Faster') return { label: 'Safest', tone: 'ok' }
  return { label: 'Very Good', tone: 'good' }
}

export function routeBlurb(role: string, reasons: string[]): string {
  if (role === 'Balanced' || role === 'Best Overall') {
    return reasons[0] ?? 'Best balance of weather risk and travel time.'
  }
  if (role === 'Faster') return 'Slightly higher weather risk, but faster.'
  if (role === 'Safer Weather') return 'Lowest weather risk, but longer travel time.'
  return reasons[0] ?? ''
}

export function sampleCheckpoints<T>(items: T[], count = 6): T[] {
  if (items.length <= count) return items
  return Array.from({ length: count }, (_, index) => {
    const at = Math.round((index / (count - 1)) * (items.length - 1))
    return items[at]
  })
}

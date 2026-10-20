import { hoursFromNow, toLocalInputValue } from './format'
import type { PlanResponse, RiskDisplaySlug, TripFormValues } from '../types'

const KEY = 'spotter-recent-trips-v1'
const LIMIT = 5

export interface RecentTrip {
  origin: string
  destination: string
  loadLb: number
  intervalMiles: 10 | 25 | 50
  recommended: string
  maxLevel: RiskDisplaySlug
  at: string
}

function asInterval(value: number): 10 | 25 | 50 {
  if (value === 10 || value === 50) return value
  return 25
}

export function readRecentTrips(): RecentTrip[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentTrip[]
    return Array.isArray(parsed) ? parsed.slice(0, LIMIT) : []
  } catch {
    return []
  }
}

export function rememberTrip(plan: PlanResponse): RecentTrip[] {
  const recommended = plan.routes.find((route) => route.id === plan.recommendation.route_id)
  const entry: RecentTrip = {
    origin: plan.request.origin.label,
    destination: plan.request.destination.label,
    loadLb: plan.request.load_lb,
    intervalMiles: asInterval(plan.request.interval_miles),
    recommended: plan.recommendation.label,
    maxLevel: recommended?.summary.max_level ?? 'LOW',
    at: plan.generated_at,
  }

  const next = [entry, ...readRecentTrips().filter((trip) => trip.at !== entry.at)].slice(0, LIMIT)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
  return next
}

export function formFromRecent(trip: RecentTrip): TripFormValues {
  return {
    origin: trip.origin,
    destination: trip.destination,
    originPlace: null,
    destinationPlace: null,
    departure: toLocalInputValue(hoursFromNow(2)),
    loadLb: trip.loadLb,
    intervalMiles: trip.intervalMiles,
    demoLoadWind: false,
  }
}

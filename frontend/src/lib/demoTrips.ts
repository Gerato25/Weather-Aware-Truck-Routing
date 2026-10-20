import { hoursFromNow, toLocalInputValue } from './format'
import type { TripFormValues } from '../types'

/** Chicago–Denver is a long-haul plains corridor (~1,000 mi) with three distinct alternatives. */
export const INITIAL_FORM: TripFormValues = {
  origin: 'Chicago, IL',
  destination: 'Denver, CO',
  originPlace: { label: 'Chicago, IL', lat: 41.8781, lon: -87.6298 },
  destinationPlace: { label: 'Denver, CO', lat: 39.7392, lon: -104.9903 },
  departure: toLocalInputValue(hoursFromNow(2)),
  loadLb: 42_000,
  intervalMiles: 25,
  demoLoadWind: true,
}

export interface DemoTrip {
  id: string
  title: string
  origin: string
  destination: string
  loadLb: number
  intervalMiles: 10 | 25 | 50
  why: string
}

export const DEMO_TRIPS: DemoTrip[] = [
  {
    id: 'chi-den-heavy',
    title: 'Plains haul',
    origin: 'Chicago, IL',
    destination: 'Denver, CO',
    loadLb: 42_000,
    intervalMiles: 25,
    why: 'A ~1,000 mi run where the three corridors often split on rain vs wind.',
  },
  {
    id: 'den-gws-heavy',
    title: 'Mountain haul',
    origin: 'Denver, CO',
    destination: 'Glenwood Springs, CO',
    loadLb: 42_000,
    intervalMiles: 25,
    why: 'Shorter I-70 sample through Eisenhower and Vail when you want a compact mountain overlay.',
  },
  {
    id: 'den-gws-light',
    title: 'Light load',
    origin: 'Denver, CO',
    destination: 'Glenwood Springs, CO',
    loadLb: 15_000,
    intervalMiles: 25,
    why: 'Same mountain corridor at 15,000 lb — wind stays in its weather band instead of escalating.',
  },
]

export function formFromDemo(trip: DemoTrip): TripFormValues {
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

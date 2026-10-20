import { hoursFromNow, toLocalInputValue } from './format'
import type { TripFormValues } from '../types'

/** I-70 over the high Rockies: live 0–48h overlay currently has wind, rain, and snow. */
export const INITIAL_FORM: TripFormValues = {
  origin: 'Denver, CO',
  destination: 'Glenwood Springs, CO',
  originPlace: { label: 'Denver, CO', lat: 39.7392, lon: -104.9903 },
  destinationPlace: { label: 'Glenwood Springs, CO', lat: 39.5505, lon: -107.3248 },
  departure: toLocalInputValue(hoursFromNow(2)),
  loadLb: 42_000,
  intervalMiles: 25,
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
    id: 'den-gws-heavy',
    title: 'Heavy haul',
    origin: 'Denver, CO',
    destination: 'Glenwood Springs, CO',
    loadLb: 42_000,
    intervalMiles: 25,
    why: 'I-70 through Eisenhower and Vail currently carries wind, rain, and snow on the overlay.',
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
  {
    id: 'chi-den-heavy',
    title: 'Plains haul',
    origin: 'Chicago, IL',
    destination: 'Denver, CO',
    loadLb: 42_000,
    intervalMiles: 25,
    why: 'A longer plains run where the three corridors often split on rain vs wind.',
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
  }
}

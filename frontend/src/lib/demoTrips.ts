import { hoursFromNow, toLocalInputValue } from './format'
import type { TripFormValues } from '../types'

/** I-5 / CA-99 / US-101. Leave this evening so the 7h haul crosses live SoCal rain. */
export const INITIAL_FORM: TripFormValues = {
  origin: '',
  destination: '',
  originPlace: null,
  destinationPlace: null,
  departure: toLocalInputValue(hoursFromNow(18)),
  loadLb: 42_000,
  intervalMiles: 25,
  demoLoadWind: false,
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
    id: 'lax-sfo-rain',
    title: 'California haul',
    origin: 'Los Angeles, CA',
    destination: 'San Francisco, CA',
    loadLb: 42_000,
    intervalMiles: 25,
    why: 'I-5, CA-99, and US-101. Depart this evening so rain hits before San Francisco.',
  },
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
    departure: toLocalInputValue(hoursFromNow(trip.origin.includes('Los Angeles') ? 18 : 2)),
    loadLb: trip.loadLb,
    intervalMiles: trip.intervalMiles,
    demoLoadWind: false,
  }
}

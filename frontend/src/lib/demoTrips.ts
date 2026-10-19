import { hoursFromNow, toLocalInputValue } from './format'
import type { TripFormValues } from '../types'

export const INITIAL_FORM: TripFormValues = {
  origin: 'Chicago, IL',
  destination: 'Denver, CO',
  originPlace: null,
  destinationPlace: null,
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
    id: 'chi-den-heavy',
    title: 'Heavy haul',
    origin: 'Chicago, IL',
    destination: 'Denver, CO',
    loadLb: 42_000,
    intervalMiles: 25,
    why: '42,000 lb crosses both load-rule thresholds, so a 35–54 mph stretch can flip the ranking.',
  },
  {
    id: 'chi-den-light',
    title: 'Light load',
    origin: 'Chicago, IL',
    destination: 'Denver, CO',
    loadLb: 15_000,
    intervalMiles: 25,
    why: 'Same corridor at 15,000 lb — wind stays in its weather band instead of escalating.',
  },
  {
    id: 'chi-phl',
    title: 'Lakes to coast',
    origin: 'Chicago, IL',
    destination: 'Philadelphia, PA',
    loadLb: 42_000,
    intervalMiles: 25,
    why: 'A longer eastbound run where the three corridors often split on rain vs wind.',
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

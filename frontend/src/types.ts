/** Mirrors the payloads served by the Django API. */

export type RiskLevelSlug = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' | 'NO_TRAVEL'

export type RiskDriver = 'wind' | 'rain' | 'snow'

export interface Place {
  label: string
  lat: number
  lon: number
}

export interface CheckpointWeather {
  wind_mph: number
  wind_gust_mph: number
  rain_in_hr: number
  snow_in_hr: number
  temperature_f: number | null
  visibility_mi: number | null
  weather_code: number | null
}

export interface CheckpointRisk {
  level: RiskLevelSlug
  label: string
  score: number
  driver: RiskDriver
  wind_used_mph: number
  components: Record<RiskDriver, RiskLevelSlug>
  reasons: string[]
}

export interface Checkpoint {
  index: number
  lat: number
  lon: number
  mile: number
  segment_miles: number
  eta: string
  elapsed_minutes: number
  weather: CheckpointWeather
  risk: CheckpointRisk
}

export interface RouteSummary {
  distance_miles: number
  duration_seconds: number
  duration_hours: number
  arrival: string | null
  checkpoint_count: number
  average_risk: number
  max_level: RiskLevelSlug
  max_level_label: string
  blocked: boolean
  miles_by_level: Record<RiskLevelSlug, number>
}

export interface Route {
  id: string
  label: string
  provider: string
  origin_kind: string
  summary: RouteSummary
  checkpoints: Checkpoint[]
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  corridor_seeds: [number, number][]
}

export interface RankingEntry {
  route_id: string
  label: string
  no_travel_miles: number
  severe_miles: number
  high_miles: number
  average_risk: number
  duration_hours: number
}

export interface PlanResponse {
  generated_at: string
  request: {
    origin: Place
    destination: Place
    departure: string
    load_lb: number
    interval_miles: number
  }
  provider: {
    routing: string
    truck_profile: boolean
    weather: string
    wind_metric: string
  }
  routes: Route[]
  recommendation: {
    route_id: string
    label: string
    reasons: string[]
    ranking: RankingEntry[]
  }
}

export interface CorridorResponse {
  anchor: string
  hours: string[]
  points: [number, number][]
  risk: number[][]
  wind: number[][]
  rain: number[][]
  snow: number[][]
  max_score: number
  load_lb: number
}

export interface WeatherMapResponse {
  anchor: string
  hours: string[]
  points: [number, number][]
  risk: number[][]
  wind: number[][]
  rain: number[][]
  snow: number[][]
  temperature: (number | null)[][]
  max_score: number
  load_lb: number
}

export interface WeatherPointSample {
  at: string
  wind_mph: number
  wind_gust_mph: number
  rain_in_hr: number
  snow_in_hr: number
  temperature_f: number | null
  visibility_mi: number | null
  weather_code: number | null
  risk: number
  humidity_pct: number | null
  dewpoint_f: number | null
  wind_dir_deg: number | null
  wind_dir: string | null
}

export interface WeatherPointResponse {
  lat: number
  lon: number
  hours: string[]
  current: WeatherPointSample | null
  series: WeatherPointSample[]
  load_lb: number
}

export interface TripFormValues {
  origin: string
  destination: string
  originPlace: Place | null
  destinationPlace: Place | null
  departure: string
  loadLb: number
  intervalMiles: 10 | 25 | 50
}

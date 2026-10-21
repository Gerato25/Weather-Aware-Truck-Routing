/** Mirrors the payloads served by the Django API. */

export type RiskLevelSlug = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' | 'NO_TRAVEL'
export type RiskDisplaySlug = RiskLevelSlug | 'UNKNOWN'

export type RiskDriver = 'wind' | 'rain' | 'snow'

export interface Place {
  label: string
  lat: number
  lon: number
}

export interface CheckpointWeather {
  wind_mph: number | null
  wind_gust_mph: number | null
  wind_dir_deg?: number | null
  wind_dir?: string | null
  rain_in_hr: number | null
  snow_in_hr: number | null
  temperature_f: number | null
  visibility_mi: number | null
  weather_code: number | null
  forecast_at?: string | null
}

export interface CheckpointRisk {
  available?: boolean
  level: RiskDisplaySlug
  label: string
  score: number
  driver: RiskDriver | 'none'
  wind_used_mph: number | null
  components: Record<RiskDriver, RiskDisplaySlug>
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
  average_risk: number | null
  max_level: RiskDisplaySlug
  max_level_label: string
  blocked: boolean
  weather_coverage?: number
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
  weather_path?: WeatherPathSample[]
}

export interface WeatherPathSample {
  t: number
  mile: number
  lat: number
  lon: number
  level: RiskDisplaySlug
  score: number
  driver: RiskDriver | 'none'
  wind: number | null
  rain: number | null
  snow: number | null
}

export interface RankingEntry {
  route_id: string
  label: string
  no_travel_miles: number
  severe_miles: number
  high_miles: number
  average_risk: number | null
  duration_hours: number
}

/** Open-Meteo series the server could not fetch (its shared IP was rate-limited). */
export interface WeatherRequest {
  url: string
  points: [number, number][]
  params: Record<string, string>
  batch_size: number
}

/** The browser's own Open-Meteo responses, posted back for scoring. */
export interface OpenMeteoPrefetch {
  points: [number, number][]
  entries: Array<{ hourly: Record<string, unknown> }>
}

export interface PlanResponse {
  generated_at: string
  weather_request?: WeatherRequest | null
  request: {
    origin: Place
    destination: Place
    departure: string
    load_lb: number
    interval_miles: number
    demo_scenario?: '' | 'load_wind'
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

export interface WxFillProperties {
  hour: number
  metric: 'wind' | 'rain' | 'snow' | 'risk'
  band: number
  near: 0 | 1
}

export interface WeatherRaster {
  id: string
  hours: number
  coordinates: [[number, number], [number, number], [number, number], [number, number]]
  url: string
}

export interface CorridorResponse {
  anchor: string
  hours: string[]
  points: [number, number][]
  risk: (number | null)[][]
  cause?: (string | null)[][]
  wind: (number | null)[][]
  wind_dir?: (number | null)[][]
  rain: (number | null)[][]
  snow: (number | null)[][]
  temperature?: (number | null)[][]
  max_score: number
  load_lb: number
  fill?: { type: 'FeatureCollection'; features: Array<{ properties?: WxFillProperties }> }
  arrows?: { type: 'FeatureCollection'; features: Array<{ properties?: { hour: number; windDir: number; wind: number } }> }
  mask?: { type: 'FeatureCollection'; features: Array<Record<string, unknown>> }
  raster?: WeatherRaster
  weather_request?: WeatherRequest | null
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
  demoLoadWind: boolean
}

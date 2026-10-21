import type {
  CorridorResponse,
  OpenMeteoPrefetch,
  Place,
  PlanResponse,
  WeatherMapResponse,
  WeatherPointResponse,
  WeatherRequest,
} from '../types'

// In development Vite proxies /api to the Django server; in production set
// VITE_API_BASE_URL to the deployed API origin.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Pulls a readable message out of a DRF error body. */
function describeError(status: number, body: unknown): string {
  const text = typeof body === 'string' ? body : ''
  if (status === 404 && (/NOT_FOUND/i.test(text) || /page could not be found/i.test(text))) {
    return 'The planning API is not on this Vercel app. Deploy Django (Render) and set VITE_API_BASE_URL to that origin, then rebuild.'
  }
  if (typeof body === 'string' && body.trim() && body.length < 280 && !body.trim().startsWith('<')) {
    if (/daily api request limit|limit exceeded/i.test(body)) {
      return 'Open-Meteo daily limit exceeded. Check Demo weather and Analyze — local storms will run until the quota resets.'
    }
    return body
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.detail === 'string') {
      if (/daily api request limit|limit exceeded/i.test(record.detail)) {
        return 'Open-Meteo daily limit exceeded. Check Demo weather and Analyze — local storms will run until the quota resets.'
      }
      return record.detail
    }

    // Field errors arrive as {"field": ["message", ...]}.
    const parts: string[] = []
    for (const [field, value] of Object.entries(record)) {
      const next = Array.isArray(value) ? value.join(' ') : String(value)
      parts.push(field === 'non_field_errors' ? next : `${field}: ${next}`)
    }
    if (parts.length) return parts.join(' · ')
  }
  // Vite's proxy returns an empty 502 when Django is not listening on :8000.
  if (status === 502 || status === 503 || status === 504) {
    return 'Cannot reach the planning API. Is the backend running?'
  }
  if (status === 404) {
    return 'The planning API returned 404. If this is a Vercel UI deploy, point VITE_API_BASE_URL at your Django host.'
  }
  return `Request failed with status ${status}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError('Cannot reach the planning API. Is the backend running?', 0)
  }

  const text = await response.text()
  const body = text ? safeParse(text) : null

  if (!response.ok) {
    throw new ApiError(describeError(response.status, body), response.status)
  }
  return body as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export interface PlanPayload {
  origin: Place | { query: string }
  destination: Place | { query: string }
  departure: string
  load_lb: number
  interval_miles: number
  demo_scenario?: '' | 'load_wind'
  open_meteo?: OpenMeteoPrefetch
  defer_weather?: boolean
}

// Open-Meteo's free tier rejects overlapping requests from one IP, and the
// plan and heatmap can both ask at once, so browser fetches run one at a time.
let openMeteoQueue: Promise<unknown> = Promise.resolve()

/**
 * Fetch from Open-Meteo in the browser what the server was refused.
 *
 * The free quota is per IP. The server's IP is shared with other Render apps,
 * but the visitor's is not, so this usually gets the same series a local run
 * would. Throws on any failure so callers keep the server's fallback result.
 */
export function fetchOpenMeteoInBrowser(
  wanted: WeatherRequest,
  signal?: AbortSignal,
): Promise<OpenMeteoPrefetch> {
  const run = async (): Promise<OpenMeteoPrefetch> => {
    const entries: OpenMeteoPrefetch['entries'] = []
    const size = Math.max(1, wanted.batch_size)
    for (let start = 0; start < wanted.points.length; start += size) {
      const batch = wanted.points.slice(start, start + size)
      const params = new URLSearchParams({
        ...wanted.params,
        latitude: batch.map(([, lat]) => lat.toFixed(4)).join(','),
        longitude: batch.map(([lon]) => lon.toFixed(4)).join(','),
      })
      const response = await fetch(`${wanted.url}?${params}`, { signal })
      if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`)
      const body: unknown = await response.json()
      const list = (Array.isArray(body) ? body : [body]) as Array<{ hourly?: Record<string, unknown> }>
      if (list.length !== batch.length) throw new Error('Open-Meteo returned the wrong number of series')
      for (const entry of list) entries.push({ hourly: entry.hourly ?? {} })
    }
    return { points: wanted.points, entries }
  }
  const next = openMeteoQueue.then(run, run)
  openMeteoQueue = next.catch(() => undefined)
  return next
}

export function planTrip(payload: PlanPayload, signal?: AbortSignal): Promise<PlanResponse> {
  return request<PlanResponse>('/plan/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function fetchCorridor(
  payload: {
    seeds: [number, number][]
    load_lb: number
    anchor: string
    hours: number
    demo_scenario?: '' | 'load_wind'
    route_lines?: [number, number][][]
    open_meteo?: OpenMeteoPrefetch
    defer_weather?: boolean
  },
  signal?: AbortSignal,
): Promise<CorridorResponse> {
  return request<CorridorResponse>('/corridor/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export async function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, limit: '5' })
  const body = await request<{ results: Place[] }>(`/geocode/?${params}`, { signal })
  return body.results ?? []
}

export function fetchWeatherMap(
  payload: {
    west: number
    south: number
    east: number
    north: number
    hours?: number
    load_lb?: number
    anchor?: string
  },
  signal?: AbortSignal,
): Promise<WeatherMapResponse> {
  return request<WeatherMapResponse>('/weather-map/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function fetchWeatherPoint(
  lat: number,
  lon: number,
  options?: { hours?: number; load_lb?: number },
  signal?: AbortSignal,
): Promise<WeatherPointResponse> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    hours: String(options?.hours ?? 48),
    load_lb: String(options?.load_lb ?? 42_000),
  })
  return request<WeatherPointResponse>(`/weather/point/?${params}`, { signal })
}

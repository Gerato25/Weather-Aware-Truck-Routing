import type {
  CorridorResponse,
  Place,
  PlanResponse,
  WeatherMapResponse,
  WeatherPointResponse,
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
  if (typeof body === 'string' && body.trim()) return body
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record.detail === 'string') return record.detail

    // Field errors arrive as {"field": ["message", ...]}.
    const parts: string[] = []
    for (const [field, value] of Object.entries(record)) {
      const text = Array.isArray(value) ? value.join(' ') : String(value)
      parts.push(field === 'non_field_errors' ? text : `${field}: ${text}`)
    }
    if (parts.length) return parts.join(' · ')
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
}

export function planTrip(payload: PlanPayload, signal?: AbortSignal): Promise<PlanResponse> {
  return request<PlanResponse>('/plan/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function fetchCorridor(
  payload: { seeds: [number, number][]; load_lb: number; anchor: string; hours: number },
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

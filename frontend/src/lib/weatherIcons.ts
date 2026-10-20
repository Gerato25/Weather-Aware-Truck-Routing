import type { Checkpoint } from '../types'

export const WEATHER_ICON_KINDS = [
  'sun',
  'partly',
  'cloud',
  'rain',
  'snow',
  'storm',
  'fog',
  'wind',
  'unknown',
] as const

export type WeatherIconKind = (typeof WEATHER_ICON_KINDS)[number]

export const WEATHER_ICON_LABELS: Record<WeatherIconKind, string> = {
  sun: 'Clear',
  partly: 'Partly cloudy',
  cloud: 'Cloudy',
  rain: 'Rain',
  snow: 'Snow',
  storm: 'Storm',
  fog: 'Fog',
  wind: 'Wind',
  unknown: 'No forecast',
}

export function weatherIconId(kind: WeatherIconKind): string {
  return `wx-${kind}`
}

/** Classify a checkpoint from real forecast fields only. */
export function weatherIconKind(cp: Checkpoint): WeatherIconKind {
  const weather = cp.weather
  if (
    weather.wind_mph == null &&
    weather.rain_in_hr == null &&
    weather.snow_in_hr == null &&
    weather.weather_code == null
  ) {
    return 'unknown'
  }
  if ((weather.snow_in_hr ?? 0) >= 0.5) return 'snow'
  if ((weather.rain_in_hr ?? 0) >= 0.1) return 'rain'
  if ((weather.wind_mph ?? 0) >= 35 || (weather.wind_gust_mph ?? 0) >= 35) return 'wind'

  const code = weather.weather_code
  if (code == null) {
    if ((weather.wind_mph ?? 0) >= 25) return 'wind'
    return 'sun'
  }
  if (code === 0 || code === 1) return 'sun'
  if (code === 2) return 'partly'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 95) return 'storm'
  if (code >= 71 && code <= 86) return 'snow'
  if (code >= 51) return 'rain'
  return 'cloud'
}

type StateBox = { id: string; name: string; minLat: number; maxLat: number; minLon: number; maxLon: number }

const STATE_BOXES: StateBox[] = [
  { id: 'WA', name: 'Washington', minLat: 45.5, maxLat: 49.1, minLon: -124.8, maxLon: -116.9 },
  { id: 'OR', name: 'Oregon', minLat: 41.9, maxLat: 46.3, minLon: -124.6, maxLon: -116.4 },
  { id: 'CA', name: 'California', minLat: 32.5, maxLat: 42.1, minLon: -124.5, maxLon: -114.1 },
  { id: 'ID', name: 'Idaho', minLat: 41.9, maxLat: 49.1, minLon: -117.3, maxLon: -111.0 },
  { id: 'NV', name: 'Nevada', minLat: 35.0, maxLat: 42.1, minLon: -120.1, maxLon: -114.0 },
  { id: 'AZ', name: 'Arizona', minLat: 31.3, maxLat: 37.1, minLon: -114.9, maxLon: -109.0 },
  { id: 'UT', name: 'Utah', minLat: 36.9, maxLat: 42.1, minLon: -114.1, maxLon: -109.0 },
  { id: 'MT', name: 'Montana', minLat: 44.3, maxLat: 49.1, minLon: -116.1, maxLon: -104.0 },
  { id: 'WY', name: 'Wyoming', minLat: 40.9, maxLat: 45.1, minLon: -111.1, maxLon: -104.0 },
  { id: 'CO', name: 'Colorado', minLat: 36.9, maxLat: 41.1, minLon: -109.1, maxLon: -102.0 },
  { id: 'NM', name: 'New Mexico', minLat: 31.3, maxLat: 37.1, minLon: -109.1, maxLon: -103.0 },
  { id: 'ND', name: 'North Dakota', minLat: 45.9, maxLat: 49.1, minLon: -104.1, maxLon: -96.5 },
  { id: 'SD', name: 'South Dakota', minLat: 42.4, maxLat: 46.0, minLon: -104.1, maxLon: -96.4 },
  { id: 'NE', name: 'Nebraska', minLat: 40.0, maxLat: 43.1, minLon: -104.1, maxLon: -95.3 },
  { id: 'KS', name: 'Kansas', minLat: 36.9, maxLat: 40.1, minLon: -102.1, maxLon: -94.6 },
  { id: 'OK', name: 'Oklahoma', minLat: 33.6, maxLat: 37.1, minLon: -103.1, maxLon: -94.4 },
  { id: 'TX', name: 'Texas', minLat: 25.8, maxLat: 36.6, minLon: -106.7, maxLon: -93.5 },
  { id: 'MN', name: 'Minnesota', minLat: 43.4, maxLat: 49.4, minLon: -97.3, maxLon: -89.4 },
  { id: 'IA', name: 'Iowa', minLat: 40.3, maxLat: 43.6, minLon: -96.7, maxLon: -90.1 },
  { id: 'MO', name: 'Missouri', minLat: 36.0, maxLat: 40.7, minLon: -95.8, maxLon: -89.1 },
  { id: 'AR', name: 'Arkansas', minLat: 33.0, maxLat: 36.6, minLon: -94.7, maxLon: -89.6 },
  { id: 'LA', name: 'Louisiana', minLat: 28.9, maxLat: 33.1, minLon: -94.1, maxLon: -88.8 },
  { id: 'WI', name: 'Wisconsin', minLat: 42.4, maxLat: 47.1, minLon: -92.9, maxLon: -86.8 },
  { id: 'IL', name: 'Illinois', minLat: 36.9, maxLat: 42.6, minLon: -91.6, maxLon: -87.0 },
  { id: 'MS', name: 'Mississippi', minLat: 30.1, maxLat: 35.1, minLon: -91.7, maxLon: -88.1 },
  { id: 'MI', name: 'Michigan', minLat: 41.7, maxLat: 48.3, minLon: -90.5, maxLon: -82.1 },
  { id: 'IN', name: 'Indiana', minLat: 37.8, maxLat: 41.8, minLon: -88.1, maxLon: -84.7 },
  { id: 'KY', name: 'Kentucky', minLat: 36.5, maxLat: 39.2, minLon: -89.6, maxLon: -81.9 },
  { id: 'TN', name: 'Tennessee', minLat: 34.9, maxLat: 36.7, minLon: -90.4, maxLon: -81.6 },
  { id: 'AL', name: 'Alabama', minLat: 30.1, maxLat: 35.1, minLon: -88.5, maxLon: -84.8 },
  { id: 'OH', name: 'Ohio', minLat: 38.4, maxLat: 42.0, minLon: -84.9, maxLon: -80.5 },
  { id: 'WV', name: 'West Virginia', minLat: 37.2, maxLat: 40.7, minLon: -82.7, maxLon: -77.7 },
  { id: 'GA', name: 'Georgia', minLat: 30.3, maxLat: 35.1, minLon: -85.7, maxLon: -80.8 },
  { id: 'FL', name: 'Florida', minLat: 24.5, maxLat: 31.1, minLon: -87.7, maxLon: -80.0 },
  { id: 'SC', name: 'South Carolina', minLat: 32.0, maxLat: 35.3, minLon: -83.4, maxLon: -78.5 },
  { id: 'NC', name: 'North Carolina', minLat: 33.8, maxLat: 36.6, minLon: -84.4, maxLon: -75.4 },
  { id: 'VA', name: 'Virginia', minLat: 36.5, maxLat: 39.5, minLon: -83.7, maxLon: -75.2 },
  { id: 'PA', name: 'Pennsylvania', minLat: 39.7, maxLat: 42.3, minLon: -80.6, maxLon: -74.7 },
  { id: 'NY', name: 'New York', minLat: 40.5, maxLat: 45.1, minLon: -79.8, maxLon: -71.8 },
  { id: 'ME', name: 'Maine', minLat: 43.0, maxLat: 47.5, minLon: -71.2, maxLon: -66.9 },
  { id: 'VT', name: 'Vermont', minLat: 42.7, maxLat: 45.1, minLon: -73.5, maxLon: -71.4 },
  { id: 'NH', name: 'New Hampshire', minLat: 42.7, maxLat: 45.4, minLon: -72.6, maxLon: -70.6 },
  { id: 'MA', name: 'Massachusetts', minLat: 41.2, maxLat: 42.9, minLon: -73.6, maxLon: -69.9 },
  { id: 'CT', name: 'Connecticut', minLat: 40.9, maxLat: 42.1, minLon: -73.8, maxLon: -71.8 },
  { id: 'RI', name: 'Rhode Island', minLat: 41.1, maxLat: 42.1, minLon: -71.9, maxLon: -71.1 },
  { id: 'NJ', name: 'New Jersey', minLat: 38.9, maxLat: 41.4, minLon: -75.6, maxLon: -73.8 },
  { id: 'DE', name: 'Delaware', minLat: 38.4, maxLat: 39.9, minLon: -75.8, maxLon: -75.0 },
  { id: 'MD', name: 'Maryland', minLat: 37.8, maxLat: 39.8, minLon: -79.5, maxLon: -75.0 },
  { id: 'DC', name: 'District of Columbia', minLat: 38.8, maxLat: 39.0, minLon: -77.2, maxLon: -76.9 },
]

export function stateForPoint(lat: number, lon: number): { id: string; name: string } | null {
  let match: StateBox | null = null
  let area = Number.POSITIVE_INFINITY
  for (const box of STATE_BOXES) {
    if (lat < box.minLat || lat > box.maxLat || lon < box.minLon || lon > box.maxLon) continue
    const next = (box.maxLat - box.minLat) * (box.maxLon - box.minLon)
    if (next < area) {
      match = box
      area = next
    }
  }
  return match ? { id: match.id, name: match.name } : null
}

export function drawWeatherIcon(kind: WeatherIconKind): ImageData {
  const size = 72
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new ImageData(size, size)

  ctx.clearRect(0, 0, size, size)
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, 32, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#d0d7e2'
  ctx.stroke()

  if (kind === 'sun') drawSun(ctx)
  else if (kind === 'partly') drawPartly(ctx)
  else if (kind === 'cloud') drawCloud(ctx, '#64748b')
  else if (kind === 'rain') drawRain(ctx)
  else if (kind === 'snow') drawSnow(ctx)
  else if (kind === 'storm') drawStorm(ctx)
  else if (kind === 'fog') drawFog(ctx)
  else if (kind === 'wind') drawWind(ctx)
  else drawUnknown(ctx)

  return ctx.getImageData(0, 0, size, size)
}

function drawSun(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#f59e0b'
  ctx.beginPath()
  ctx.arc(36, 36, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4
    ctx.beginPath()
    ctx.moveTo(36 + Math.cos(angle) * 17, 36 + Math.sin(angle) * 17)
    ctx.lineTo(36 + Math.cos(angle) * 24, 36 + Math.sin(angle) * 24)
    ctx.stroke()
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(28, 40, 10, 0, Math.PI * 2)
  ctx.arc(38, 36, 13, 0, Math.PI * 2)
  ctx.arc(48, 41, 9, 0, Math.PI * 2)
  ctx.rect(20, 40, 34, 10)
  ctx.fill()
}

function drawPartly(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#f59e0b'
  ctx.beginPath()
  ctx.arc(26, 26, 9, 0, Math.PI * 2)
  ctx.fill()
  drawCloud(ctx, '#64748b')
}

function drawRain(ctx: CanvasRenderingContext2D) {
  drawCloud(ctx, '#3b82f6')
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ;[26, 36, 46].forEach((x) => {
    ctx.beginPath()
    ctx.moveTo(x, 50)
    ctx.lineTo(x - 3, 60)
    ctx.stroke()
  })
}

function drawSnow(ctx: CanvasRenderingContext2D) {
  drawCloud(ctx, '#7dd3fc')
  ctx.fillStyle = '#0369a1'
  ;[26, 36, 46].forEach((x, index) => {
    ctx.beginPath()
    ctx.arc(x, 54 + (index === 1 ? 4 : 0), 2.4, 0, Math.PI * 2)
    ctx.fill()
  })
}

function drawStorm(ctx: CanvasRenderingContext2D) {
  drawCloud(ctx, '#475569')
  ctx.fillStyle = '#eab308'
  ctx.beginPath()
  ctx.moveTo(40, 46)
  ctx.lineTo(32, 58)
  ctx.lineTo(38, 58)
  ctx.lineTo(34, 68)
  ctx.lineTo(48, 54)
  ctx.lineTo(40, 54)
  ctx.closePath()
  ctx.fill()
}

function drawFog(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ;[28, 36, 44, 52].forEach((y, index) => {
    ctx.beginPath()
    ctx.moveTo(20 + (index % 2) * 4, y)
    ctx.lineTo(52 - (index % 2) * 4, y)
    ctx.stroke()
  })
}

function drawWind(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#0ea5e9'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ;[28, 36, 44].forEach((y, index) => {
    ctx.beginPath()
    ctx.moveTo(18, y)
    ctx.lineTo(46, y)
    ctx.quadraticCurveTo(58, y, 54, y - 8 + index)
    ctx.stroke()
  })
}

function drawUnknown(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#94a3b8'
  ctx.font = '700 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('?', 36, 38)
}

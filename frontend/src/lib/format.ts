/** Display formatting helpers. All API timestamps are ISO 8601 with an offset. */

/** Haul clocks (LA–SF) stay on U.S. Pacific, not the viewer's local zone. */
export const DISPLAY_TIME_ZONE = 'America/Los_Angeles'

function formatInDisplayZone(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString('en-US', { ...options, timeZone: DISPLAY_TIME_ZONE })
}

function zoneParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  const hour = get('hour')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === '24' ? '00' : hour,
    minute: get('minute'),
  }
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return '-'
  const whole = Math.floor(hours)
  const minutes = Math.round((hours - whole) * 60)
  if (minutes === 60) return `${whole + 1}h 00m`
  return `${whole}h ${String(minutes).padStart(2, '0')}m`
}

export function formatClock(iso: string | null): string {
  if (!iso) return '-'
  return formatInDisplayZone(iso, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function formatEta(iso: string | null): string {
  if (!iso) return '—'
  return formatInDisplayZone(iso, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/** Clock time without the zone, for tight tables that put the zone in the header. */
export function formatEtaClock(iso: string | null): string {
  if (!iso) return '—'
  return formatInDisplayZone(iso, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatTimeZoneShort(iso?: string | null): string {
  const stamp = iso ? new Date(iso) : new Date()
  if (Number.isNaN(stamp.getTime())) return ''
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: 'short',
  })
    .formatToParts(stamp)
    .find((item) => item.type === 'timeZoneName')
  return part?.value ?? ''
}

export function formatEtaRelative(iso: string | null, fromIso?: string | null): string | null {
  if (!iso) return null
  const originMs = fromIso ? new Date(fromIso).getTime() : Date.now()
  const minutes = Math.round((new Date(iso).getTime() - originMs) / 60_000)
  if (!Number.isFinite(minutes)) return null
  const fromDeparture = Boolean(fromIso)
  if (minutes <= 0) return fromDeparture ? 'at departure' : 'now'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (fromDeparture) {
    if (hours <= 0) return `${rest}m after departure`
    return `${hours}h ${rest}m after departure`
  }
  if (hours <= 0) return `in ${rest}m`
  return `in ${hours}h ${rest}m`
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  return formatInDisplayZone(iso, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/** Full arrival/forecast stamp with timezone, used on checkpoint details. */
export function formatForecastStamp(iso: string | null): string {
  if (!iso) return '—'
  return formatInDisplayZone(iso, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString()} mi`
}

export function formatRiskScore(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

export function formatWeather(
  value: number | null | undefined,
  digits: number,
  suffix: string,
): string {
  if (value == null || Number.isNaN(value)) return '—'
  const shown = digits === 0 ? String(Math.round(value)) : value.toFixed(digits)
  return `${shown}${suffix}`
}

export function formatPounds(lb: number): string {
  return `${Math.round(lb).toLocaleString()} lb`
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** Eight-point compass for a meteorological wind direction (blows from). */
export function compassFromDeg(degrees: number | null | undefined): string | null {
  if (degrees == null || !Number.isFinite(degrees)) return null
  const wrapped = ((degrees % 360) + 360) % 360
  return COMPASS[Math.round(wrapped / 45) % 8]
}

/** Value for a `datetime-local` input, as U.S. Pacific wall time. */
export function toLocalInputValue(date: Date): string {
  const parts = zoneParts(date)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour.padStart(2, '0')}:${parts.minute}`
}

/** Treats a `datetime-local` value as U.S. Pacific and returns an ISO instant. */
export function fromLocalInputValue(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return new Date(value).toISOString()
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  const shown = zoneParts(new Date(utcGuess))
  const asUtc = Date.UTC(
    Number(shown.year),
    Number(shown.month) - 1,
    Number(shown.day),
    Number(shown.hour),
    Number(shown.minute),
  )
  return new Date(utcGuess - (asUtc - utcGuess)).toISOString()
}

export function hoursFromNow(offset: number): Date {
  return new Date(Date.now() + offset * 3_600_000)
}

/** First clause of a geocoded label, e.g. "Chicago" from "Chicago, IL, USA". */
export function shortPlaceName(label: string): string {
  const piece = label.split(',')[0]?.trim()
  return piece || label
}

/** City and region, e.g. "Chicago, IL" from "Chicago, IL, USA". */
export function cityStateName(label: string): string {
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`
  return parts[0] || label
}

/** WMO weather-code to a compact forecast label. */
export function weatherLabel(code: number | null): string {
  if (code === null) return 'Forecast'
  if (code === 0) return 'Clear'
  if (code === 1) return 'Mostly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Showers'
  if (code >= 85 && code <= 86) return 'Snow showers'
  if (code >= 95) return 'Thunderstorm'
  return 'Forecast'
}

export function weatherGlyph(code: number | null): string {
  if (code === null) return '☁'
  if (code === 0 || code === 1) return '☀'
  if (code === 2) return '⛅'
  if (code === 3) return '☁'
  if (code === 45 || code === 48) return '🌫'
  if (code >= 71 && code <= 77) return '❄'
  if (code >= 85 && code <= 86) return '❄'
  if (code >= 95) return '⛈'
  if (code >= 51) return '🌧'
  return '☁'
}

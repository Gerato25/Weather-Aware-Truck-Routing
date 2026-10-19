/** Display formatting helpers. All API timestamps are ISO 8601 with an offset. */

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return '-'
  const whole = Math.floor(hours)
  const minutes = Math.round((hours - whole) * 60)
  if (minutes === 60) return `${whole + 1}h 00m`
  return `${whole}h ${String(minutes).padStart(2, '0')}m`
}

export function formatClock(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatEta(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString()} mi`
}

export function formatPounds(lb: number): string {
  return `${Math.round(lb).toLocaleString()} lb`
}

/** Value for a `datetime-local` input, which has no timezone and needs minutes. */
export function toLocalInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

/** Converts a `datetime-local` value into an absolute ISO instant. */
export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString()
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

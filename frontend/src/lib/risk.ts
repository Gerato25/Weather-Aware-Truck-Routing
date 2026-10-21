import type { RiskDisplaySlug, RiskLevelSlug } from '../types'

export const RISK_LEVELS: RiskLevelSlug[] = ['LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL']

export const RISK_COLORS: Record<RiskLevelSlug | 'UNKNOWN', string> = {
  LOW: '#22c55e',
  MODERATE: '#facc15',
  HIGH: '#fb923c',
  SEVERE: '#ef4444',
  NO_TRAVEL: '#334155',
  UNKNOWN: '#94a3b8',
}

/** Ink used on white/light surfaces so grade labels stay readable. */
export const RISK_INK: Record<RiskLevelSlug | 'UNKNOWN', string> = {
  LOW: '#22c55e',
  MODERATE: '#ca8a04',
  HIGH: '#ea580c',
  SEVERE: '#ef4444',
  NO_TRAVEL: '#334155',
  UNKNOWN: '#64748b',
}

export const RISK_LABELS: Record<RiskLevelSlug | 'UNKNOWN', string> = {
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
  SEVERE: 'Severe',
  NO_TRAVEL: 'No Travel',
  UNKNOWN: 'Unknown',
}

/** Printed table bands, including the shared rain/snow endpoints. */
export const RISK_THRESHOLDS: Record<RiskLevelSlug, { wind: string; rain: string; snow: string }> = {
  LOW: { wind: '< 25', rain: '< 0.10', snow: '< 0.5' },
  MODERATE: { wind: '25–34', rain: '0.10–0.25', snow: '0.5–1.0' },
  HIGH: { wind: '35–44', rain: '0.25–0.50', snow: '1.0–2.0' },
  SEVERE: { wind: '45–54', rain: '0.50–1.00', snow: '2.0–3.0' },
  NO_TRAVEL: { wind: '≥ 55', rain: '> 1.00', snow: '> 3.0' },
}

export function riskColor(level: RiskDisplaySlug): string {
  return RISK_COLORS[level] ?? RISK_COLORS.UNKNOWN
}

function scoreIndex(score: number): number {
  return Math.max(0, Math.min(RISK_LEVELS.length - 1, Math.round(score)))
}

/** Colour for a continuous average-risk score (0 = Low ... 4 = No Travel). */
export function scoreColor(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score) || score < 0) return RISK_COLORS.UNKNOWN
  return rampColor(score)
}

/** Same green → dark-red ramp the weather PNG uses. */
export const RISK_RAMP: Array<[number, [number, number, number]]> = [
  [0, [34, 197, 94]],
  [1, [250, 204, 21]],
  [2, [251, 146, 60]],
  [3, [239, 68, 68]],
  [4, [127, 29, 29]],
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function enlargeRisk(value: number): number {
  if (value <= 0) return 0
  if (value >= 4) return 4
  const whole = Math.floor(value)
  const frac = value - whole
  const pushed = Math.max(0, Math.min(1, 0.5 + (frac - 0.5) * 1.7))
  return whole + pushed
}

export function rampColor(score: number): string {
  const value = enlargeRisk(Math.max(0, Math.min(4, score)))
  for (let i = 0; i < RISK_RAMP.length - 1; i += 1) {
    const [left, a] = RISK_RAMP[i]
    const [right, b] = RISK_RAMP[i + 1]
    if (value <= right) {
      const t = right === left ? 0 : (value - left) / (right - left)
      const r = Math.round(lerp(a[0], b[0], t))
      const g = Math.round(lerp(a[1], b[1], t))
      const bl = Math.round(lerp(a[2], b[2], t))
      return `rgb(${r}, ${g}, ${bl})`
    }
  }
  const last = RISK_RAMP[RISK_RAMP.length - 1][1]
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`
}

export function scoreLabel(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score) || score < 0) return RISK_LABELS.UNKNOWN
  return RISK_LABELS[RISK_LEVELS[scoreIndex(score)]]
}

/** Route line colours, kept off the risk palette (green / yellow / orange / red). */
export const ROUTE_COLORS = ['#2563eb', '#7c3aed', '#64748b']

export function routeColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length]
}

/** Heatmap metrics the corridor view can display. */
export type HeatMetric = 'risk' | 'wind' | 'rain' | 'snow'

export const HEAT_LAYER_KEYS: HeatMetric[] = ['risk', 'wind', 'rain', 'snow']

export type HeatLayers = Record<HeatMetric, boolean>

export const DEFAULT_HEAT_LAYERS: HeatLayers = {
  risk: true,
  wind: false,
  rain: false,
  snow: false,
}

export const HIDDEN_HEAT_LAYERS: HeatLayers = {
  risk: false,
  wind: false,
  rain: false,
  snow: false,
}

interface MetricConfig {
  key: HeatMetric
  label: string
  unit: string
  /** Value mapped to full heat intensity. */
  max: number
  decimals: number
}

export const HEAT_METRICS: Record<HeatMetric, MetricConfig> = {
  risk: { key: 'risk', label: 'Risk level', unit: '', max: 4, decimals: 0 },
  wind: { key: 'wind', label: 'Wind', unit: 'mph', max: 60, decimals: 0 },
  rain: { key: 'rain', label: 'Rain', unit: 'in/hr', max: 1, decimals: 2 },
  snow: { key: 'snow', label: 'Snow', unit: 'in/hr', max: 3, decimals: 2 },
}

/** Same breakpoints as the backend risk table / weather PNG. */
export const METRIC_SCALES = {
  wind: [0, 25, 35, 45, 55],
  rain: [0, 0.1, 0.25, 0.5, 1],
  snow: [0, 0.5, 1, 2, 3],
} as const

export function classifyWind(mph: number): RiskLevelSlug {
  if (mph < 25) return 'LOW'
  if (mph < 35) return 'MODERATE'
  if (mph < 45) return 'HIGH'
  if (mph < 55) return 'SEVERE'
  return 'NO_TRAVEL'
}

export function classifyRain(inHr: number): RiskLevelSlug {
  if (inHr < 0.1) return 'LOW'
  if (inHr <= 0.25) return 'MODERATE'
  if (inHr <= 0.5) return 'HIGH'
  if (inHr <= 1) return 'SEVERE'
  return 'NO_TRAVEL'
}

export function classifySnow(inHr: number): RiskLevelSlug {
  if (inHr < 0.5) return 'LOW'
  if (inHr <= 1) return 'MODERATE'
  if (inHr <= 2) return 'HIGH'
  if (inHr <= 3) return 'SEVERE'
  return 'NO_TRAVEL'
}

export function valueToMetricScore(metric: Exclude<HeatMetric, 'risk'>, raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0
  const scale = METRIC_SCALES[metric]
  if (raw <= scale[0]) return 0
  if (raw >= scale[scale.length - 1]) return scale.length - 1
  for (let i = 0; i < scale.length - 1; i += 1) {
    const lo = scale[i]
    const hi = scale[i + 1]
    if (raw <= hi) {
      const span = hi - lo || 1
      return i + (raw - lo) / span
    }
  }
  return scale.length - 1
}

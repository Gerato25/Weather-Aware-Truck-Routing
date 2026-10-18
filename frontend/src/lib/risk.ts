import type { RiskLevelSlug } from '../types'

export const RISK_LEVELS: RiskLevelSlug[] = ['LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL']

export const RISK_COLORS: Record<RiskLevelSlug, string> = {
  LOW: '#22c55e',
  MODERATE: '#facc15',
  HIGH: '#fb923c',
  SEVERE: '#ef4444',
  NO_TRAVEL: '#c026d3',
}

export const RISK_LABELS: Record<RiskLevelSlug, string> = {
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
  SEVERE: 'Severe',
  NO_TRAVEL: 'No Travel',
}

export function riskColor(level: RiskLevelSlug): string {
  return RISK_COLORS[level] ?? RISK_COLORS.LOW
}

/** Colour for a continuous average-risk score (0 = Low ... 4 = No Travel). */
export function scoreColor(score: number): string {
  const index = Math.max(0, Math.min(RISK_LEVELS.length - 1, Math.round(score)))
  return RISK_COLORS[RISK_LEVELS[index]]
}

/** Route line colours, kept distinct from the risk palette to avoid confusion. */
export const ROUTE_COLORS = ['#22c55e', '#3b82f6', '#a855f7']

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

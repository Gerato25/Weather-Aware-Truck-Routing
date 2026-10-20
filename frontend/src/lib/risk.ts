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
  return RISK_COLORS[RISK_LEVELS[scoreIndex(score)]]
}

export function scoreLabel(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score) || score < 0) return RISK_LABELS.UNKNOWN
  return RISK_LABELS[RISK_LEVELS[scoreIndex(score)]]
}

/** Route line colours, kept distinct from the risk palette to avoid confusion. */
export const ROUTE_COLORS = ['#2563eb', '#16a34a', '#7c3aed']

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
  rain: true,
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

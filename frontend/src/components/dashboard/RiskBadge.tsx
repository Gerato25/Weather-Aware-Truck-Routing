import { RISK_COLORS, RISK_LABELS } from '../../lib/risk'
import type { RiskDisplaySlug } from '../../types'

const TEXT: Record<RiskDisplaySlug, string> = {
  LOW: '#14532d',
  MODERATE: '#713f12',
  HIGH: '#ffffff',
  SEVERE: '#ffffff',
  NO_TRAVEL: '#ffffff',
  UNKNOWN: '#334155',
}

export function RiskBadge({ level, className = '' }: { level: RiskDisplaySlug; className?: string }) {
  const onDark = level === 'HIGH' || level === 'SEVERE' || level === 'NO_TRAVEL'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${className}`}
      style={{
        color: TEXT[level],
        background: onDark ? RISK_COLORS[level] : `${RISK_COLORS[level]}40`,
      }}
    >
      {RISK_LABELS[level]}
    </span>
  )
}

import { formatDateTime, formatPounds } from '../lib/format'
import type { PlanResponse } from '../types'

interface TripSummaryProps {
  plan: PlanResponse
}

export function TripSummary({ plan }: TripSummaryProps) {
  return (
    <section className="trip-summary">
      <SummaryChip label="Origin" value={plan.request.origin.label} icon="origin" />
      <SummaryChip label="Destination" value={plan.request.destination.label} icon="destination" />
      <SummaryChip
        label="Departure Date & Time"
        value={formatDateTime(plan.request.departure)}
        icon="time"
      />
      <SummaryChip label="Load Weight" value={formatPounds(plan.request.load_lb)} icon="load" />
    </section>
  )
}

function SummaryChip({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: 'origin' | 'destination' | 'time' | 'load'
}) {
  return (
    <div className="trip-chip">
      <span className="field-icon" aria-hidden="true">
        <ChipIcon name={icon} />
      </span>
      <div>
        <span className="metric-label">{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function ChipIcon({ name }: { name: 'origin' | 'destination' | 'time' | 'load' }) {
  if (name === 'origin') {
    return (
      <svg viewBox="0 0 24 24">
        <path
          d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    )
  }
  if (name === 'destination') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M6 21V4h8l-2 4 2 4H8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'time') {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 3v4M16 3v4M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M3 16V8h11l4 4v4H3zM14 8v4h4M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

import { formatDateTime, formatDuration, formatEta, formatMiles } from '../lib/format'
import { routeBadge } from '../lib/routeMeta'
import { scoreColor, routeColor } from '../lib/risk'
import type { Route } from '../types'

interface RouteCardProps {
  route: Route
  index: number
  title: string
  rank?: string
  blurb: string
  selected: boolean
  recommended: boolean
  onSelect: () => void
}

export function RouteCard({
  route,
  index,
  title,
  rank,
  blurb,
  selected,
  recommended,
  onSelect,
}: RouteCardProps) {
  const { summary } = route
  const severe = Math.round(summary.miles_by_level.SEVERE ?? 0)
  const badge = recommended
    ? { label: 'Recommended', tone: 'safest' }
    : routeBadge(rank ?? title, summary.blocked)
  const classes = ['route-card']
  if (selected) classes.push('selected')
  if (recommended) classes.push('featured')

  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={{ '--route-color': routeColor(index) } as React.CSSProperties}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <header className="route-card-head">
        <span className="route-index">{index + 1}</span>
        <span className="route-name">
          Route {index + 1} – {title}
        </span>
        <span className={`tag tag-${badge.tone}`}>{badge.label}</span>
      </header>

      <div className="route-metrics">
        <div>
          <span className="metric-label">Distance</span>
          <span className="metric-value">{formatMiles(summary.distance_miles)}</span>
        </div>
        <div>
          <span className="metric-label">Drive Time</span>
          <span className="metric-value">{formatDuration(summary.duration_hours)}</span>
        </div>
        <div>
          <span className="metric-label">Avg Risk</span>
          <span className="metric-value" style={{ color: scoreColor(summary.average_risk) }}>
            {summary.average_risk.toFixed(2)}
          </span>
        </div>
        <div>
          <span className="metric-label">Severe Miles</span>
          <span className="metric-value">{severe}</span>
        </div>
      </div>

      <div className="route-eta">
        <strong>ETA {formatEta(summary.arrival)}</strong>
        <span>Arrive {formatDateTime(summary.arrival)}</span>
      </div>

      {blurb && <p className="route-blurb">{blurb}</p>}
    </button>
  )
}

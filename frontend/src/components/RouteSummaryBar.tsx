import { formatDuration } from '../lib/format'
import { scoreColor, scoreLabel } from '../lib/risk'
import type { PlanResponse } from '../types'

interface RouteSummaryBarProps {
  plan: PlanResponse
  onSelect: (routeId: string) => void
}

export function RouteSummaryBar({ plan, onSelect }: RouteSummaryBarProps) {
  const bestIndex = plan.routes.findIndex((route) => route.id === plan.recommendation.route_id)
  const fastest = [...plan.routes].sort((a, b) => a.summary.duration_hours - b.summary.duration_hours)[0]
  const safest = [...plan.routes].sort((a, b) => a.summary.average_risk - b.summary.average_risk)[0]
  if (!fastest || !safest) return null

  return (
    <section className="route-summary-bar">
      <h3>Route Summary</h3>
      <div className="route-summary-metrics">
        <button type="button" onClick={() => onSelect(plan.recommendation.route_id)}>
          <span className="metric-label">Best Route</span>
          <strong>Route {bestIndex + 1}</strong>
        </button>
        <button type="button" onClick={() => onSelect(safest.id)}>
          <span className="metric-label">Lowest Risk</span>
          <strong style={{ color: scoreColor(safest.summary.average_risk) }}>
            {scoreLabel(safest.summary.average_risk)}
          </strong>
        </button>
        <button type="button" onClick={() => onSelect(fastest.id)}>
          <span className="metric-label">Shortest Time</span>
          <strong>{formatDuration(fastest.summary.duration_hours)}</strong>
        </button>
      </div>
    </section>
  )
}

import { formatDuration } from '../lib/format'
import { scoreColor } from '../lib/risk'
import type { PlanResponse } from '../types'

interface RecommendationPanelProps {
  plan: PlanResponse
  onSelect: (routeId: string) => void
}

export function RecommendationPanel({ plan, onSelect }: RecommendationPanelProps) {
  const { recommendation, routes } = plan
  const best = routes.find((route) => route.id === recommendation.route_id)
  if (!best) return null

  return (
    <section className="panel recommendation">
      <header className="panel-head">
        <h2>Recommended: {best.label}</h2>
        <button type="button" className="link" onClick={() => onSelect(best.id)}>
          View on map
        </button>
      </header>

      {best.summary.blocked && (
        <p className="alert">
          This route crosses No Travel conditions. Delay departure or re-plan before dispatching.
        </p>
      )}

      <ul className="reasons">
        {recommendation.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      <table className="ranking">
        <caption>
          Ranked by severe miles, then high miles, then average risk, then drive time
        </caption>
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Severe</th>
            <th scope="col">High</th>
            <th scope="col">Avg</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {recommendation.ranking.map((entry, position) => (
            <tr
              key={entry.route_id}
              className={entry.route_id === recommendation.route_id ? 'best' : undefined}
              onClick={() => onSelect(entry.route_id)}
            >
              <th scope="row">
                <span className="rank-position">{position + 1}</span>
                {entry.label}
                {entry.no_travel_miles > 0 && <span className="tag tag-blocked">blocked</span>}
              </th>
              <td>{Math.round(entry.severe_miles)}</td>
              <td>{Math.round(entry.high_miles)}</td>
              <td style={{ color: scoreColor(entry.average_risk) }}>
                {entry.average_risk.toFixed(2)}
              </td>
              <td>{formatDuration(entry.duration_hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

import { formatDuration, formatEta, formatMiles } from '../lib/format'
import { RISK_COLORS, RISK_LABELS, RISK_LEVELS, routeColor, scoreColor, scoreLabel } from '../lib/risk'
import { routeRoles } from '../lib/routeMeta'
import type { PlanResponse, RiskLevelSlug } from '../types'

interface RecommendationPanelProps {
  plan: PlanResponse
  compact?: boolean
  onSelect: (routeId: string) => void
}

export function RecommendationPanel({ plan, compact = false, onSelect }: RecommendationPanelProps) {
  const { recommendation, routes } = plan
  const best = routes.find((route) => route.id === recommendation.route_id)
  const bestIndex = routes.findIndex((route) => route.id === recommendation.route_id)
  const roles = routeRoles(plan)
  if (!best) return null

  const role = roles[best.id] ?? best.label
  const miles = best.summary.miles_by_level
  const totalMiles = Math.max(1, best.summary.distance_miles)

  return (
    <section className="panel recommendation">
      <header className="panel-head">
        <div>
          <p className="composer-kicker">
            Route {bestIndex + 1} – {role}
          </p>
          <h2>Recommended</h2>
        </div>
        <span className="tag tag-recommended">Recommended</span>
      </header>

      <div className="route-metrics">
        <div>
          <span className="metric-label">Distance</span>
          <span className="metric-value">{formatMiles(best.summary.distance_miles)}</span>
        </div>
        <div>
          <span className="metric-label">Drive Time</span>
          <span className="metric-value">{formatDuration(best.summary.duration_hours)}</span>
        </div>
        <div>
          <span className="metric-label">Avg Risk</span>
          <span className="metric-value" style={{ color: scoreColor(best.summary.average_risk) }}>
            {scoreLabel(best.summary.average_risk)}
          </span>
        </div>
        <div>
          <span className="metric-label">ETA</span>
          <span className="metric-value">{formatEta(best.summary.arrival)}</span>
        </div>
      </div>

      {best.summary.blocked && (
        <p className="alert">
          This route crosses No Travel conditions. Delay departure or re-plan before dispatching.
        </p>
      )}

      <h3 className="compare-title">Risk Breakdown</h3>
      <ul className="risk-breakdown">
        {RISK_LEVELS.map((level) => (
          <BreakdownRow key={level} level={level} miles={miles[level] ?? 0} total={totalMiles} />
        ))}
      </ul>

      <h3 className="compare-title">Route Comparison</h3>
      <ul className="compare-list">
        {routes.map((route, index) => (
          <li key={route.id}>
            <button type="button" onClick={() => onSelect(route.id)}>
              <i style={{ background: routeColor(index) }} />
              <span>
                Route {index + 1} – {roles[route.id] ?? route.label}
              </span>
              <strong style={{ color: scoreColor(route.summary.average_risk) }}>
                {RISK_LABELS[route.summary.max_level]}
              </strong>
              <em>{formatDuration(route.summary.duration_hours)}</em>
            </button>
          </li>
        ))}
      </ul>

      {!compact && (
      <table className="ranking">
        <caption>
          Ranked by No Travel, then severe miles, then high miles, then average risk, then drive time
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
              <td style={{ color: scoreColor(entry.average_risk) }}>{entry.average_risk.toFixed(2)}</td>
              <td>{formatDuration(entry.duration_hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}

      <div className="recommend-banner">
        <strong>Route {bestIndex + 1} is recommended</strong>
        <p>{recommendation.reasons[0] ?? 'It has the lowest weather risk and a good balance of travel time and safety.'}</p>
      </div>
    </section>
  )
}

function BreakdownRow({
  level,
  miles,
  total,
}: {
  level: RiskLevelSlug
  miles: number
  total: number
}) {
  const pct = Math.max(0, Math.min(100, (miles / total) * 100))
  return (
    <li>
      <span className="dot" style={{ background: RISK_COLORS[level] }} />
      <span>{RISK_LABELS[level]}</span>
      <span className="breakdown-track">
        <span style={{ width: `${pct}%`, background: RISK_COLORS[level] }} />
      </span>
      <strong>{Math.round(miles)} mi</strong>
    </li>
  )
}

import { RISK_COLORS, RISK_LABELS, RISK_LEVELS } from '../lib/risk'
import type { RouteSummary } from '../types'

interface WeatherRiskSummaryProps {
  summary: RouteSummary
}

export function WeatherRiskSummary({ summary }: WeatherRiskSummaryProps) {
  const total = Math.max(1, summary.distance_miles)
  const slices = RISK_LEVELS.map((level) => ({
    level,
    miles: summary.miles_by_level[level] ?? 0,
    pct: ((summary.miles_by_level[level] ?? 0) / total) * 100,
  }))

  const gradient = slices
    .reduce(
      (acc, slice) => {
        const end = acc.at + slice.pct
        return {
          at: end,
          css: [...acc.css, `${RISK_COLORS[slice.level]} ${acc.at}% ${end}%`],
        }
      },
      { at: 0, css: [] as string[] },
    )
    .css.join(', ')

  const overall = RISK_LABELS[summary.max_level]

  return (
    <section className="panel weather-risk-summary">
      <h2>Weather Risk Summary</h2>
      <div className="risk-summary-body">
        <div
          className="risk-donut"
          style={{ background: `conic-gradient(${gradient})` }}
          aria-hidden="true"
        >
          <span>
            Overall
            <strong>{overall}</strong>
          </span>
        </div>
        <ul>
          {slices.map((slice) => (
            <li key={slice.level}>
              <i className="dot" style={{ background: RISK_COLORS[slice.level] }} />
              <span>{RISK_LABELS[slice.level]}</span>
              <strong>{Math.round(slice.pct)}%</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

import { useMemo, useState } from 'react'

import { formatClock } from '../lib/format'
import { riskColor } from '../lib/risk'
import type { Route } from '../types'

import type { CheckpointRef } from './MapView'

interface CheckpointListProps {
  route: Route
  focused: CheckpointRef | null
  onFocus: (ref: CheckpointRef) => void
}

export function CheckpointList({ route, focused, onFocus }: CheckpointListProps) {
  const [elevatedOnly, setElevatedOnly] = useState(false)

  const elevatedCount = useMemo(
    () => route.checkpoints.filter((cp) => cp.risk.score > 0).length,
    [route],
  )

  const visible = useMemo(
    () => (elevatedOnly ? route.checkpoints.filter((cp) => cp.risk.score > 0) : route.checkpoints),
    [route, elevatedOnly],
  )

  return (
    <section className="panel checkpoints">
      <header className="panel-head">
        <h2>Checkpoints</h2>
        <span className="panel-meta">
          {route.checkpoints.length} sampled · {elevatedCount} elevated
        </span>
      </header>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={elevatedOnly}
          onChange={(event) => setElevatedOnly(event.target.checked)}
          disabled={elevatedCount === 0}
        />
        <span>Show only risk points</span>
      </label>

      {visible.length === 0 ? (
        <p className="empty-note">
          Every checkpoint on {route.label} is within Low thresholds for this load.
        </p>
      ) : (
        <ol className="checkpoint-list">
          {visible.map((cp) => {
            const active = focused?.routeId === route.id && focused.index === cp.index
            return (
              <li key={cp.index}>
                <button
                  type="button"
                  className={active ? 'checkpoint-row active' : 'checkpoint-row'}
                  style={{ '--level-color': riskColor(cp.risk.level) } as React.CSSProperties}
                  onClick={() => onFocus({ routeId: route.id, index: cp.index })}
                >
                  <span className="checkpoint-level" aria-hidden="true" />
                  <span className="checkpoint-mile">{Math.round(cp.mile)} mi</span>
                  <span className="checkpoint-eta">{formatClock(cp.eta)}</span>
                  <span className="checkpoint-wx">
                    {Math.round(cp.weather.wind_mph)}/{Math.round(cp.weather.wind_gust_mph)} mph
                    {cp.weather.snow_in_hr > 0.05 && ` · ${cp.weather.snow_in_hr.toFixed(1)}" snow`}
                    {cp.weather.rain_in_hr > 0.05 && ` · ${cp.weather.rain_in_hr.toFixed(2)}" rain`}
                  </span>
                  <span className="checkpoint-risk">{cp.risk.label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

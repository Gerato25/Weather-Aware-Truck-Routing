import { cityStateName, formatEta, weatherGlyph } from '../lib/format'
import { sampleCheckpoints } from '../lib/routeMeta'
import { riskColor } from '../lib/risk'
import type { Place, Route } from '../types'

import type { CheckpointRef } from './MapView'

interface RouteForecastStripProps {
  route: Route
  origin: Place | null
  destination: Place | null
  focused: CheckpointRef | null
  onFocus: (ref: CheckpointRef) => void
}

export function RouteForecastStrip({
  route,
  origin,
  destination,
  focused,
  onFocus,
}: RouteForecastStripProps) {
  const cards = sampleCheckpoints(route.checkpoints, 6)

  return (
    <section className="forecast-strip">
      <header className="forecast-strip-head">
        <h2>
          <span aria-hidden="true">☁</span>
          Weather Forecast Along Route
        </h2>
        <span className="forecast-range">0 – 48 hours</span>
      </header>
      <div className="forecast-cards">
        {cards.map((cp, index) => {
          const active = focused?.routeId === route.id && focused.index === cp.index
          const place =
            index === 0 && origin
              ? cityStateName(origin.label)
              : index === cards.length - 1 && destination
                ? cityStateName(destination.label)
                : null
          return (
            <button
              key={cp.index}
              type="button"
              className={active ? 'forecast-card active' : 'forecast-card'}
              style={{ '--level-color': riskColor(cp.risk.level) } as React.CSSProperties}
              onClick={() => onFocus({ routeId: route.id, index: cp.index })}
            >
              <span className="forecast-mile">{Math.round(cp.mile).toLocaleString()} mi</span>
              {place ? (
                <span className="forecast-place">{place}</span>
              ) : (
                <span className="forecast-time">ETA {formatEta(cp.eta)}</span>
              )}
              <span className="forecast-main">
                <span className="forecast-glyph" aria-hidden="true">
                  {weatherGlyph(cp.weather.weather_code)}
                </span>
                <span className="forecast-temp">
                  {cp.weather.temperature_f === null ? '—' : `${Math.round(cp.weather.temperature_f)}°F`}
                </span>
              </span>
              <span className="forecast-risk">{cp.risk.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

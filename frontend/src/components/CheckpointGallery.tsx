import { shortPlaceName, weatherGlyph } from '../lib/format'
import { sampleCheckpoints } from '../lib/routeMeta'
import { riskColor } from '../lib/risk'
import type { Place, Route } from '../types'

import type { CheckpointRef } from './MapView'

interface CheckpointGalleryProps {
  route: Route
  origin: Place | null
  destination: Place | null
  intervalMiles: number
  focused: CheckpointRef | null
  onFocus: (ref: CheckpointRef) => void
}

export function CheckpointGallery({
  route,
  origin,
  destination,
  intervalMiles,
  focused,
  onFocus,
}: CheckpointGalleryProps) {
  const cards = sampleCheckpoints(route.checkpoints, 4)

  return (
    <section className="panel checkpoint-gallery">
      <header className="panel-head">
        <h2>Checkpoints</h2>
        <span className="panel-meta">sampled every {intervalMiles} mi</span>
      </header>
      <div className="checkpoint-gallery-grid">
        {cards.map((cp, index) => {
          const active = focused?.routeId === route.id && focused.index === cp.index
          const place =
            index === 0 && origin
              ? shortPlaceName(origin.label)
              : index === cards.length - 1 && destination
                ? shortPlaceName(destination.label)
                : `Mile ${Math.round(cp.mile)}`
          return (
            <button
              key={cp.index}
              type="button"
              className={active ? 'checkpoint-card active' : 'checkpoint-card'}
              style={{ '--level-color': riskColor(cp.risk.level) } as React.CSSProperties}
              onClick={() => onFocus({ routeId: route.id, index: cp.index })}
            >
              <strong>{place}</strong>
              <span className="forecast-main">
                <span aria-hidden="true">{weatherGlyph(cp.weather.weather_code)}</span>
                <span>
                  {cp.weather.temperature_f === null ? '—' : `${Math.round(cp.weather.temperature_f)}°F`}
                </span>
              </span>
              <span className="checkpoint-card-wx">
                Wind {Math.round(cp.weather.wind_mph)} mph
                <br />
                Rain {cp.weather.rain_in_hr.toFixed(2)} in/hr
              </span>
              <span className="forecast-risk">{cp.risk.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

import { RISK_COLORS, RISK_LABELS, RISK_LEVELS, RISK_THRESHOLDS } from '../lib/risk'
import type { TripFormValues } from '../types'

interface RequirementsPanelProps {
  intervalMiles: TripFormValues['intervalMiles']
  onInterval: (value: TripFormValues['intervalMiles']) => void
}

const INTERVALS: TripFormValues['intervalMiles'][] = [10, 25, 50]

export function RequirementsPanel({ intervalMiles, onInterval }: RequirementsPanelProps) {
  return (
    <div className="requirements">
      <section className="panel">
        <header className="panel-head">
          <h2>What you get</h2>
        </header>
        <ul className="req-list">
          <li>Three distinct corridors with distance, drive time, and risk</li>
          <li>Weather at timed checkpoints (ETA, not average speed)</li>
          <li>0–48h corridor heatmap you can scrub without refetching</li>
          <li>A ranked safest pick for this load</li>
        </ul>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Checkpoint spacing</h2>
        </header>
        <div className="segmented" role="group" aria-label="Checkpoint spacing in miles">
          {INTERVALS.map((interval) => (
            <button
              type="button"
              key={interval}
              aria-pressed={intervalMiles === interval}
              className={intervalMiles === interval ? 'segment active' : 'segment'}
              onClick={() => onInterval(interval)}
            >
              {interval} mi
            </button>
          ))}
        </div>
        <p className="field-hint">Required: sample wind, rain, and snow every 10, 25, or 50 miles.</p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Risk table</h2>
        </header>
        <p className="field-hint">Each checkpoint takes the worst of wind, rain, and snow.</p>
        <table className="rules-table">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Wind</th>
              <th scope="col">Rain</th>
              <th scope="col">Snow</th>
            </tr>
          </thead>
          <tbody>
            {RISK_LEVELS.map((level) => (
              <tr key={level}>
                <th scope="row">
                  <span className="dot" style={{ background: RISK_COLORS[level] }} />
                  {RISK_LABELS[level]}
                </th>
                <td>{RISK_THRESHOLDS[level].wind}</td>
                <td>{RISK_THRESHOLDS[level].rain}</td>
                <td>{RISK_THRESHOLDS[level].snow}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="field-hint">Units: mph · in/hr · in/hr. Shared rain 0.25 is Moderate.</p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Load rules</h2>
        </header>
        <ul className="req-list">
          <li>≥ 55 mph wind → No Travel at any weight</li>
          <li>45–54 mph and load &gt; 30,000 lb → No Travel</li>
          <li>35–44 mph and load &gt; 40,000 lb → Severe</li>
        </ul>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>How we recommend</h2>
        </header>
        <ol className="req-list numbered">
          <li>Fewest No Travel miles</li>
          <li>Fewest Severe miles</li>
          <li>Fewest High miles</li>
          <li>Lowest average risk</li>
          <li>Shortest drive time</li>
        </ol>
      </section>
    </div>
  )
}

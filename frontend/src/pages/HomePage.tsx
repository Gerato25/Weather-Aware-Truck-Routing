import { CheckCircle2, Shield, Truck } from 'lucide-react'

import { formatPounds } from '../lib/format'
import { AppHeader } from '../components/AppHeader'
import { LocationInput } from '../components/LocationInput'
import { RISK_LABELS, RISK_LEVELS, RISK_THRESHOLDS } from '../lib/risk'
import type { Page } from '../lib/navigation'
import type { Place, TripFormValues } from '../types'

const STEPS = [
  {
    title: 'Enter the haul',
    body: 'Origin, destination, departure, and load. Checkpoints can be 10, 25, or 50 miles.',
  },
  {
    title: 'Score three corridors',
    body: 'We ask for three real truck routes, not one fastest path, so weather has room to matter.',
  },
  {
    title: 'Weather at truck ETA',
    body: 'Each stop is scored at the hour the truck arrives there — not the slider’s clock hour.',
  },
  {
    title: 'Recommend the safest',
    body: 'Fewest Severe miles, then High, then lowest average risk, then shortest time.',
  },
] as const

const LOAD_RULES = [
  '≥ 55 mph wind → No Travel for any load',
  '45–54 mph + over 30,000 lb → No Travel',
  '35–44 mph + over 40,000 lb → Severe',
] as const

const METRICS = [
  { key: 'wind' as const, label: 'Wind', unit: 'mph' },
  { key: 'rain' as const, label: 'Rain', unit: 'in/hr' },
  { key: 'snow' as const, label: 'Snow', unit: 'in/hr' },
]

interface HomePageProps {
  form: TripFormValues
  onFormChange: <K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) => void
  onNavigate: (page: Page, hash?: string) => void
  onStartTrip: (values: TripFormValues, autoPlan: boolean) => void
}

const FEATURES = [
  {
    title: 'Real-Time Weather Data',
    body: 'Live Open-Meteo at each checkpoint lat/lon and the truck’s arrival hour.',
    tone: 'blue',
    icon: 'cloud',
  },
  {
    title: 'Risk-Aware Routing',
    body: 'Severe miles first, then High, average risk, and time — plus load wind rules.',
    tone: 'green',
    icon: 'shield',
  },
  {
    title: 'Compare 3 Routes',
    body: 'Three real alternatives so a storm on the shortest path can lose.',
    tone: 'purple',
    icon: 'clock',
  },
  {
    title: 'Built for Truckers',
    body: '42,000 lb default haul. 55 mph is No Travel; heavy loads tighten earlier bands.',
    tone: 'orange',
    icon: 'truck',
  },
] as const

export function HomePage({
  form,
  onFormChange,
  onNavigate,
  onStartTrip,
}: HomePageProps) {
  const canSubmit = form.origin.trim().length > 1 && form.destination.trim().length > 1

  return (
    <div className="app home-shell">
      <AppHeader page="home" onNavigate={onNavigate} />

      <section className="home-hero" id="top">
        <img
          className="home-hero-photo"
          src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=1800&q=80"
          alt=""
        />
        <div className="home">
          <div className="home-hero-copy">
            <h2>
              Weather-aware
              <br />
              truck <em>routing</em>
            </h2>
            <p className="home-lead">
              Compare three live corridors, score wind, rain, and snow at each checkpoint ETA, and
              take the safest route for your load.
            </p>
            <ul className="home-proof">
              <li>3 ranked corridors</li>
              <li>Open-Meteo at lat/lon + ETA</li>
              <li>Load-aware wind rules</li>
            </ul>
          </div>

          <form
            className="home-plan-card"
            onSubmit={(event) => {
              event.preventDefault()
              if (canSubmit) onStartTrip(form, true)
            }}
          >
            <LocationInput
              label="Origin"
              placeholder="Enter origin (e.g. Chicago, IL)"
              value={form.origin}
              resolved={form.originPlace}
              onChange={(value) => onFormChange('origin', value)}
              onResolve={(place: Place | null) => onFormChange('originPlace', place)}
            />
            <LocationInput
              label="Destination"
              placeholder="Enter destination (e.g. Denver, CO)"
              value={form.destination}
              resolved={form.destinationPlace}
              onChange={(value) => onFormChange('destination', value)}
              onResolve={(place: Place | null) => onFormChange('destinationPlace', place)}
            />
            <div className="home-plan-meta">
              <div className="field">
                <label htmlFor="home-departure">Departure</label>
                <div className="field-shell">
                  <span className="field-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M8 3v4M16 3v4M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    id="home-departure"
                    type="datetime-local"
                    value={form.departure}
                    onChange={(event) => onFormChange('departure', event.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="home-load">Load</label>
                <div className="field-shell">
                  <span className="field-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M3 16V8h11l4 4v4H3zM14 8v4h4M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <input
                    id="home-load"
                    type="number"
                    min={0}
                    max={80000}
                    step={1000}
                    value={form.loadLb}
                    aria-valuetext={formatPounds(form.loadLb)}
                    onChange={(event) => onFormChange('loadLb', Number(event.target.value))}
                  />
                  <span className="field-suffix">lb</span>
                </div>
              </div>
              <button type="submit" className="primary home-plan-submit" disabled={!canSubmit}>
                Find safest route
              </button>
            </div>
          </form>
        </div>
      </section>

      <div className="home">
        <section className="home-features" id="features">
          {FEATURES.map((item) => (
            <article key={item.title}>
              <span className={`home-feature-icon ${item.tone}`} aria-hidden="true">
                <FeatureIcon name={item.icon} />
              </span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="home-how" id="how">
          <div className="home-how-copy">
            <h3>How a trip is scored</h3>
            <p>
              The planner does not pick the shortest drive and then color it. It ranks three
              corridors from live forecasts at each arrival time, then applies the load wind rules.
            </p>
            <ol>
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <aside className="home-result-card" aria-label="What you see after Analyze">
            <p className="home-result-kicker">After Analyze</p>
            <p className="home-result-title">Three corridors. One recommendation.</p>
            <ul>
              <li>
                <i style={{ background: '#2563eb' }} />
                <div>
                  <strong>Route A</strong>
                  <span>Recommended when Severe and High miles stay lowest</span>
                </div>
              </li>
              <li>
                <i style={{ background: '#7c3aed' }} />
                <div>
                  <strong>Route B</strong>
                  <span>Shown if it is faster but carries more weather risk</span>
                </div>
              </li>
              <li>
                <i style={{ background: '#64748b' }} />
                <div>
                  <strong>Route C</strong>
                  <span>A third corridor so overlap does not hide a safer option</span>
                </div>
              </li>
            </ul>
            <p className="home-result-note">
              Map slider = corridor weather this hour. Left list = weather when the truck gets there.
            </p>
          </aside>
        </section>

        <section className="home-rules" id="rules">
          <article className="home-rules-card">
            <div className="home-rules-head">
              <span className="home-feature-icon green" aria-hidden="true">
                <Shield strokeWidth={1.75} />
              </span>
              <div>
                <h3>Risk Rules</h3>
                <p>These thresholds classify weather at each checkpoint.</p>
              </div>
            </div>
            <div className="home-rules-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Condition</th>
                    {RISK_LEVELS.map((level) => (
                      <th key={level} data-level={level}>
                        {RISK_LABELS[level]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((metric) => (
                    <tr key={metric.key}>
                      <th scope="row">
                        {metric.label}
                        <small>{metric.unit}</small>
                      </th>
                      {RISK_LEVELS.map((level) => (
                        <td key={level}>{RISK_THRESHOLDS[level][metric.key]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="home-rules-card">
            <div className="home-rules-head">
              <span className="home-feature-icon orange" aria-hidden="true">
                <Truck strokeWidth={1.75} />
              </span>
              <div>
                <h3>Load rules</h3>
                <p>Heavier freight tightens the wind bands.</p>
              </div>
            </div>
            <ul className="home-load-list">
              {LOAD_RULES.map((rule) => (
                <li key={rule}>
                  <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </div>

      <footer className="home-foot">
        Drive safer. Plan smarter. · WeatherRoute · Open-Meteo · OpenStreetMap
      </footer>
    </div>
  )
}

function FeatureIcon({ name }: { name: (typeof FEATURES)[number]['icon'] }) {
  if (name === 'cloud') {
    return (
      <svg viewBox="0 0 24 24">
        <path
          d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.5A3.5 3.5 0 0 0 7 18z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path d="M8 10v-1M12 9V7M16 10.5V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'shield') {
    return (
      <svg viewBox="0 0 24 24">
        <path
          d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    )
  }
  if (name === 'clock') {
    return (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 8v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

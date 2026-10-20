import { useEffect } from 'react'

import { formatPounds } from '../lib/format'
import { AppHeader } from '../components/AppHeader'
import { HomeMapPreview } from '../components/HomeMapPreview'
import { LocationInput } from '../components/LocationInput'
import type { Page } from '../lib/navigation'
import type { Theme } from '../lib/theme'
import type { Place, TripFormValues } from '../types'

interface HomePageProps {
  theme: Theme
  onTheme: (theme: Theme) => void
  form: TripFormValues
  onFormChange: <K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) => void
  onNavigate: (page: Page, hash?: string) => void
  onStartTrip: (values: TripFormValues, autoPlan: boolean) => void
}

const FEATURES = [
  {
    title: 'Real-Time Weather Data',
    body: 'Get accurate forecasts along your entire route.',
    tone: 'blue',
    icon: 'cloud',
  },
  {
    title: 'Risk-Aware Routing',
    body: 'Avoid dangerous weather and reduce risk with smart routing.',
    tone: 'green',
    icon: 'shield',
  },
  {
    title: 'Compare 3 Routes',
    body: 'See distance, ETA, risk levels and choose the best option.',
    tone: 'purple',
    icon: 'clock',
  },
  {
    title: 'Built for Truckers',
    body: 'Consider load weight, road conditions and travel time.',
    tone: 'orange',
    icon: 'truck',
  },
] as const

const STEPS = [
  {
    title: 'Enter Trip Details',
    body: 'Add origin, destination, departure time and load weight.',
  },
  {
    title: 'Get 3 Route Options',
    body: 'We’ll find alternative routes using a routing API.',
  },
  {
    title: 'Check Weather & Risk',
    body: 'Sample weather along the route and calculate risk levels.',
  },
  {
    title: 'See the Best Route',
    body: 'Compare routes and get the safest recommendation.',
  },
]

export function HomePage({
  theme,
  onTheme,
  form,
  onFormChange,
  onNavigate,
  onStartTrip,
}: HomePageProps) {
  const canSubmit = form.origin.trim().length > 1 && form.destination.trim().length > 1

  useEffect(() => {
    if (window.location.hash !== '#about') return
    document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="app home-shell">
      <AppHeader page="home" theme={theme} onTheme={onTheme} onNavigate={onNavigate} />

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
              placeholder="Enter origin (e.g. Denver, CO)"
              value={form.origin}
              resolved={form.originPlace}
              onChange={(value) => onFormChange('origin', value)}
              onResolve={(place: Place | null) => onFormChange('originPlace', place)}
            />
            <LocationInput
              label="Destination"
              placeholder="Enter destination (e.g. Glenwood Springs, CO)"
              value={form.destination}
              resolved={form.destinationPlace}
              onChange={(value) => onFormChange('destination', value)}
              onResolve={(place: Place | null) => onFormChange('destinationPlace', place)}
            />
            <div className="field">
              <label htmlFor="home-departure">Departure Date &amp; Time</label>
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
              <label htmlFor="home-load">Load Weight (lb)</label>
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
              Find Safest Route →
            </button>
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

        <section className="home-how" id="about">
          <div className="home-how-copy">
            <h3>How It Works</h3>
            <p>Plan your trip in a few simple steps and get the safest route with weather-aware insights.</p>
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
          <HomeMapPreview theme={theme} />
        </section>
      </div>

      <footer className="home-foot">Drive safer. Plan smarter. · WeatherRoute</footer>
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

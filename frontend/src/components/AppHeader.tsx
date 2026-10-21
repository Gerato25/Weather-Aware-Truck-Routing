import type { Page } from '../lib/navigation'
import { pathForPage } from '../lib/navigation'
import { weatherGlyph, weatherLabel } from '../lib/format'

interface AppHeaderProps {
  page: Page
  onNavigate: (page: Page, hash?: string) => void
  originWeather?: { temperature_f: number | null; weather_code: number | null } | null
}

export function AppHeader({ page, onNavigate, originWeather }: AppHeaderProps) {
  return (
    <header className="topbar">
      <a
        href="/"
        className="brand"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.button !== 0) return
          event.preventDefault()
          onNavigate('home')
        }}
      >
        <span className="logo" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <rect x="3" y="12" width="18" height="10" rx="2" fill="currentColor" />
            <path d="M21 14h5l3 4v4h-8V14z" fill="currentColor" opacity="0.85" />
            <circle cx="9" cy="23" r="2.4" fill="#0b1220" />
            <circle cx="23" cy="23" r="2.4" fill="#0b1220" />
          </svg>
        </span>
        <div>
          <h1>WeatherRoute</h1>
          <p>Truck Route Intelligence</p>
        </div>
      </a>

      <nav className="top-nav" aria-label="Primary">
        <a
          href="/"
          className={page === 'home' ? 'top-nav-link active' : 'top-nav-link'}
          aria-current={page === 'home' ? 'page' : undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.button !== 0) return
            event.preventDefault()
            onNavigate('home')
          }}
        >
          Home
        </a>
        <a
          href={pathForPage('planner')}
          className={page === 'planner' ? 'top-nav-link active' : 'top-nav-link'}
          aria-current={page === 'planner' ? 'page' : undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.button !== 0) return
            event.preventDefault()
            onNavigate('planner')
          }}
        >
          Trip Planner
        </a>
      </nav>

      {originWeather && (
        <div className="header-actions">
          <div className="wx-chip">
            <span aria-hidden="true">{weatherGlyph(originWeather.weather_code)}</span>
            <strong>
              {originWeather.temperature_f === null
                ? '—'
                : `${Math.round(originWeather.temperature_f)}°F`}
            </strong>
            <small>{weatherLabel(originWeather.weather_code)}</small>
          </div>
        </div>
      )}
    </header>
  )
}

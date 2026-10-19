import type { Page } from '../lib/navigation'
import { pathForPage } from '../lib/navigation'

interface AppSidebarProps {
  page: Page
  onNavigate: (page: Page) => void
  settingsOpen: boolean
  onToggleSettings: () => void
}

const LINKS: { page: Exclude<Page, 'home'>; label: string; icon: 'plan' | 'routes' | 'weather' }[] = [
  { page: 'planner', label: 'Trip Planner', icon: 'plan' },
  { page: 'routes', label: 'Routes', icon: 'routes' },
  { page: 'weather', label: 'Weather', icon: 'weather' },
]

export function AppSidebar({ page, onNavigate, settingsOpen, onToggleSettings }: AppSidebarProps) {
  return (
    <aside className="sidebar">
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
          <h1>Spotter</h1>
          <p>Safer routes. Smarter decisions.</p>
        </div>
      </a>

      <nav className="sidebar-items" aria-label="Primary">
        {LINKS.map((link) => (
          <a
            key={link.page}
            href={pathForPage(link.page)}
            className={page === link.page ? 'nav-item active' : 'nav-item'}
            aria-current={page === link.page ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.button !== 0) return
              event.preventDefault()
              onNavigate(link.page)
            }}
          >
            <NavIcon name={link.icon} />
            <span>{link.label}</span>
          </a>
        ))}
        <button
          type="button"
          className={settingsOpen ? 'nav-item active' : 'nav-item'}
          aria-pressed={settingsOpen}
          onClick={onToggleSettings}
        >
          <NavIcon name="settings" />
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-foot">
        <svg viewBox="0 0 64 40" aria-hidden="true">
          <rect x="4" y="14" width="34" height="14" rx="3" fill="currentColor" />
          <path d="M38 17h10l6 6v5H38V17z" fill="currentColor" opacity="0.8" />
          <circle cx="16" cy="30" r="4" fill="#0b1220" />
          <circle cx="44" cy="30" r="4" fill="#0b1220" />
        </svg>
        <strong>Smarter planning for safer journeys.</strong>
      </div>
    </aside>
  )
}

function NavIcon({ name }: { name: 'plan' | 'routes' | 'weather' | 'settings' }) {
  if (name === 'plan') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    )
  }
  if (name === 'routes') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="18" cy="18" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M8 7.5c6 0 2 9 8 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (name === 'weather') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.5A3.5 3.5 0 0 0 7 18z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM4 12h2m12 0h2M6.5 6.5l1.4 1.4m8.2 8.2 1.4 1.4M6.5 17.5l1.4-1.4m8.2-8.2 1.4-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

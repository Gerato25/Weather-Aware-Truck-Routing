import type { Theme } from '../lib/theme'

interface ThemeToggleProps {
  theme: Theme
  onChange: (theme: Theme) => void
}

export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      <button
        type="button"
        className={theme === 'light' ? 'icon-chip active' : 'icon-chip'}
        aria-pressed={theme === 'light'}
        aria-label="Light theme"
        onClick={() => onChange('light')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={theme === 'dark' ? 'icon-chip active' : 'icon-chip'}
        aria-pressed={theme === 'dark'}
        aria-label="Dark theme"
        onClick={() => onChange('dark')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M16 4.5A8 8 0 1 0 19.5 16 6.5 6.5 0 0 1 16 4.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

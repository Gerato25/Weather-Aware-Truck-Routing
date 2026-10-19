import type { ReactNode } from 'react'

import type { Theme } from '../lib/theme'

interface WorkspaceBarProps {
  theme: Theme
  onTheme: (theme: Theme) => void
  title?: string
  subtitle?: string
  action?: ReactNode
}

export function WorkspaceBar({ theme, onTheme, title, subtitle, action }: WorkspaceBarProps) {
  return (
    <div className="workspace-toolbar">
      <div className="workspace-heading">
        {title && <h2>{title}</h2>}
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="workspace-toolbar-actions">
        {action}
        <button
          type="button"
          className="am-chip"
          aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          onClick={() => onTheme(theme === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? 'AM' : 'PM'}
        </button>
      </div>
    </div>
  )
}

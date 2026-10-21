import type { ReactNode } from 'react'

interface WorkspaceBarProps {
  title?: string
  subtitle?: string
  action?: ReactNode
}

export function WorkspaceBar({ title, subtitle, action }: WorkspaceBarProps) {
  return (
    <div className="workspace-toolbar">
      <div className="workspace-heading">
        {title && <h2>{title}</h2>}
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="workspace-toolbar-actions">{action}</div>}
    </div>
  )
}

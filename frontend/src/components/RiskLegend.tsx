import { useState } from 'react'

import { RISK_COLORS, RISK_LABELS, RISK_LEVELS, RISK_THRESHOLDS } from '../lib/risk'

interface RiskLegendProps {
  title?: string
  placement?: 'top' | 'bottom'
}

export function RiskLegend({ title, placement = 'top' }: RiskLegendProps) {
  const [open, setOpen] = useState(false)
  const classes = ['legend', placement === 'bottom' ? 'bottom' : '', open ? 'open' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div className="legend-pills">
        {title && <span className="legend-title">{title}</span>}
        {RISK_LEVELS.map((level) => (
          <span key={level} className="legend-pill">
            <i className="dot" style={{ background: RISK_COLORS[level] }} />
            {RISK_LABELS[level]}
          </span>
        ))}
        <button type="button" className="legend-more" onClick={() => setOpen(!open)}>
          {open ? 'Hide table' : 'Thresholds'}
        </button>
      </div>

      {open && (
        <div className="legend-body">
          <table>
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Wind mph</th>
                <th scope="col">Rain in/hr</th>
                <th scope="col">Snow in/hr</th>
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
          <p className="legend-note">
            Load rules: ≥55 mph is No Travel for any load; 45-54 mph over 30,000 lb becomes No
            Travel; 35-44 mph over 40,000 lb becomes Severe.
          </p>
        </div>
      )}
    </div>
  )
}

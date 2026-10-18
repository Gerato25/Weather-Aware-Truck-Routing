import { useState } from 'react'

import { RISK_COLORS, RISK_LABELS, RISK_LEVELS } from '../lib/risk'

const THRESHOLDS: Record<string, [string, string, string]> = {
  LOW: ['< 25', '< 0.10', '< 0.5'],
  MODERATE: ['25-34', '0.10-0.25', '0.5-1.0'],
  HIGH: ['35-44', '0.25-0.50', '1.0-2.0'],
  SEVERE: ['45-54', '0.50-1.00', '2.0-3.0'],
  NO_TRAVEL: ['≥ 55', '> 1.00', '> 3.0'],
}

export function RiskLegend() {
  const [open, setOpen] = useState(false)

  return (
    <div className={open ? 'legend open' : 'legend'}>
      <div className="legend-pills">
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
                  {THRESHOLDS[level].map((cell) => (
                    <td key={cell}>{cell}</td>
                  ))}
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

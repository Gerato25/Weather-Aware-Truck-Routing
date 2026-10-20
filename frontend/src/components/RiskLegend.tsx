import { useState } from 'react'

import {
  HEAT_LAYER_KEYS,
  RISK_COLORS,
  RISK_LABELS,
  RISK_LEVELS,
  RISK_THRESHOLDS,
  type HeatLayers,
  type HeatMetric,
} from '../lib/risk'

interface RiskLegendProps {
  title?: string
  placement?: 'top' | 'bottom'
  overlay?: HeatLayers
}

const OVERLAY_SCALES: Record<HeatMetric, { color: string; label: string }[]> = {
  risk: RISK_LEVELS.map((level) => ({
    color: RISK_COLORS[level],
    label: RISK_LABELS[level],
  })),
  wind: [
    { color: '#bae6fd', label: 'Calm' },
    { color: '#38bdf8', label: 'Breezy' },
    { color: '#2563eb', label: 'Strong' },
  ],
  rain: [
    { color: '#99f6e4', label: 'Light' },
    { color: '#14b8a6', label: 'Moderate' },
    { color: '#0f766e', label: 'Heavy' },
  ],
  snow: [
    { color: '#e0e7ff', label: 'Flurries' },
    { color: '#c7d2fe', label: 'Snow' },
    { color: '#ffffff', label: 'Heavy' },
  ],
}

const OVERLAY_TITLES: Record<HeatMetric, string> = {
  risk: 'Corridor risk',
  wind: 'Wind',
  rain: 'Rain',
  snow: 'Snow',
}

export function RiskLegend({ title, placement = 'top', overlay }: RiskLegendProps) {
  const [open, setOpen] = useState(false)
  const classes = ['legend', placement === 'bottom' ? 'bottom' : '', open ? 'open' : '']
    .filter(Boolean)
    .join(' ')
  const active = overlay ? HEAT_LAYER_KEYS.find((key) => overlay[key]) : undefined
  const pills = active ? OVERLAY_SCALES[active] : RISK_LEVELS.map((level) => ({
    color: RISK_COLORS[level],
    label: RISK_LABELS[level],
  }))
  const heading = title ?? (active ? OVERLAY_TITLES[active] : undefined)

  return (
    <div className={classes}>
      <div className="legend-pills">
        {heading && <span className="legend-title">{heading}</span>}
        {pills.map((pill) => (
          <span key={pill.label} className="legend-pill">
            <i className="dot" style={{ background: pill.color }} />
            {pill.label}
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

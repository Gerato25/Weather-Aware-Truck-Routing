import { useMemo } from 'react'

import type { CorridorResponse } from '../types'

interface HeatmapBarProps {
  corridor: CorridorResponse | null
  loading: boolean
  hour: number
  onHourChange: (hour: number) => void
}

export function HeatmapBar({ corridor, loading, hour, onHourChange }: HeatmapBarProps) {
  const maxHour = corridor ? Math.max(0, corridor.hours.length - 1) : 48

  const timestamp = useMemo(() => {
    if (!corridor?.hours[hour]) return null
    return new Date(corridor.hours[hour])
  }, [corridor, hour])

  return (
    <div className="heat-bar">
      <div className="heat-label">
        <span aria-hidden="true">☁</span>
        <span>Weather Forecast (0–48h)</span>
      </div>

      <input
        className="heat-slider"
        type="range"
        min={0}
        max={maxHour}
        step={1}
        value={Math.min(hour, maxHour)}
        onChange={(event) => onHourChange(Number(event.target.value))}
        disabled={!corridor}
        aria-label="Forecast hour offset from departure"
      />

      <div className="heat-readout">
        <span className="heat-offset">{hour}h</span>
        <span className="heat-time">
          {loading
            ? 'Loading…'
            : timestamp
              ? timestamp.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })
              : '—'}
        </span>
      </div>
    </div>
  )
}

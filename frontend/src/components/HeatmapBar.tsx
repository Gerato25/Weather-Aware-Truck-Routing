import { useMemo } from 'react'

import { formatEtaClock } from '../lib/format'
import type { CorridorResponse } from '../types'

interface HeatmapBarProps {
  corridor?: CorridorResponse | null
  loading?: boolean
  hour: number
  onHourChange: (hour: number) => void
}

export function HeatmapBar({ corridor, loading = false, hour, onHourChange }: HeatmapBarProps) {
  const maxHour = corridor ? Math.max(0, corridor.hours.length - 1) : 48
  const fill = maxHour === 0 ? 0 : (Math.min(hour, maxHour) / maxHour) * 100

  const timestamp = useMemo(() => {
    if (corridor?.hours[hour]) return new Date(corridor.hours[hour])
    return new Date(Date.now() + hour * 3_600_000)
  }, [corridor, hour])

  return (
    <div className="heat-bar">
      <div className="heat-label">
        <span aria-hidden="true">☁</span>
        <span>Corridor forecast (0–48h)</span>
      </div>

      <input
        className="heat-slider"
        type="range"
        min={0}
        max={maxHour}
        step={1}
        value={Math.min(hour, maxHour)}
        onChange={(event) => onHourChange(Number(event.target.value))}
        aria-label="Forecast hour offset from departure"
        style={{
          background: `linear-gradient(to right, var(--accent) ${fill}%, var(--surface-3) ${fill}%)`,
        }}
      />

      <div className="heat-readout">
        <span className="heat-offset">{hour}h</span>
        <span className="heat-time">
          {loading
            ? 'Loading…'
            : timestamp
              ? formatEtaClock(timestamp.toISOString())
              : '—'}
        </span>
      </div>
    </div>
  )
}

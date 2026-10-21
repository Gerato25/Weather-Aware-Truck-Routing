import { routeLetter } from '../lib/routeMeta'
import { routeColor } from '../lib/risk'
import type { Route } from '../types'

interface ArrivalTicksProps {
  routes: Route[]
  maxHour: number
  selectedRouteId: string | null
}

export function ArrivalTicks({ routes, maxHour, selectedRouteId }: ArrivalTicksProps) {
  if (!routes.length || maxHour <= 0) return null

  return (
    <div className="pointer-events-none absolute inset-x-[8px] -top-3 h-3" aria-hidden="true">
      {routes.map((route, index) => {
        const hour = Math.min(maxHour, Math.max(0, route.summary.duration_hours))
        const left = (hour / maxHour) * 100
        const selected = route.id === selectedRouteId
        return (
          <span
            key={route.id}
            className="absolute top-0 -translate-x-1/2 text-[9px] font-bold leading-none"
            style={{
              left: `${left}%`,
              color: routeColor(index),
              opacity: selected ? 1 : 0.72,
            }}
            title={`Route ${routeLetter(index)} arrives at +${hour.toFixed(1)}h`}
          >
            {routeLetter(index)}
          </span>
        )
      })}
    </div>
  )
}

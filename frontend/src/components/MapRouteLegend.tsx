import { routeColor } from '../lib/risk'
import { routeRoles } from '../lib/routeMeta'
import type { PlanResponse } from '../types'

interface MapRouteLegendProps {
  plan: PlanResponse
  selectedRouteId: string | null
  onSelect: (routeId: string) => void
}

export function MapRouteLegend({ plan, selectedRouteId, onSelect }: MapRouteLegendProps) {
  const roles = routeRoles(plan)

  return (
    <div className="map-route-legend">
      <span>Routes</span>
      {plan.routes.map((route, index) => {
        const recommended = route.id === plan.recommendation.route_id
        const label = recommended
          ? `Route ${index + 1} (Recommended)`
          : `Route ${index + 1}`
        return (
          <button
            key={route.id}
            type="button"
            className={route.id === selectedRouteId ? 'map-route-item active' : 'map-route-item'}
            onClick={() => onSelect(route.id)}
          >
            <i style={{ background: routeColor(index) }} />
            {label}
            <small>{roles[route.id]}</small>
          </button>
        )
      })}
    </div>
  )
}

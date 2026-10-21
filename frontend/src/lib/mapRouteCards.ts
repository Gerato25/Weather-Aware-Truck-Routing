import { Marker, type Map as MapLibreMap } from 'maplibre-gl'

import { formatClock, formatDuration, formatMiles } from './format'
import { RISK_COLORS } from './risk'
import { routeLetter } from './routeMeta'
import { truckAtHour } from './truckAtHour'
import type { Route } from '../types'

import './mapRouteCards.css'

function alongFraction(route: Route, fraction: number): [number, number] {
  const hours = route.summary.duration_hours * fraction
  const truck = truckAtHour(route, hours)
  if (truck) return [truck.lon, truck.lat]
  const coords = route.geometry.coordinates
  const index = Math.min(coords.length - 1, Math.max(0, Math.round((coords.length - 1) * fraction)))
  return coords[index]
}

function cardHtml(route: Route, index: number, recommended: boolean): string {
  const letter = routeLetter(index)
  const severe = Math.round(route.summary.miles_by_level.SEVERE + route.summary.miles_by_level.NO_TRAVEL)
  const high = Math.round(route.summary.miles_by_level.HIGH)
  const low = Math.round(route.summary.miles_by_level.LOW)
  const riskLine = `<p class="map-route-card-risk"><span style="color:${RISK_COLORS.LOW}">Low ${low} mi</span> · <span style="color:${RISK_COLORS.HIGH}">High ${high} mi</span> · <span style="color:${RISK_COLORS.SEVERE}">Severe+ ${severe} mi</span></p>`
  if (recommended) {
    return `
      <p class="map-route-card-kicker">Recommended</p>
      <p class="map-route-card-title">Route ${letter}</p>
      <p class="map-route-card-line">${formatDuration(route.summary.duration_hours)} · ${formatMiles(route.summary.distance_miles)}</p>
      <p class="map-route-card-line">Arrive ${formatClock(route.summary.arrival)}</p>
      ${riskLine}
    `
  }
  return `
    <p class="map-route-card-title">Route ${letter}</p>
    <p class="map-route-card-line">${formatDuration(route.summary.duration_hours)} · ${formatMiles(route.summary.distance_miles)}</p>
    ${riskLine}
  `
}

export function syncRouteCardMarkers(
  map: MapLibreMap,
  markers: Marker[],
  routes: Route[],
  recommendedId: string | null,
  selectedId: string | null,
  hiddenIds: Set<string>,
  onSelect: (routeId: string) => void,
): Marker[] {
  markers.forEach((marker) => marker.remove())
  if (!routes.length) return []

  return routes.flatMap((route, index) => {
    if (hiddenIds.has(route.id)) return []
    const recommended = route.id === recommendedId
    const el = document.createElement('button')
    el.type = 'button'
    el.className = `map-route-card ${recommended ? 'is-full' : 'is-compact'}${route.id === selectedId ? ' is-selected' : ''}`
    el.innerHTML = cardHtml(route, index, recommended)
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      onSelect(route.id)
    })
    const [lon, lat] = alongFraction(route, recommended ? 0.58 : 0.42 + index * 0.08)
    const marker = new Marker({ element: el, anchor: 'center', offset: [0, index === 0 ? -18 : 18] })
    marker.setLngLat([lon, lat]).addTo(map)
    return [marker]
  })
}

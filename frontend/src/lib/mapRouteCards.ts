import { Marker, type Map as MapLibreMap } from 'maplibre-gl'

import { formatClock, formatDuration, formatMiles } from './format'
import { RISK_COLORS } from './risk'
import { routeLetter } from './routeMeta'
import { truckAtHour } from './truckAtHour'
import type { Route } from '../types'

import './mapRouteCards.css'

const CARD_FRACTIONS = [0.22, 0.5, 0.78]
const CARD_OFFSETS: Array<{ anchor: 'bottom' | 'left' | 'top'; offset: [number, number] }> = [
  { anchor: 'bottom', offset: [-8, -18] },
  { anchor: 'left', offset: [22, 0] },
  { anchor: 'top', offset: [8, 18] },
]
const MIN_SEP_DEG = 0.55

function alongFraction(route: Route, fraction: number): [number, number] {
  const hours = route.summary.duration_hours * fraction
  const truck = truckAtHour(route, hours)
  if (truck) return [truck.lon, truck.lat]
  const coords = route.geometry.coordinates
  const index = Math.min(coords.length - 1, Math.max(0, Math.round((coords.length - 1) * fraction)))
  return coords[index]
}

function farEnough(point: [number, number], taken: [number, number][]): boolean {
  return taken.every(([lon, lat]) => {
    const dx = point[0] - lon
    const dy = point[1] - lat
    return dx * dx + dy * dy >= MIN_SEP_DEG * MIN_SEP_DEG
  })
}

function placeCard(route: Route, index: number, taken: [number, number][]): [number, number] {
  const start = CARD_FRACTIONS[index % CARD_FRACTIONS.length] ?? 0.5
  const tries = [start, start + 0.16, start - 0.16, start + 0.28, start - 0.28, 0.18, 0.62, 0.84]
  for (const raw of tries) {
    const fraction = Math.min(0.88, Math.max(0.14, raw))
    const point = alongFraction(route, fraction)
    if (farEnough(point, taken)) return point
  }
  return alongFraction(route, start)
}

function cardHtml(route: Route, index: number, recommended: boolean, expanded: boolean): string {
  const letter = routeLetter(index)
  const summary = `${formatDuration(route.summary.duration_hours)} · ${formatMiles(route.summary.distance_miles)}`
  if (!expanded) {
    return `<p class="map-route-card-title">${recommended ? 'Rec · ' : ''}Route ${letter} · ${summary}</p>`
  }
  const severe = Math.round(route.summary.miles_by_level.SEVERE + route.summary.miles_by_level.NO_TRAVEL)
  const high = Math.round(route.summary.miles_by_level.HIGH)
  const low = Math.round(route.summary.miles_by_level.LOW)
  return `
    ${recommended ? '<p class="map-route-card-kicker">Recommended</p>' : ''}
    <p class="map-route-card-title">Route ${letter}</p>
    <p class="map-route-card-line">${summary}</p>
    <p class="map-route-card-line">Arrive ${formatClock(route.summary.arrival)}</p>
    <p class="map-route-card-risk"><span style="color:${RISK_COLORS.LOW}">Low ${low}</span> · <span style="color:${RISK_COLORS.HIGH}">High ${high}</span> · <span style="color:${RISK_COLORS.SEVERE}">Sev ${severe}</span></p>
  `
}

let expandedRouteId: string | null = null
let expandedForRoutes = ''

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

  const routeKey = routes.map((route) => route.id).join('|')
  if (routeKey !== expandedForRoutes) {
    expandedForRoutes = routeKey
    expandedRouteId = null
  }

  const taken: [number, number][] = []
  return routes.flatMap((route, index) => {
    if (hiddenIds.has(route.id)) return []
    const recommended = route.id === recommendedId
    const expanded = route.id === expandedRouteId
    const el = document.createElement('button')
    el.type = 'button'
    el.className = `map-route-card${expanded ? ' is-full' : ' is-compact'}${route.id === selectedId ? ' is-selected' : ''}`
    el.innerHTML = cardHtml(route, index, recommended, expanded)
    el.dataset.collapsedHtml = cardHtml(route, index, recommended, false)
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      expandedRouteId = expandedRouteId === route.id ? null : route.id
      const nowExpanded = expandedRouteId === route.id
      document.querySelectorAll<HTMLElement>('.map-route-card').forEach((card) => {
        if (card === el) return
        card.classList.remove('is-full', 'is-selected')
        card.classList.add('is-compact')
        if (card.dataset.collapsedHtml) card.innerHTML = card.dataset.collapsedHtml
      })
      el.className = `map-route-card${nowExpanded ? ' is-full' : ' is-compact'} is-selected`
      el.innerHTML = cardHtml(route, index, recommended, nowExpanded)
      onSelect(route.id)
    })
    const point = placeCard(route, index, taken)
    taken.push(point)
    const place = CARD_OFFSETS[index % CARD_OFFSETS.length] ?? CARD_OFFSETS[1]
    const marker = new Marker({ element: el, anchor: place.anchor, offset: place.offset })
    marker.setLngLat(point).addTo(map)
    return [marker]
  })
}

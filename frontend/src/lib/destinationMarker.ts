import { Marker, type Map as MapLibreMap } from 'maplibre-gl'

import { shortPlaceName } from './format'
import type { Place, Route } from '../types'

import './destinationMarker.css'

export function syncDestinationMarker(
  map: MapLibreMap,
  marker: Marker | null,
  destination: Place | null,
  routes: Route[],
  selectedRouteId: string | null,
  hour: number,
): Marker | null {
  if (!destination) {
    marker?.remove()
    return null
  }

  let next = marker
  if (!next) {
    const el = document.createElement('div')
    el.className = 'dest-marker'
    el.innerHTML = `
      <div class="dest-pin" aria-hidden="true">
        <span class="dest-pin-pulse"></span>
        <span class="dest-pin-flag">🚩</span>
      </div>
      <div class="dest-card"></div>
    `
    next = new Marker({ element: el, anchor: 'bottom', offset: [8, 4] })
    next.setLngLat([destination.lon, destination.lat]).addTo(map)
  } else {
    next.setLngLat([destination.lon, destination.lat])
    if (!next.getElement().isConnected) next.addTo(map)
  }

  const el = next.getElement()
  const city = shortPlaceName(destination.label)
  const selected = routes.find((route) => route.id === selectedRouteId)
  const arrived = Boolean(selected && hour + 1e-6 >= selected.summary.duration_hours)
  el.classList.toggle('is-arrived', arrived)
  const card = el.querySelector('.dest-card')
  if (card) {
    card.innerHTML = arrived
      ? `<p class="dest-card-title">Arrived · ${city}</p>`
      : `<p class="dest-card-title">${city}</p>`
  }
  return next
}

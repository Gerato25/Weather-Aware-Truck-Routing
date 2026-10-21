import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { Feature, FeatureCollection, Point } from 'geojson'
import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  type LngLatBoundsLike,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'

import { CAUSE_ICONS, registerCauseIcons, registerRouteBadges, type CauseKind } from '../lib/causeIcons'
import {
  WX_ARROW_LAYER,
  WX_ARROW_SOURCE,
  WIND_ICON_ROTATE,
  areaArrowGeoJSON,
  hourFilter,
  overlayFromHeatLayers,
  type OverlayMode,
} from '../lib/corridorHeat'
import { addWeatherRaster, type WeatherRasterHandle } from '../map/weatherRaster'
import { syncDestinationMarker } from '../lib/destinationMarker'
import { syncRouteCardMarkers } from '../lib/mapRouteCards'
import { setWeatherHour } from '../lib/weatherArea'
import { corridorSampleAt } from '../lib/corridorHour'
import { compassFromDeg, formatClock, formatEtaRelative, formatForecastStamp } from '../lib/format'
import { truckAtHour } from '../lib/truckAtHour'
import {
  OM_LAYER_IDS,
  OM_SOURCE_IDS,
  fetchOmValidTimes,
  omTileUrl,
  timeStepForHour,
} from '../lib/omWeather'
import {
  HEAT_LAYER_KEYS,
  HIDDEN_HEAT_LAYERS,
  RISK_COLORS,
  riskColor,
  routeColor,
  routeLineColor,
  type HeatLayers,
} from '../lib/risk'
import { routeLetter } from '../lib/routeMeta'
import { MAP_STYLES, type Theme } from '../lib/theme'
import type { Checkpoint, CorridorResponse, Place, Route } from '../types'

import 'maplibre-gl/dist/maplibre-gl.css'

const SOURCES = {
  routes: 'routes',
  routeLabels: 'route-labels',
  checkpoints: 'checkpoints',
  callouts: 'callouts',
  endpoints: 'endpoints',
  truck: 'truck',
  etaLabels: 'eta-labels',
} as const

const LAYERS = {
  etaLabel: 'eta-label',
  routeCasing: 'route-casing',
  routeLine: 'route-line',
  routeLabel: 'route-label',
  checkpointHalo: 'checkpoint-halo',
  checkpointDot: 'checkpoint-dot',
  checkpointElevated: 'checkpoint-elevated',
  checkpointCause: 'checkpoint-cause',
  checkpointWind: 'checkpoint-wind',
  callout: 'callout',
  endpointDot: 'endpoint-dot',
  endpointLabel: 'endpoint-label',
  truckHalo: 'truck-halo',
  truckDot: 'truck-dot',
  truckLabel: 'truck-label',
} as const

const CHECKPOINT_HIT_LAYERS = [
  LAYERS.checkpointDot,
  LAYERS.checkpointElevated,
  LAYERS.checkpointCause,
  LAYERS.checkpointWind,
] as const

const CALLOUT_MIN_SCORE = 2
const DETAIL_MIN_ZOOM = 6.5

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }

const POPUP_OPTIONS = {
  closeButton: true,
  className: 'checkpoint-popup',
  maxWidth: '320px',
  offset: 12,
} as const

export interface CheckpointRef {
  routeId: string
  index: number
}

interface MapViewProps {
  theme: Theme
  routes: Route[]
  selectedRouteId: string | null
  recommendedRouteId: string | null
  origin: Place | null
  destination: Place | null
  corridor?: CorridorResponse | null
  heatHour: number
  heatLayers?: HeatLayers
  overlayMode?: OverlayMode
  focused: CheckpointRef | null
  panToFocused?: boolean
  hiddenRouteIds?: string[]
  basemap?: 'map' | 'satellite'
  hideEmpty?: boolean
  worldView?: boolean
  className?: string
  weatherRaster?: boolean
  rasterOpacity?: number
  showJump?: boolean
  loadLb?: number
  departureIso?: string | null
  onSelectRoute: (routeId: string) => void
  onFocusCheckpoint: (ref: CheckpointRef | null) => void
  onWeatherCatalog?: (available: boolean) => void
}

/** Risk level -> colour, as a MapLibre `match` expression. */
const riskColorExpression: ExpressionSpecification = [
  'match',
  ['get', 'level'],
  'LOW',
  RISK_COLORS.LOW,
  'MODERATE',
  RISK_COLORS.MODERATE,
  'HIGH',
  RISK_COLORS.HIGH,
  'SEVERE',
  RISK_COLORS.SEVERE,
  'NO_TRAVEL',
  RISK_COLORS.NO_TRAVEL,
  'UNKNOWN',
  RISK_COLORS.UNKNOWN,
  RISK_COLORS.UNKNOWN,
]

function nearestCoordIndex(coords: [number, number][], lon: number, lat: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < coords.length; i += 1) {
    const dx = coords[i][0] - lon
    const dy = coords[i][1] - lat
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

function segmentCoordinates(
  coords: [number, number][],
  from: Checkpoint,
  to: Checkpoint,
): [number, number][] {
  if (coords.length < 2) return [[from.lon, from.lat], [to.lon, to.lat]]
  let start = nearestCoordIndex(coords, from.lon, from.lat)
  let end = nearestCoordIndex(coords, to.lon, to.lat)
  if (end < start) [start, end] = [end, start]
  const slice = coords.slice(start, end + 1)
  return slice.length >= 2 ? slice : [[from.lon, from.lat], [to.lon, to.lat]]
}

function routesToGeoJSON(
  routes: Route[],
  selectedRouteId: string | null,
  hiddenIds: Set<string>,
  theme: Theme = 'light',
): FeatureCollection {
  const features: Feature[] = []
  routes.forEach((route, index) => {
    if (hiddenIds.has(route.id)) return
    const selected = route.id === selectedRouteId
    const identity = routeColor(index, theme)
    const line = routeLineColor(index, theme, selected)
    const checkpoints = route.checkpoints
    if (checkpoints.length < 2) {
      features.push({
        type: 'Feature',
        geometry: route.geometry,
        properties: {
          routeId: route.id,
          label: route.label,
          letter: routeLetter(index),
          color: line,
          identity,
          selected,
        },
      })
      return
    }
    for (let i = 0; i < checkpoints.length - 1; i += 1) {
      const from = checkpoints[i]
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: segmentCoordinates(route.geometry.coordinates, from, checkpoints[i + 1]),
        },
        properties: {
          routeId: route.id,
          label: route.label,
          letter: routeLetter(index),
          color: line,
          identity,
          selected,
        },
      })
    }
  })
  features.sort(
    (a, b) => Number(a.properties?.selected ?? false) - Number(b.properties?.selected ?? false),
  )
  return { type: 'FeatureCollection', features }
}

function alongLine(coords: [number, number][], t: number): [number, number] {
  if (coords.length === 1) return coords[0]
  const f = Math.min(1, Math.max(0, t)) * (coords.length - 1)
  const i = Math.min(coords.length - 2, Math.floor(f))
  const frac = f - i
  const a = coords[i]
  const b = coords[i + 1]
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]
}

function routeLabelsToGeoJSON(
  routes: Route[],
  hiddenIds: Set<string>,
  theme: Theme = 'light',
): FeatureCollection {
  const features: Feature[] = []
  const fractions = [0.14, 0.38, 0.62, 0.86]
  routes.forEach((route, index) => {
    if (hiddenIds.has(route.id)) return
    const coords = route.geometry.coordinates
    if (!coords.length) return
    const letter = routeLetter(index)
    const color = routeColor(index, theme)
    const latShift = (index - 1) * 0.16
    for (const t of fractions) {
      const [lon, lat] = alongLine(coords, t)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat + latShift] },
        properties: { letter, color },
      })
    }
  })
  return { type: 'FeatureCollection', features }
}

function checkpointName(route: Route, cp: Checkpoint, origin: Place | null, destination: Place | null) {
  if (cp.index === 0) return `${origin?.label.split(',')[0]?.trim() || 'Start'} (Start)`
  if (cp.index === route.checkpoints.length - 1) {
    return `${destination?.label.split(',')[0]?.trim() || 'End'} (End)`
  }
  return `Mile ${Math.round(cp.mile)}`
}

function bandLevel(value: number | null | undefined, edges: number[]): number {
  if (value == null || !Number.isFinite(value)) return -1
  for (let i = 0; i < edges.length; i += 1) {
    if (value < edges[i]) return i
  }
  return edges.length
}

function causeFromValues(
  wind: number | null | undefined,
  rain: number | null | undefined,
  snow: number | null | undefined,
): CauseKind | '' {
  const windLevel = bandLevel(wind, [25, 35, 45, 55])
  const rainLevel = rain == null ? -1 : rain <= 0.1 ? (rain < 0.1 ? 0 : 1) : rain <= 0.25 ? 1 : rain <= 0.5 ? 2 : rain <= 1 ? 3 : 4
  const snowLevel = snow == null ? -1 : snow < 0.5 ? 0 : snow <= 1 ? 1 : snow <= 2 ? 2 : snow <= 3 ? 3 : 4
  const peak = Math.max(windLevel, rainLevel, snowLevel)
  if (peak < 1) return ''
  if (windLevel === peak) return 'wind'
  if (rainLevel === peak) return 'rain'
  if (snowLevel === peak) return 'snow'
  return ''
}

function etaCause(cp: Checkpoint): CauseKind | '' {
  const driver = cp.risk.driver
  if (driver === 'wind' || driver === 'rain' || driver === 'snow') return driver
  return causeFromValues(cp.risk.wind_used_mph ?? cp.weather.wind_mph, cp.weather.rain_in_hr, cp.weather.snow_in_hr)
}

function calloutCauseLine(cp: Checkpoint, loadLb: number): string {
  const cause = etaCause(cp)
  if (cause === 'wind') {
    const mph = Math.round(cp.risk.wind_used_mph ?? cp.weather.wind_mph ?? 0)
    const dir = cp.weather.wind_dir ?? compassFromDeg(cp.weather.wind_dir_deg) ?? ''
    const kLb = Math.round(loadLb / 1000)
    return `${mph} mph ${dir} wind, ${kLb}k lb`.replace(/\s+/g, ' ').trim()
  }
  if (cause === 'rain') return `Rain ${(cp.weather.rain_in_hr ?? 0).toFixed(2)} in/hr`
  if (cause === 'snow') return `Snow ${(cp.weather.snow_in_hr ?? 0).toFixed(1)} in/hr`
  return cp.risk.reasons[0] ?? cp.risk.label
}

function milesAtLeast(route: Route, minScore: number): number {
  return route.checkpoints.reduce((sum, cp) => {
    if (cp.risk.available === false || cp.risk.score < minScore) return sum
    return sum + cp.segment_miles
  }, 0)
}

function longestRunMiles(route: Route, minScore: number): number {
  let best = 0
  let current = 0
  for (const cp of route.checkpoints) {
    if (cp.risk.available !== false && cp.risk.score >= minScore) {
      current += cp.segment_miles
      best = Math.max(best, current)
    } else {
      current = 0
    }
  }
  return best
}

function worstStretchCallout(route: Route, letter: string, loadLb: number): Feature | null {
  const candidates = route.checkpoints.filter((cp) => cp.risk.available !== false && cp.risk.score >= CALLOUT_MIN_SCORE)
  if (!candidates.length) return null
  const worst = candidates.reduce((lead, cp) => {
    if (cp.risk.score !== lead.risk.score) return cp.risk.score > lead.risk.score ? cp : lead
    const wind = cp.risk.wind_used_mph ?? 0
    const leadWind = lead.risk.wind_used_mph ?? 0
    if (wind !== leadWind) return wind > leadWind ? cp : lead
    return cp.mile < lead.mile ? cp : lead
  })
  const billed =
    worst.risk.level === 'UNKNOWN' ? undefined : route.summary.miles_by_level[worst.risk.level]
  const total = Math.round(billed ?? milesAtLeast(route, worst.risk.score))
  const run = Math.round(longestRunMiles(route, worst.risk.score))
  const stretch =
    run > 0 && run + 40 < total
      ? `worst stretch ${run} mi · ${total} mi total`
      : `${total} mi ${worst.risk.label}`
  const label = `${letter} · ${stretch} · ${calloutCauseLine(worst, loadLb)}`
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [worst.lon, worst.lat] },
    properties: { routeId: route.id, label, level: worst.risk.level, letter },
  }
}

function checkpointsToGeoJSON(
  routes: Route[],
  selectedRouteId: string | null,
  hiddenIds: Set<string>,
  theme: Theme = 'light',
  corridor: CorridorResponse | null = null,
  hour = 0,
): FeatureCollection {
  const features: Feature[] = []
  routes.forEach((route, index) => {
    if (hiddenIds.has(route.id)) return
    const selected = route.id === selectedRouteId
    const identity = routeColor(index, theme)
    for (const cp of route.checkpoints) {
      const overlay = corridor ? corridorSampleAt(corridor, cp.lon, cp.lat, hour) : null
      const cause = overlay
        ? overlay.cause === 'wind' || overlay.cause === 'rain' || overlay.cause === 'snow'
          ? overlay.cause
          : causeFromValues(overlay.wind, overlay.rain, overlay.snow)
        : etaCause(cp)
      const elevated = overlay
        ? cause !== '' && (overlay.risk ?? 0) >= 1
          ? 1
          : 0
        : cp.risk.available !== false && cp.risk.score >= 1 && cp.risk.level !== 'LOW'
          ? 1
          : 0
      const windDir = overlay?.windDir ?? cp.weather.wind_dir_deg ?? 0
      const hasDir = (overlay?.windDir != null ? 1 : 0) || (cp.weather.wind_dir_deg != null ? 1 : 0)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cp.lon, cp.lat] },
        properties: {
          routeId: route.id,
          index: cp.index,
          level: overlay?.level ?? cp.risk.level,
          score: overlay?.risk ?? cp.risk.score,
          selected,
          elevated,
          cause: elevated ? cause : '',
          identity,
          windDir,
          hasDir,
        },
      })
    }
  })
  return { type: 'FeatureCollection', features }
}

function calloutsToGeoJSON(
  routes: Route[],
  hiddenIds: Set<string>,
  loadLb: number,
): FeatureCollection {
  const features: Feature[] = []
  routes.forEach((route, index) => {
    if (hiddenIds.has(route.id)) return
    const feature = worstStretchCallout(route, routeLetter(index), loadLb)
    if (feature) features.push(feature)
  })
  return { type: 'FeatureCollection', features }
}

function endpointsToGeoJSON(origin: Place | null): FeatureCollection {
  const features: Feature[] = []
  if (origin) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [origin.lon, origin.lat] },
      properties: { kind: origin.label.split(',')[0]?.trim() || 'Origin', color: '#94a3b8' },
    })
  }
  return { type: 'FeatureCollection', features }
}

function popupNumber(value: number | null | undefined, digits: number, suffix: string): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}${suffix}`
}

function checkpointPopupHtml(
  cp: Checkpoint,
  name?: string,
  overlay?: ReturnType<typeof corridorSampleAt>,
  hour?: number,
  overlayAt?: string | null,
  loadLb?: number,
  departureIso?: string | null,
): string {
  const { weather, risk } = cp
  const title = name || `Mile ${Math.round(cp.mile)}`
  const etaWind = popupNumber(weather.wind_mph, 0, ' mph')
  const etaGusts =
    weather.wind_gust_mph == null || Number.isNaN(weather.wind_gust_mph)
      ? ''
      : ` / gusts ${Math.round(weather.wind_gust_mph)}`
  const dir = weather.wind_dir ?? compassFromDeg(weather.wind_dir_deg)
  const etaRelative = formatEtaRelative(cp.eta, departureIso)
  const loadRule = risk.reasons.find((reason) => /load/i.test(reason))
  const reason = risk.reasons[0]
    ? escapeHtml(risk.reasons[0])
    : risk.available === false
      ? 'Weather data was unavailable; this checkpoint was not scored as Low.'
      : 'All conditions within Low thresholds.'

  const overlayStamp =
    overlayAt && Number.isFinite(hour)
      ? `+${hour}h · ${escapeHtml(formatForecastStamp(overlayAt))}`
      : Number.isFinite(hour)
        ? `+${hour}h`
        : 'this hour'
  const overlayDir = overlay?.windDir != null ? compassFromDeg(overlay.windDir) : null
  const overlayRows = overlay
    ? `
      <p class="popup-overlay-label">Forecast at this location at ${overlayStamp}</p>
      <dl class="popup-grid">
        <div><dt>Wind</dt><dd>${popupNumber(overlay.wind, 0, ' mph')}${overlayDir ? ` ${escapeHtml(overlayDir)}` : ''}</dd></div>
        <div><dt>Rain</dt><dd>${popupNumber(overlay.rain, 2, ' in/hr')}</dd></div>
        <div><dt>Snow</dt><dd>${popupNumber(overlay.snow, 1, ' in/hr')}</dd></div>
        <div><dt>Temp</dt><dd>${popupNumber(overlay.temp, 0, '°F')}</dd></div>
      </dl>
    `
    : ''

  const loadLine =
    loadRule && loadLb
      ? `<span>Load rule: ${escapeHtml(loadRule)}</span>`
      : loadLb
        ? `<span>Load: ${Math.round(loadLb).toLocaleString()} lb</span>`
        : ''

  return `
    <div class="popup">
      <div class="popup-head" style="--level-color:${riskColor(overlay?.level ?? risk.level)}">
        <span class="popup-mile">${escapeHtml(title)}</span>
      </div>
      ${overlayRows}
      <p class="popup-overlay-label">ETA ${escapeHtml(etaRelative ?? formatClock(cp.eta))} · ${escapeHtml(formatClock(cp.eta))}</p>
      <dl class="popup-grid">
        <div><dt>Wind</dt><dd>${etaWind}${etaWind === '—' ? '' : etaGusts}${dir ? ` ${escapeHtml(dir)}` : ''}</dd></div>
        <div><dt>Rain</dt><dd>${popupNumber(weather.rain_in_hr, 2, ' in/hr')}</dd></div>
        <div><dt>Snow</dt><dd>${popupNumber(weather.snow_in_hr, 1, ' in/hr')}</dd></div>
        <div><dt>Risk</dt><dd>${escapeHtml(risk.label)}</dd></div>
      </dl>
      <p class="popup-risk" style="--level-color:${riskColor(risk.level)}">
        <strong>ETA risk: ${escapeHtml(risk.label)}</strong>
        <span>Reason: ${reason}</span>
        ${loadLine}
      </p>
    </div>
  `
}

function etaLabelsToGeoJSON(route: Route | null): FeatureCollection {
  if (!route) return EMPTY_COLLECTION
  const duration = route.summary.duration_hours
  const features: Feature[] = []
  for (let hour = 2; hour < duration - 0.15; hour += 2) {
    const truck = truckAtHour(route, hour)
    if (!truck || truck.arrived) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [truck.lon, truck.lat] },
      properties: { label: `+${hour}h`, hour },
    })
  }
  return { type: 'FeatureCollection', features }
}

function truckToGeoJSON(route: Route | null, hour: number): FeatureCollection {
  const truck = truckAtHour(route, hour)
  if (!truck) return EMPTY_COLLECTION
  const label = truck.arrived ? 'Arrived' : `+${hour}h · mi ${Math.round(truck.mile)}`
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [truck.lon, truck.lat] },
        properties: { label },
      },
    ],
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  )
}

function tuneDarkBasemap(map: MapLibreMap) {
  // OpenFreeMap dark's background is ~#0c0c0c, which looks like a blank canvas.
  const style = map.getStyle()
  for (const layer of style.layers ?? []) {
    if (layer.type === 'background') {
      map.setPaintProperty(layer.id, 'background-color', '#0a0c10')
    }
  }
}

function addLayer(map: MapLibreMap, layer: Parameters<MapLibreMap['addLayer']>[0]) {
  if (!map.getLayer(layer.id)) map.addLayer(layer)
}

function installWeatherRasters(map: MapLibreMap, timeStep: string) {
  for (const metric of HEAT_LAYER_KEYS) {
    const sourceId = OM_SOURCE_IDS[metric]
    const layerId = OM_LAYER_IDS[metric]
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'raster', url: omTileUrl(metric, timeStep) })
    }
    addLayer(map, {
      id: layerId,
      type: 'raster',
      source: sourceId,
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.38, 'raster-fade-duration': 0 },
    })
  }
}

/** Creates every source and layer once, in bottom-to-top draw order. */
function installLayers(map: MapLibreMap, theme: Theme, mode: OverlayMode) {
  installWeatherRasters(map, 'current_time_1H')
  registerCauseIcons(map)
  registerRouteBadges(map, theme)
  for (const name of Object.values(SOURCES)) {
    if (!map.getSource(name)) {
      map.addSource(name, { type: 'geojson', data: EMPTY_COLLECTION })
    }
  }
  if (!map.getSource(WX_ARROW_SOURCE)) {
    map.addSource(WX_ARROW_SOURCE, { type: 'geojson', data: EMPTY_COLLECTION })
  }
  addLayer(map, {
    id: WX_ARROW_LAYER,
    type: 'symbol',
    source: WX_ARROW_SOURCE,
    filter: hourFilter(0),
    layout: {
      visibility: mode === 'off' ? 'none' : 'visible',
      'icon-image': CAUSE_ICONS.wind,
      'icon-rotate': WIND_ICON_ROTATE,
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-padding': 6,
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        ['interpolate', ['linear'], ['get', 'wind'], 6, 0.16, 15, 0.24, 25, 0.34, 45, 0.5, 58, 0.68],
        11,
        ['interpolate', ['linear'], ['get', 'wind'], 6, 0.26, 15, 0.38, 25, 0.52, 45, 0.76, 58, 0.98],
      ],
    },
    paint: {
      'icon-color': [
        'interpolate',
        ['linear'],
        ['get', 'wind'],
        6,
        theme === 'light' ? '#cbd5e1' : '#64748b',
        18,
        theme === 'light' ? '#94a3b8' : '#94a3b8',
        32,
        theme === 'light' ? '#475569' : '#e2e8f0',
        50,
        theme === 'light' ? '#1e293b' : '#f8fafc',
      ],
      'icon-halo-color': theme === 'light' ? '#ffffff' : '#020617',
      'icon-halo-width': 0.6,
      'icon-opacity': ['interpolate', ['linear'], ['get', 'wind'], 6, 0.45, 20, 0.75, 40, 1],
    },
  })

  addLayer(map, {
    id: LAYERS.routeCasing,
    type: 'line',
    source: SOURCES.routes,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': theme === 'light' ? '#ffffff' : '#0f172a',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        ['case', ['get', 'selected'], 10, 7],
        10,
        ['case', ['get', 'selected'], 15, 11],
      ],
      'line-opacity': theme === 'light' ? 0.95 : 0.8,
    },
  })

  addLayer(map, {
    id: LAYERS.routeLine,
    type: 'line',
    source: SOURCES.routes,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        ['case', ['get', 'selected'], 5.5, 3.8],
        10,
        ['case', ['get', 'selected'], 9, 6],
      ],
      'line-opacity': 1,
    },
  })

  addLayer(map, {
    id: LAYERS.checkpointHalo,
    type: 'circle',
    source: SOURCES.checkpoints,
    filter: ['==', ['get', 'elevated'], 1],
    paint: {
      'circle-color': riskColorExpression,
      'circle-opacity': [
        'case',
        ['all', ['get', 'selected'], ['>', ['get', 'score'], 1]],
        0.22,
        0,
      ],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 24],
    },
  })

  addLayer(map, {
    id: LAYERS.checkpointDot,
    type: 'circle',
    source: SOURCES.checkpoints,
    filter: ['==', ['get', 'elevated'], 0],
    paint: {
      'circle-color': theme === 'light' ? '#ffffff' : '#ecfdf5',
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        ['case', ['get', 'selected'], 4.4, 3.2],
        11,
        ['case', ['get', 'selected'], 6.8, 5],
      ],
      'circle-opacity': ['case', ['get', 'selected'], 1, 0.92],
      'circle-stroke-width': ['case', ['get', 'selected'], 2.2, 1.6],
      'circle-stroke-color': theme === 'light' ? riskColorExpression : ['get', 'identity'],
    },
  })

  addLayer(map, {
    id: LAYERS.checkpointElevated,
    type: 'circle',
    source: SOURCES.checkpoints,
    filter: ['==', ['get', 'elevated'], 1],
    paint: {
      'circle-color': riskColorExpression,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        ['case', ['get', 'selected'], 8, 6.5],
        11,
        ['case', ['get', 'selected'], 12, 10],
      ],
      'circle-opacity': 1,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })

  addLayer(map, {
    id: LAYERS.checkpointCause,
    type: 'symbol',
    source: SOURCES.checkpoints,
    filter: ['all', ['==', ['get', 'elevated'], 1], ['in', ['get', 'cause'], ['literal', ['wind', 'rain', 'snow']]]],
    layout: {
      'icon-image': ['get', 'cause'],
      'icon-rotate': [
        'case',
        ['==', ['get', 'cause'], 'wind'],
        WIND_ICON_ROTATE,
        0,
      ],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.42, 11, 0.7],
    },
    paint: {
      'icon-color': '#ffffff',
    },
  })

  addLayer(map, {
    id: LAYERS.checkpointWind,
    type: 'symbol',
    source: SOURCES.checkpoints,
    minzoom: DETAIL_MIN_ZOOM,
    filter: ['all', ['==', ['get', 'elevated'], 0], ['==', ['get', 'hasDir'], 1]],
    layout: {
      'icon-image': CAUSE_ICONS.wind,
      'icon-rotate': WIND_ICON_ROTATE,
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 6.5, 0.38, 11, 0.55],
    },
    paint: {
      'icon-color': theme === 'light' ? '#334155' : '#cbd5e1',
      'icon-halo-color': theme === 'light' ? '#ffffff' : '#020617',
      'icon-halo-width': 0.8,
    },
  })

  addLayer(map, {
    id: LAYERS.endpointDot,
    type: 'circle',
    source: SOURCES.endpoints,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4.2, 10, 6],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  })

  addLayer(map, {
    id: LAYERS.endpointLabel,
    type: 'symbol',
    source: SOURCES.endpoints,
    layout: {
      'text-field': ['get', 'kind'],
      'text-size': 10,
      'text-offset': [0, 1.15],
      'text-anchor': 'top',
    },
    paint: {
      'text-color': theme === 'light' ? '#0f172a' : '#e2e8f0',
      'text-halo-color': theme === 'light' ? '#ffffff' : '#020617',
      'text-halo-width': 1.4,
    },
  })

  addLayer(map, {
    id: LAYERS.truckHalo,
    type: 'circle',
    source: SOURCES.truck,
    paint: {
      'circle-color': '#fbbf24',
      'circle-opacity': 0.28,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 12, 10, 22],
    },
  })
  addLayer(map, {
    id: LAYERS.truckDot,
    type: 'circle',
    source: SOURCES.truck,
    paint: {
      'circle-color': '#0b1f3a',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 9],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#fbbf24',
    },
  })
  addLayer(map, {
    id: LAYERS.truckLabel,
    type: 'symbol',
    source: SOURCES.truck,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-offset': [0, 1.35],
      'text-anchor': 'top',
    },
    paint: {
      'text-color': theme === 'light' ? '#0f172a' : '#f8fafc',
      'text-halo-color': theme === 'light' ? '#ffffff' : '#020617',
      'text-halo-width': 1.5,
    },
  })

  addLayer(map, {
    id: LAYERS.etaLabel,
    type: 'symbol',
    source: SOURCES.etaLabels,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-offset': [0, -1.15],
      'text-anchor': 'bottom',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': theme === 'light' ? '#0f172a' : '#f8fafc',
      'text-halo-color': theme === 'light' ? '#ffffff' : '#020617',
      'text-halo-width': 1.4,
      'text-opacity': 0.95,
    },
  })

  addLayer(map, {
    id: LAYERS.routeLabel,
    type: 'symbol',
    source: SOURCES.routeLabels,
    layout: {
      'icon-image': ['concat', 'route-', ['get', 'letter']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.62, 8, 0.82, 12, 0.7],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-anchor': 'center',
    },
  })

  if (map.getLayer(LAYERS.callout)) map.removeLayer(LAYERS.callout)
  addLayer(map, {
    id: LAYERS.callout,
    type: 'symbol',
    source: SOURCES.callouts,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-anchor': 'bottom',
      'text-offset': [
        'match',
        ['get', 'letter'],
        'A',
        ['literal', [2.4, -3.6]],
        'B',
        ['literal', [-1.8, -3.2]],
        'C',
        ['literal', [1.6, -4.8]],
        ['literal', [2.0, -3.4]],
      ],
      'text-max-width': 24,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': riskColorExpression,
      'text-halo-color': theme === 'light' ? '#ffffff' : '#07111c',
      'text-halo-width': 1.6,
    },
  })
}

interface InteractionHandlers {
  onCheckpointClick: (ref: CheckpointRef, coordinates: [number, number]) => void
  onCheckpointHover: (ref: CheckpointRef, coordinates: [number, number]) => void
  onCheckpointLeave: () => void
  onRouteClick: (routeId: string) => void
}

function installInteractions(map: MapLibreMap, handlers: InteractionHandlers) {
  const readRef = (event: MapLayerMouseEvent): { ref: CheckpointRef; coordinates: [number, number] } | null => {
    const feature = event.features?.[0]
    if (!feature) return null
    const { routeId, index } = feature.properties as Record<string, string>
    if (typeof routeId !== 'string') return null
    const coordinates = (feature.geometry as Point).coordinates as [number, number]
    return { ref: { routeId, index: Number(index) }, coordinates }
  }

  const openCheckpoint = (event: MapLayerMouseEvent) => {
    const hit = readRef(event)
    if (hit) handlers.onCheckpointClick(hit.ref, hit.coordinates)
  }

  const hoverCheckpoint = (event: MapLayerMouseEvent) => {
    const hit = readRef(event)
    if (hit) handlers.onCheckpointHover(hit.ref, hit.coordinates)
  }

  for (const layer of CHECKPOINT_HIT_LAYERS) {
    map.on('click', layer, openCheckpoint)
    map.on('mousemove', layer, hoverCheckpoint)
    map.on('mouseleave', layer, () => handlers.onCheckpointLeave())
  }

  map.on('click', LAYERS.routeLine, (event: MapLayerMouseEvent) => {
    const onCheckpoint = map.queryRenderedFeatures(event.point, {
      layers: [...CHECKPOINT_HIT_LAYERS],
    })
    if (onCheckpoint.length) return

    const routeId = event.features?.[0]?.properties?.routeId
    if (typeof routeId === 'string') handlers.onRouteClick(routeId)
  })

  for (const layer of [...CHECKPOINT_HIT_LAYERS, LAYERS.routeLine] as string[]) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
    })
  }
}

function boundsOf(routes: Route[], places: (Place | null)[]): LngLatBoundsLike | null {
  const bounds = new LngLatBounds()
  let extended = false

  for (const route of routes) {
    for (const coordinate of route.geometry.coordinates) {
      bounds.extend(coordinate)
      extended = true
    }
  }
  for (const place of places) {
    if (place) {
      bounds.extend([place.lon, place.lat])
      extended = true
    }
  }
  return extended ? bounds : null
}

export function MapView({
  theme,
  routes,
  selectedRouteId,
  recommendedRouteId,
  origin,
  destination,
  corridor = null,
  heatHour,
  heatLayers = HIDDEN_HEAT_LAYERS,
  overlayMode,
  focused,
  panToFocused = true,
  hiddenRouteIds = [],
  basemap = 'map',
  hideEmpty = false,
  worldView = false,
  className,
  weatherRaster = false,
  rasterOpacity = 0.38,
  showJump = true,
  loadLb = 0,
  departureIso = null,
  onSelectRoute,
  onFocusCheckpoint,
  onWeatherCatalog,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const popupPinnedRef = useRef(false)
  const destMarkerRef = useRef<Marker | null>(null)
  const routeCardMarkersRef = useRef<Marker[]>([])
  const wxRef = useRef<WeatherRasterHandle | null>(null)
  const hoverHideRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [styleEpoch, setStyleEpoch] = useState(0)
  const lastFitKey = useRef<string | null>(null)

  // Keep the latest callbacks reachable from listeners bound once on load.
  const selectRouteRef = useRef(onSelectRoute)
  const focusRef = useRef(onFocusCheckpoint)
  const weatherCatalogRef = useRef(onWeatherCatalog)
  useEffect(() => {
    selectRouteRef.current = onSelectRoute
    focusRef.current = onFocusCheckpoint
    weatherCatalogRef.current = onWeatherCatalog
  }, [onSelectRoute, onFocusCheckpoint, onWeatherCatalog])

  const hiddenIds = useMemo(() => new Set(hiddenRouteIds), [hiddenRouteIds])
  const mode = overlayMode ?? overlayFromHeatLayers(heatLayers)

  const routeData = useMemo(
    () => routesToGeoJSON(routes, selectedRouteId, hiddenIds, theme),
    [routes, selectedRouteId, hiddenIds, theme],
  )
  const routeLabelData = useMemo(
    () => routeLabelsToGeoJSON(routes, hiddenIds, theme),
    [routes, hiddenIds, theme],
  )
  const overlayHour = Math.round(heatHour)
  const checkpointData = useMemo(
    () => checkpointsToGeoJSON(routes, selectedRouteId, hiddenIds, theme, corridor, overlayHour),
    [routes, selectedRouteId, hiddenIds, theme, corridor, overlayHour],
  )
  const calloutData = useMemo(
    () => calloutsToGeoJSON(routes, hiddenIds, loadLb),
    [routes, hiddenIds, loadLb],
  )
  const endpointData = useMemo(() => endpointsToGeoJSON(origin), [origin])
  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  )
  const truckData = useMemo(
    () => truckToGeoJSON(selectedRoute, heatHour),
    [selectedRoute, heatHour],
  )
  const recommendedRoute = useMemo(
    () => routes.find((route) => route.id === recommendedRouteId) ?? null,
    [routes, recommendedRouteId],
  )
  const arrowData = useMemo(() => areaArrowGeoJSON(corridor), [corridor])
  const etaData = useMemo(() => etaLabelsToGeoJSON(recommendedRoute), [recommendedRoute])
  const [omTimes, setOmTimes] = useState<string[]>([])
  const themeRef = useRef(theme)
  const modeRef = useRef(mode)
  const hourRef = useRef(heatHour)
  const styleRef = useRef(MAP_STYLES[theme])
  const popupTargetRef = useRef<CheckpointRef | null>(null)
  const tripRef = useRef({ routes, origin, destination, corridor, heatHour, loadLb, departureIso })
  const dataRef = useRef({
    routeData,
    routeLabelData,
    checkpointData,
    calloutData,
    endpointData,
    arrowData,
    etaData,
    truckData,
  })
  themeRef.current = theme
  modeRef.current = mode
  hourRef.current = heatHour
  tripRef.current = { routes, origin, destination, corridor, heatHour, loadLb, departureIso }
  dataRef.current = {
    routeData,
    routeLabelData,
    checkpointData,
    calloutData,
    endpointData,
    arrowData,
    etaData,
    truckData,
  }

  function popupForRef(ref: CheckpointRef): { coordinates: [number, number]; html: string } | null {
    const trip = tripRef.current
    const route = trip.routes.find((item) => item.id === ref.routeId)
    if (!route) return null
    const cp = route.checkpoints.find((item) => item.index === ref.index)
    if (!cp) return null
    const overlay = trip.corridor
      ? corridorSampleAt(trip.corridor, cp.lon, cp.lat, trip.heatHour)
      : null
    return {
      coordinates: [cp.lon, cp.lat],
      html: checkpointPopupHtml(
        cp,
        checkpointName(route, cp, trip.origin, trip.destination),
        overlay,
        trip.heatHour,
        trip.corridor?.hours[Math.round(trip.heatHour)] ?? null,
        trip.loadLb,
        trip.departureIso,
      ),
    }
  }

  function showPopup(map: MapLibreMap, coordinates: [number, number], html: string, pinned: boolean) {
    popupRef.current?.remove()
    popupPinnedRef.current = pinned
    popupRef.current = new Popup({ ...POPUP_OPTIONS, closeButton: pinned })
      .setLngLat(coordinates)
      .setHTML(html)
      .addTo(map)
    if (pinned) {
      popupRef.current.on('close', () => {
        popupPinnedRef.current = false
        popupTargetRef.current = null
      })
    }
    return popupRef.current
  }

  function setSourceData(name: string, data: FeatureCollection) {
    const source = mapRef.current?.getSource(name)
    if (source instanceof GeoJSONSource) source.setData(data)
  }

  function applyOverlay(map: MapLibreMap, nextMode: OverlayMode, hour: number) {
    const show = nextMode !== 'off'
    setWeatherHour(map, hour, nextMode)
    wxRef.current?.setHour(hour, nextMode)
    if (map.getLayer(WX_ARROW_LAYER)) {
      map.setLayoutProperty(WX_ARROW_LAYER, 'visibility', show ? 'visible' : 'none')
    }
    if (map.getLayer(LAYERS.etaLabel)) {
      map.setPaintProperty(
        LAYERS.etaLabel,
        'text-opacity',
        ['case', ['<=', ['get', 'hour'], hour], 0.22, 0.95],
      )
    }
  }

  function hydrateMap(map: MapLibreMap) {
    if (themeRef.current === 'dark') tuneDarkBasemap(map)
    installLayers(map, themeRef.current, modeRef.current)
    const data = dataRef.current
    const routes = map.getSource(SOURCES.routes)
    if (routes instanceof GeoJSONSource) routes.setData(data.routeData)
    const labels = map.getSource(SOURCES.routeLabels)
    if (labels instanceof GeoJSONSource) labels.setData(data.routeLabelData)
    const checkpoints = map.getSource(SOURCES.checkpoints)
    if (checkpoints instanceof GeoJSONSource) checkpoints.setData(data.checkpointData)
    const callouts = map.getSource(SOURCES.callouts)
    if (callouts instanceof GeoJSONSource) callouts.setData(data.calloutData)
    const endpoints = map.getSource(SOURCES.endpoints)
    if (endpoints instanceof GeoJSONSource) endpoints.setData(data.endpointData)
    const truck = map.getSource(SOURCES.truck)
    if (truck instanceof GeoJSONSource) truck.setData(data.truckData)
    const arrows = map.getSource(WX_ARROW_SOURCE)
    if (arrows instanceof GeoJSONSource) arrows.setData(data.arrowData)
    const eta = map.getSource(SOURCES.etaLabels)
    if (eta instanceof GeoJSONSource) eta.setData(data.etaData)
    applyOverlay(map, modeRef.current, hourRef.current)
  }

  // --- map construction ---------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLES[themeRef.current],
      center: worldView ? [10, 18] : [-96, 39],
      zoom: worldView ? 1.55 : 3.4,
      attributionControl: false,
      maxCanvasSize: [8192, 8192],
      // Keeps long routes legible instead of wrapping across the antimeridian.
      renderWorldCopies: false,
    })

    const resize = () => map.resize()
    const observer = new ResizeObserver(resize)
    observer.observe(containerRef.current)
    requestAnimationFrame(resize)

    map.addControl(new NavigationControl({ showCompass: false }), 'top-left')
    map.addControl(new ScaleControl({ unit: 'imperial' }), 'bottom-right')
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: 'OSM · OpenFreeMap · Open-Meteo',
      }),
      'bottom-right',
    )

    map.on('load', () => {
      map.resize()
      hydrateMap(map)
      installInteractions(map, {
        onCheckpointClick: (ref, coordinates) => {
          selectRouteRef.current(ref.routeId)
          popupTargetRef.current = ref
          const popup = popupForRef(ref)
          showPopup(map, coordinates, popup?.html ?? '', true).on('close', () => {
            popupPinnedRef.current = false
            popupTargetRef.current = null
            focusRef.current(null)
          })
          focusRef.current(ref)
        },
        onCheckpointHover: (ref, coordinates) => {
          if (hoverHideRef.current != null) {
            window.clearTimeout(hoverHideRef.current)
            hoverHideRef.current = null
          }
          if (popupPinnedRef.current) return
          const popup = popupForRef(ref)
          if (popup) showPopup(map, coordinates, popup.html, false)
        },
        onCheckpointLeave: () => {
          if (popupPinnedRef.current) return
          hoverHideRef.current = window.setTimeout(() => {
            if (popupPinnedRef.current) return
            popupRef.current?.remove()
            popupRef.current = null
          }, 80)
        },
        onRouteClick: (routeId) => {
          selectRouteRef.current(routeId)
          focusRef.current(null)
        },
      })
      setMapError(null)
      setReady(true)
    })

    map.on('error', (event) => {
      const message = event.error?.message ?? 'The map failed to load'
      if (/worker/i.test(message) && !/om:/i.test(message)) {
        setMapError(message)
      }
    })

    mapRef.current = map
    return () => {
      observer.disconnect()
      popupRef.current?.remove()
      destMarkerRef.current?.remove()
      destMarkerRef.current = null
      routeCardMarkersRef.current.forEach((marker) => marker.remove())
      routeCardMarkersRef.current = []
      map.remove()
      mapRef.current = null
      lastFitKey.current = null
      setReady(false)
    }
  }, [worldView])

  useEffect(() => {
    const map = mapRef.current
    const nextStyle = MAP_STYLES[theme]
    if (!map || styleRef.current === nextStyle) return
    styleRef.current = nextStyle
    const keepCamera = map.isStyleLoaded()
    const camera = keepCamera
      ? {
          center: map.getCenter(),
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        }
      : null
    map.setStyle(nextStyle)
    map.once('style.load', () => {
      hydrateMap(map)
      if (camera) map.jumpTo(camera)
      map.resize()
      setStyleEpoch((value) => value + 1)
    })
  }, [theme])

  // --- data updates -------------------------------------------------------
  useEffect(() => {
    if (ready) setSourceData(SOURCES.routes, routeData)
  }, [ready, routeData])

  useEffect(() => {
    if (!ready) return
    setSourceData(SOURCES.checkpoints, checkpointData)
    popupRef.current?.remove()
    popupPinnedRef.current = false
  }, [ready, checkpointData])

  useEffect(() => {
    if (ready) setSourceData(SOURCES.callouts, calloutData)
  }, [ready, calloutData])

  useEffect(() => {
    if (ready) setSourceData(SOURCES.routeLabels, routeLabelData)
  }, [ready, routeLabelData])

  useEffect(() => {
    if (ready) setSourceData(SOURCES.endpoints, endpointData)
  }, [ready, endpointData])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    destMarkerRef.current = syncDestinationMarker(
      map,
      destMarkerRef.current,
      destination,
      routes,
      selectedRouteId,
      heatHour,
    )
  }, [ready, styleEpoch, destination, routes, selectedRouteId, heatHour])

  useEffect(() => {
    if (ready) setSourceData(SOURCES.truck, truckData)
  }, [ready, truckData])

  useEffect(() => {
    if (ready) setSourceData(SOURCES.etaLabels, etaData)
  }, [ready, etaData])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    wxRef.current?.remove()
    wxRef.current = null
    if (corridor?.raster) {
      wxRef.current = addWeatherRaster(map, corridor.raster)
      wxRef.current.setHour(hourRef.current, modeRef.current)
    }
    return () => {
      wxRef.current?.remove()
      wxRef.current = null
    }
  }, [ready, corridor?.raster?.id, styleEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    routeCardMarkersRef.current = syncRouteCardMarkers(
      map,
      routeCardMarkersRef.current,
      routes,
      recommendedRouteId,
      selectedRouteId,
      hiddenIds,
      (routeId) => selectRouteRef.current(routeId),
    )
  }, [ready, styleEpoch, routes, recommendedRouteId, selectedRouteId, hiddenIds])

  useEffect(() => {
    if (ready) setSourceData(WX_ARROW_SOURCE, arrowData)
  }, [ready, arrowData])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    applyOverlay(map, mode, heatHour)
  }, [ready, mode, heatHour, theme, styleEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !popupPinnedRef.current || !popupTargetRef.current) return
    const popup = popupForRef(popupTargetRef.current)
    if (popup) popupRef.current?.setHTML(popup.html)
  }, [ready, heatHour, corridor])

  useEffect(() => {
    const controller = new AbortController()
    fetchOmValidTimes(controller.signal)
      .then((times) => {
        setOmTimes(times)
        weatherCatalogRef.current?.(times.length > 0)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOmTimes([])
          weatherCatalogRef.current?.(false)
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const step = timeStepForHour(omTimes, heatHour, corridor?.hours[Math.round(heatHour)])
    const rasterOk = weatherRaster && omTimes.length > 0 && mode !== 'all' && mode !== 'off'
    for (const metric of HEAT_LAYER_KEYS) {
      const source = map.getSource(OM_SOURCE_IDS[metric])
      if (source && 'setUrl' in source && typeof source.setUrl === 'function') {
        source.setUrl(omTileUrl(metric, step))
      }
      const rasterId = OM_LAYER_IDS[metric]
      if (map.getLayer(rasterId)) {
        const showRaster = rasterOk && metric === mode
        map.setLayoutProperty(rasterId, 'visibility', showRaster ? 'visible' : 'none')
        map.setPaintProperty(rasterId, 'raster-opacity', rasterOpacity)
      }
    }
  }, [ready, heatHour, omTimes, corridor, theme, styleEpoch, weatherRaster, rasterOpacity, mode])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    const sourceId = 'satellite'
    const layerId = 'satellite-raster'
    if (basemap === 'satellite') {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'raster',
          tiles: [
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Tiles &copy; Esri',
        })
      }
      if (!map.getLayer(layerId)) {
        const before = map.getLayer(LAYERS.routeCasing) ? LAYERS.routeCasing : undefined
        map.addLayer(
          { id: layerId, type: 'raster', source: sourceId, minzoom: 0, maxzoom: 19 },
          before,
        )
      }
      map.setLayoutProperty(layerId, 'visibility', 'visible')
      return
    }
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none')
  }, [ready, basemap, styleEpoch])

  // --- camera -------------------------------------------------------------
  const fitKey = useMemo(
    () => `${routes.map((route) => route.id).join('|')}|${origin?.label ?? ''}|${destination?.label ?? ''}`,
    [routes, origin, destination],
  )
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !routes.length) return
    // Refit when the planned route set changes, not when a route is highlighted
    // or the forecast slider moves, so all alternatives stay in view.
    if (lastFitKey.current === fitKey) return
    lastFitKey.current = fitKey

    const bounds = boundsOf(routes, [origin, destination])
    if (bounds) {
      map.fitBounds(bounds, {
        padding: { top: 56, bottom: 110, left: 48, right: 48 },
        duration: 900,
        maxZoom: 8.5,
      })
    }
  }, [ready, fitKey, routes, origin, destination])

  // Flying to a checkpoint picked from the inspector list or another route.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focused || !panToFocused) return
    const route = routes.find((item) => item.id === focused.routeId)
    if (!route) return

    const cp = route.checkpoints.find((item) => item.index === focused.index)
    if (!cp) return

    map.flyTo({ center: [cp.lon, cp.lat], zoom: Math.max(map.getZoom(), 6.5), duration: 700 })
    const overlay = corridor ? corridorSampleAt(corridor, cp.lon, cp.lat, heatHour) : null
    showPopup(
      map,
      [cp.lon, cp.lat],
      checkpointPopupHtml(
        cp,
        checkpointName(route, cp, origin, destination),
        overlay,
        heatHour,
        corridor?.hours[Math.round(heatHour)] ?? null,
        loadLb,
        departureIso,
      ),
      true,
    )
    // heatHour is read for popup copy only; flying here on every slider tick would
    // yank the camera off the moving truck marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fly on focus, not overlay hour
  }, [ready, focused, panToFocused, routes, origin, destination])

  return (
    <div className={['map-shell', className].filter(Boolean).join(' ')}>
      <div ref={containerRef} className="map-canvas" data-basemap={theme} />
      {mapError && (
        <div className="map-empty" role="alert">
          <p>Map tiles failed to load: {mapError}</p>
        </div>
      )}
      {!hideEmpty && !routes.length && !mapError && (
        <div className="map-empty">
          <p className="map-empty-kicker">Plan a trip</p>
          <p>Set origin, destination, departure and load to draw routes and the weather heatmap.</p>
        </div>
      )}
      {showJump && recommendedRouteId && selectedRouteId !== recommendedRouteId && (
        <button
          type="button"
          className="map-jump"
          onClick={() => onSelectRoute(recommendedRouteId)}
        >
          Show recommended route
        </button>
      )}
    </div>
  )
}

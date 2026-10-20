import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { Feature, FeatureCollection, Point } from 'geojson'
import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  type LngLatBoundsLike,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  HEAT_LAYER_IDS,
  HEAT_SOURCE_IDS,
  corridorHeatGeoJSON,
  heatColorExpression,
} from '../lib/corridorHeat'
import { corridorRiskAt } from '../lib/corridorHour'
import { formatClock } from '../lib/format'
import {
  OM_LAYER_IDS,
  OM_SOURCE_IDS,
  fetchOmValidTimes,
  omTileUrl,
  timeStepForHour,
} from '../lib/omWeather'
import {
  DEFAULT_HEAT_LAYERS,
  HEAT_LAYER_KEYS,
  RISK_COLORS,
  riskColor,
  routeColor,
  type HeatLayers,
} from '../lib/risk'
import { MAP_STYLES, type Theme } from '../lib/theme'
import type { Checkpoint, CorridorResponse, Place, Route } from '../types'

import 'maplibre-gl/dist/maplibre-gl.css'

const SOURCES = {
  routes: 'routes',
  checkpoints: 'checkpoints',
  endpoints: 'endpoints',
} as const

const LAYERS = {
  routeCasing: 'route-casing',
  routeLine: 'route-line',
  checkpointHalo: 'checkpoint-halo',
  checkpointDot: 'checkpoint-dot',
  endpointDot: 'endpoint-dot',
  endpointLabel: 'endpoint-label',
} as const

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
  heatLayers: HeatLayers
  focused: CheckpointRef | null
  hiddenRouteIds?: string[]
  basemap?: 'map' | 'satellite'
  hideEmpty?: boolean
  worldView?: boolean
  className?: string
  weatherRaster?: boolean
  rasterOpacity?: number
  showJump?: boolean
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
): FeatureCollection {
  const features: Feature[] = []
  routes.forEach((route, index) => {
    if (hiddenIds.has(route.id)) return
    const selected = route.id === selectedRouteId
    const identity = routeColor(index)
    const checkpoints = route.checkpoints
    if (checkpoints.length < 2) {
      features.push({
        type: 'Feature',
        geometry: route.geometry,
        properties: {
          routeId: route.id,
          label: route.label,
          color: identity,
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
          color: identity,
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

function checkpointName(route: Route, cp: Checkpoint, origin: Place | null, destination: Place | null) {
  if (cp.index === 0) return `${origin?.label.split(',')[0]?.trim() || 'Start'} (Start)`
  if (cp.index === route.checkpoints.length - 1) {
    return `${destination?.label.split(',')[0]?.trim() || 'End'} (End)`
  }
  return `Mile ${Math.round(cp.mile)}`
}

function checkpointsToGeoJSON(
  routes: Route[],
  selectedRouteId: string | null,
  hiddenIds: Set<string>,
  origin: Place | null,
  destination: Place | null,
  corridor: CorridorResponse | null,
  heatHour: number,
): FeatureCollection {
  const features: Feature[] = []
  for (const route of routes) {
    if (hiddenIds.has(route.id)) continue
    const selected = route.id === selectedRouteId
    for (const cp of route.checkpoints) {
      const name = checkpointName(route, cp, origin, destination)
      const forecastLevel = corridorRiskAt(corridor, cp.lon, cp.lat, heatHour)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cp.lon, cp.lat] },
        properties: {
          routeId: route.id,
          index: cp.index,
          level: forecastLevel ?? cp.risk.level,
          score: cp.risk.score,
          selected,
          popup: checkpointPopupHtml(cp, name),
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

function endpointsToGeoJSON(origin: Place | null, destination: Place | null): FeatureCollection {
  const features: Feature[] = []
  if (origin) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [origin.lon, origin.lat] },
      properties: { kind: origin.label.split(',')[0]?.trim() || 'Origin', color: '#22c55e' },
    })
  }
  if (destination) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [destination.lon, destination.lat] },
      properties: { kind: destination.label.split(',')[0]?.trim() || 'Destination', color: '#ef4444' },
    })
  }
  return { type: 'FeatureCollection', features }
}

function popupNumber(value: number | null | undefined, digits: number, suffix: string): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}${suffix}`
}

function checkpointPopupHtml(cp: Checkpoint, name?: string): string {
  const { weather, risk } = cp
  const title = name || `Mile ${Math.round(cp.mile)}`
  const reasons = risk.reasons.length
    ? `<ul class="popup-reasons">${risk.reasons
        .map((reason) => `<li>${escapeHtml(reason)}</li>`)
        .join('')}</ul>`
    : risk.available !== false
      ? '<p class="popup-reasons">All conditions within Low thresholds.</p>'
      : '<p class="popup-reasons">Weather data was unavailable; this checkpoint was not scored as Low.</p>'

  return `
    <div class="popup">
      <div class="popup-head" style="--level-color:${riskColor(risk.level)}">
        <span class="popup-badge">${escapeHtml(risk.label)}</span>
        <span class="popup-mile">${escapeHtml(title)}</span>
      </div>
      <div class="popup-eta">ETA ${escapeHtml(formatClock(cp.eta))}</div>
      <dl class="popup-grid">
        <div><dt>Wind</dt><dd>${popupNumber(weather.wind_mph, 0, ' mph')}</dd></div>
        <div><dt>Gusts</dt><dd>${popupNumber(weather.wind_gust_mph, 0, ' mph')}</dd></div>
        <div><dt>Rain</dt><dd>${popupNumber(weather.rain_in_hr, 2, ' in/hr')}</dd></div>
        <div><dt>Snow</dt><dd>${popupNumber(weather.snow_in_hr, 2, ' in/hr')}</dd></div>
        ${
          weather.temperature_f === null
            ? ''
            : `<div><dt>Temp</dt><dd>${weather.temperature_f.toFixed(0)}&deg;F</dd></div>`
        }
        ${
          weather.visibility_mi === null
            ? ''
            : `<div><dt>Visibility</dt><dd>${weather.visibility_mi.toFixed(1)} mi</dd></div>`
        }
      </dl>
      ${reasons}
    </div>
  `
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
      map.setPaintProperty(layer.id, 'background-color', '#1b2a3d')
    }
  }
}

function installWeatherRasters(map: MapLibreMap, timeStep: string) {
  for (const metric of HEAT_LAYER_KEYS) {
    const sourceId = OM_SOURCE_IDS[metric]
    const layerId = OM_LAYER_IDS[metric]
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'raster', url: omTileUrl(metric, timeStep) })
    }
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.38, 'raster-fade-duration': 0 },
      })
    }
  }
}

/** Creates every source and layer once, in bottom-to-top draw order. */
function installLayers(map: MapLibreMap, theme: Theme, layers: HeatLayers) {
  installWeatherRasters(map, 'current_time_1H')
  for (const name of Object.values(SOURCES)) {
    map.addSource(name, { type: 'geojson', data: EMPTY_COLLECTION })
  }
  for (const metric of HEAT_LAYER_KEYS) {
    map.addSource(HEAT_SOURCE_IDS[metric], { type: 'geojson', data: EMPTY_COLLECTION })
    map.addLayer({
      id: HEAT_LAYER_IDS[metric],
      type: 'circle',
      source: HEAT_SOURCE_IDS[metric],
      layout: { visibility: layers[metric] ? 'visible' : 'none' },
      paint: {
        'circle-color': heatColorExpression(0, metric),
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          11,
          8,
          18,
          12,
          12,
        ] as ExpressionSpecification,
        'circle-blur': 0.72,
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          0.45,
          7,
          0.55,
          12,
          0.38,
        ] as ExpressionSpecification,
        'circle-pitch-alignment': 'map',
      },
    })
  }

  map.addLayer({
    id: LAYERS.routeCasing,
    type: 'line',
    source: SOURCES.routes,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        ['case', ['get', 'selected'], 10, 7],
        10,
        ['case', ['get', 'selected'], 15, 11],
      ],
      'line-opacity': 0.95,
    },
  })

  map.addLayer({
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

  map.addLayer({
    id: LAYERS.checkpointHalo,
    type: 'circle',
    source: SOURCES.checkpoints,
    paint: {
      'circle-color': riskColorExpression,
      'circle-opacity': [
        'case',
        ['all', ['get', 'selected'], ['>', ['get', 'score'], 1]],
        0.22,
        0,
      ],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 10, 22],
    },
  })

  map.addLayer({
    id: LAYERS.checkpointDot,
    type: 'circle',
    source: SOURCES.checkpoints,
    paint: {
      'circle-color': riskColorExpression,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        ['case', ['get', 'selected'], 5.5, 3.4],
        11,
        ['case', ['get', 'selected'], 9, 5.5],
      ],
      'circle-opacity': ['case', ['get', 'selected'], 1, 0.72],
      'circle-stroke-width': ['case', ['get', 'selected'], 2, 1],
      'circle-stroke-color': '#ffffff',
    },
  })

  map.addLayer({
    id: LAYERS.endpointDot,
    type: 'circle',
    source: SOURCES.endpoints,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6.5, 10, 10],
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff',
    },
  })

  map.addLayer({
    id: LAYERS.endpointLabel,
    type: 'symbol',
    source: SOURCES.endpoints,
    layout: {
      'text-field': ['get', 'kind'],
      'text-size': 11,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
        'text-font': ['Noto Sans Regular'],
    },
    paint: {
      'text-color': theme === 'light' ? '#0f172a' : '#e2e8f0',
      'text-halo-color': theme === 'light' ? '#ffffff' : '#020617',
      'text-halo-width': 1.4,
    },
  })
}

interface InteractionHandlers {
  onCheckpointClick: (ref: CheckpointRef, coordinates: [number, number], html: string) => void
  onRouteClick: (routeId: string) => void
}

function installInteractions(map: MapLibreMap, handlers: InteractionHandlers) {
  const openCheckpoint = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    if (!feature) return
    const { routeId, index, popup } = feature.properties as Record<string, string>
    const coordinates = (feature.geometry as Point).coordinates as [number, number]
    handlers.onCheckpointClick({ routeId, index: Number(index) }, coordinates, popup)
  }

  map.on('click', LAYERS.checkpointDot, openCheckpoint)

  map.on('click', LAYERS.routeLine, (event: MapLayerMouseEvent) => {
    const onCheckpoint = map.queryRenderedFeatures(event.point, {
      layers: [LAYERS.checkpointDot],
    })
    if (onCheckpoint.length) return

    const routeId = event.features?.[0]?.properties?.routeId
    if (typeof routeId === 'string') handlers.onRouteClick(routeId)
  })

  for (const layer of [LAYERS.checkpointDot, LAYERS.routeLine] as string[]) {
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
  heatLayers,
  focused,
  hiddenRouteIds = [],
  basemap = 'map',
  hideEmpty = false,
  worldView = false,
  className,
  weatherRaster = true,
  rasterOpacity = 0.38,
  showJump = true,
  onSelectRoute,
  onFocusCheckpoint,
  onWeatherCatalog,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)

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

  const routeData = useMemo(
    () => routesToGeoJSON(routes, selectedRouteId, hiddenIds),
    [routes, selectedRouteId, hiddenIds],
  )
  const checkpointData = useMemo(
    () =>
      checkpointsToGeoJSON(
        routes,
        selectedRouteId,
        hiddenIds,
        origin,
        destination,
        corridor ?? null,
        heatHour,
      ),
    [routes, selectedRouteId, hiddenIds, origin, destination, corridor, heatHour],
  )
  const endpointData = useMemo(() => endpointsToGeoJSON(origin, destination), [origin, destination])
  const heatData = useMemo(
    () => ({
      risk: corridorHeatGeoJSON(corridor, 'risk'),
      wind: corridorHeatGeoJSON(corridor, 'wind'),
      rain: corridorHeatGeoJSON(corridor, 'rain'),
      snow: corridorHeatGeoJSON(corridor, 'snow'),
    }),
    [corridor],
  )
  const [omTimes, setOmTimes] = useState<string[]>([])

  function showPopup(map: MapLibreMap, coordinates: [number, number], html: string) {
    popupRef.current?.remove()
    popupRef.current = new Popup(POPUP_OPTIONS).setLngLat(coordinates).setHTML(html).addTo(map)
    return popupRef.current
  }

  function setSourceData(name: string, data: FeatureCollection) {
    const source = mapRef.current?.getSource(name)
    if (source instanceof GeoJSONSource) source.setData(data)
  }

  // --- map construction ---------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLES[theme],
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
        customAttribution:
          '&copy; OpenStreetMap contributors &middot; &copy; OpenFreeMap &middot; Weather by Open-Meteo',
      }),
      'bottom-right',
    )

    map.on('load', () => {
      map.resize()
      if (theme === 'dark') tuneDarkBasemap(map)
      installLayers(map, theme, DEFAULT_HEAT_LAYERS)
      installInteractions(map, {
        onCheckpointClick: (ref, coordinates, html) => {
          selectRouteRef.current(ref.routeId)
          showPopup(map, coordinates, html).on('close', () => focusRef.current(null))
          focusRef.current(ref)
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
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [theme, worldView])

  // --- data updates -------------------------------------------------------
  useEffect(() => {
    if (ready) setSourceData(SOURCES.routes, routeData)
  }, [ready, routeData])

  useEffect(() => {
    if (!ready) return
    setSourceData(SOURCES.checkpoints, checkpointData)
    popupRef.current?.remove()
  }, [ready, checkpointData])

  useEffect(() => {
    if (ready) setSourceData(SOURCES.endpoints, endpointData)
  }, [ready, endpointData])

  useEffect(() => {
    if (!ready) return
    for (const metric of HEAT_LAYER_KEYS) {
      setSourceData(HEAT_SOURCE_IDS[metric], heatData[metric])
    }
  }, [ready, heatData])

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
    const step = timeStepForHour(omTimes, heatHour, corridor?.hours[heatHour])
    for (const metric of HEAT_LAYER_KEYS) {
      const source = map.getSource(OM_SOURCE_IDS[metric])
      if (source && 'setUrl' in source && typeof source.setUrl === 'function') {
        source.setUrl(omTileUrl(metric, step))
      }
    }
  }, [ready, heatHour, omTimes, corridor])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const metric of HEAT_LAYER_KEYS) {
      const layerId = HEAT_LAYER_IDS[metric]
      if (!map.getLayer(layerId)) continue
      map.setPaintProperty(layerId, 'circle-color', heatColorExpression(heatHour, metric))
    }
  }, [ready, heatHour])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const rasterOk = weatherRaster && omTimes.length > 0
    const hasCorridor = Boolean(corridor?.points.length)
    const stacked = HEAT_LAYER_KEYS.filter((metric) => heatLayers[metric]).length > 1
    const circleOpacity = stacked ? 0.34 : hasCorridor && rasterOk ? 0.42 : 0.55
    for (const metric of HEAT_LAYER_KEYS) {
      const circleId = HEAT_LAYER_IDS[metric]
      const rasterId = OM_LAYER_IDS[metric]
      if (map.getLayer(circleId)) {
        const showCircle = heatLayers[metric] && hasCorridor
        map.setLayoutProperty(circleId, 'visibility', showCircle ? 'visible' : 'none')
        map.setPaintProperty(circleId, 'circle-opacity', circleOpacity)
      }
      if (map.getLayer(rasterId)) {
        const showRaster = rasterOk && heatLayers[metric] && metric !== 'risk'
        map.setLayoutProperty(rasterId, 'visibility', showRaster ? 'visible' : 'none')
        map.setPaintProperty(rasterId, 'raster-opacity', rasterOpacity)
      }
    }
  }, [ready, heatLayers, weatherRaster, omTimes, rasterOpacity, corridor])

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
  }, [ready, basemap])

  // --- camera -------------------------------------------------------------
  const fitKey = useMemo(
    () => `${routes.map((route) => route.id).join('|')}|${origin?.label ?? ''}|${destination?.label ?? ''}`,
    [routes, origin, destination],
  )
  const lastFitKey = useRef<string | null>(null)

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
    if (!ready || !map || !focused) return
    const route = routes.find((item) => item.id === focused.routeId)
    if (!route) return

    const cp = route.checkpoints.find((item) => item.index === focused.index)
    if (!cp) return

    map.flyTo({ center: [cp.lon, cp.lat], zoom: Math.max(map.getZoom(), 6.5), duration: 700 })
    showPopup(
      map,
      [cp.lon, cp.lat],
      checkpointPopupHtml(cp, checkpointName(route, cp, origin, destination)),
    )
  }, [ready, focused, routes, origin, destination])

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

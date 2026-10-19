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

import { formatClock } from '../lib/format'
import {
  DEFAULT_HEAT_LAYERS,
  HEAT_LAYER_KEYS,
  RISK_COLORS,
  riskColor,
  routeColor,
  type HeatLayers,
} from '../lib/risk'
import {
  OM_LAYER_IDS,
  OM_SOURCE_IDS,
  fetchOmValidTimes,
  omTileUrl,
  timeStepForHour,
} from '../lib/omWeather'
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
  maxWidth: '290px',
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
  basemap?: 'map' | 'satellite'
  hideEmpty?: boolean
  worldView?: boolean
  onSelectRoute: (routeId: string) => void
  onFocusCheckpoint: (ref: CheckpointRef | null) => void
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
  RISK_COLORS.LOW,
]

function routesToGeoJSON(routes: Route[], selectedRouteId: string | null): FeatureCollection {
  const features: Feature[] = routes.map((route, index) => ({
    type: 'Feature',
    geometry: route.geometry,
    properties: {
      routeId: route.id,
      label: route.label,
      color: routeColor(index),
      selected: route.id === selectedRouteId,
    },
  }))
  // Features paint in array order, so the selected route is drawn last and
  // therefore sits on top of the others.
  features.sort(
    (a, b) => Number(a.properties?.selected ?? false) - Number(b.properties?.selected ?? false),
  )
  return { type: 'FeatureCollection', features }
}

function checkpointsToGeoJSON(route: Route | null): FeatureCollection {
  if (!route) return EMPTY_COLLECTION
  return {
    type: 'FeatureCollection',
    features: route.checkpoints.map((cp) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [cp.lon, cp.lat] },
      properties: {
        routeId: route.id,
        index: cp.index,
        level: cp.risk.level,
        score: cp.risk.score,
        popup: checkpointPopupHtml(cp),
      },
    })),
  }
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

function checkpointPopupHtml(cp: Checkpoint): string {
  const { weather, risk } = cp
  const reasons = risk.reasons.length
    ? `<ul class="popup-reasons">${risk.reasons
        .map((reason) => `<li>${escapeHtml(reason)}</li>`)
        .join('')}</ul>`
    : '<p class="popup-reasons">All conditions within Low thresholds.</p>'

  return `
    <div class="popup">
      <div class="popup-head" style="--level-color:${riskColor(risk.level)}">
        <span class="popup-badge">${escapeHtml(risk.label)}</span>
        <span class="popup-mile">Mile ${cp.mile.toFixed(0)}</span>
      </div>
      <div class="popup-eta">ETA ${escapeHtml(formatClock(cp.eta))}</div>
      <dl class="popup-grid">
        <div><dt>Wind</dt><dd>${weather.wind_mph.toFixed(0)} mph</dd></div>
        <div><dt>Gusts</dt><dd>${weather.wind_gust_mph.toFixed(0)} mph</dd></div>
        <div><dt>Rain</dt><dd>${weather.rain_in_hr.toFixed(2)} in/hr</dd></div>
        <div><dt>Snow</dt><dd>${weather.snow_in_hr.toFixed(2)} in/hr</dd></div>
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

function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
}

function installWeatherRasters(map: MapLibreMap, timeStep: string, layers: HeatLayers) {
  const before = firstSymbolLayerId(map)
  for (const metric of HEAT_LAYER_KEYS) {
    const sourceId = OM_SOURCE_IDS[metric]
    const layerId = OM_LAYER_IDS[metric]
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'raster', url: omTileUrl(metric, timeStep) })
    }
    if (!map.getLayer(layerId)) {
      map.addLayer(
        {
          id: layerId,
          type: 'raster',
          source: sourceId,
          layout: { visibility: layers[metric] ? 'visible' : 'none' },
          paint: { 'raster-opacity': 0.58, 'raster-fade-duration': 0 },
        },
        before,
      )
    }
  }
}

function setWeatherTimeStep(map: MapLibreMap, timeStep: string) {
  for (const metric of HEAT_LAYER_KEYS) {
    const source = map.getSource(OM_SOURCE_IDS[metric])
    if (source && 'setUrl' in source && typeof source.setUrl === 'function') {
      source.setUrl(omTileUrl(metric, timeStep))
    }
  }
}

/** Creates every source and layer once, in bottom-to-top draw order. */
function installLayers(map: MapLibreMap, theme: Theme, layers: HeatLayers) {
  for (const name of Object.values(SOURCES)) {
    map.addSource(name, { type: 'geojson', data: EMPTY_COLLECTION })
  }

  installWeatherRasters(map, 'current_time_1H', layers)

  map.addLayer({
    id: LAYERS.routeCasing,
    type: 'line',
    source: SOURCES.routes,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#020617',
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5, 10, 11],
      'line-opacity': ['case', ['get', 'selected'], 0.9, 0.55],
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
        ['case', ['get', 'selected'], 3.4, 2],
        10,
        ['case', ['get', 'selected'], 7, 3.4],
      ],
      'line-opacity': ['case', ['get', 'selected'], 1, 0.82],
    },
  })

  map.addLayer({
    id: LAYERS.checkpointHalo,
    type: 'circle',
    source: SOURCES.checkpoints,
    paint: {
      'circle-color': riskColorExpression,
      // Only elevated checkpoints get a halo, so a calm route stays clean.
      'circle-opacity': ['case', ['>', ['get', 'score'], 1], 0.22, 0],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 10, 22],
    },
  })

  map.addLayer({
    id: LAYERS.checkpointDot,
    type: 'circle',
    source: SOURCES.checkpoints,
    paint: {
      'circle-color': riskColorExpression,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.4, 7, 5.5, 11, 8],
      'circle-stroke-width': ['case', ['>', ['get', 'score'], 2], 2, 1],
      'circle-stroke-color': '#0b1120',
    },
  })

  map.addLayer({
    id: LAYERS.endpointDot,
    type: 'circle',
    source: SOURCES.endpoints,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 10, 9],
      'circle-stroke-width': 2.5,
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
  map.on('click', LAYERS.checkpointDot, (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0]
    if (!feature) return

    const { routeId, index, popup } = feature.properties as Record<string, string>
    const coordinates = (feature.geometry as Point).coordinates as [number, number]
    handlers.onCheckpointClick({ routeId, index: Number(index) }, coordinates, popup)
  })

  map.on('click', LAYERS.routeLine, (event: MapLayerMouseEvent) => {
    // A checkpoint click wins over the route line underneath it.
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
  heatHour,
  heatLayers,
  focused,
  basemap = 'map',
  hideEmpty = false,
  worldView = false,
  onSelectRoute,
  onFocusCheckpoint,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)

  // Keep the latest callbacks reachable from listeners bound once on load.
  const selectRouteRef = useRef(onSelectRoute)
  const focusRef = useRef(onFocusCheckpoint)
  useEffect(() => {
    selectRouteRef.current = onSelectRoute
    focusRef.current = onFocusCheckpoint
  }, [onSelectRoute, onFocusCheckpoint])

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  )

  const routeData = useMemo(
    () => routesToGeoJSON(routes, selectedRouteId),
    [routes, selectedRouteId],
  )
  const checkpointData = useMemo(() => checkpointsToGeoJSON(selectedRoute), [selectedRoute])
  const endpointData = useMemo(() => endpointsToGeoJSON(origin, destination), [origin, destination])
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
          showPopup(map, coordinates, html).on('close', () => focusRef.current(null))
          focusRef.current(ref)
        },
        onRouteClick: (routeId) => selectRouteRef.current(routeId),
      })
      setMapError(null)
      setReady(true)
    })

    map.on('error', (event) => {
      const message = event.error?.message ?? 'The map failed to load'
      if (/worker|fetch|style|tile|failed/i.test(message)) {
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
    const controller = new AbortController()
    fetchOmValidTimes(controller.signal)
      .then(setOmTimes)
      .catch(() => {
        if (!controller.signal.aborted) setOmTimes([])
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    setWeatherTimeStep(map, timeStepForHour(omTimes, heatHour))
  }, [ready, heatHour, omTimes])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const active = HEAT_LAYER_KEYS.filter((metric) => heatLayers[metric]).length
    const opacity = active > 1 ? 0.42 : 0.58
    for (const metric of HEAT_LAYER_KEYS) {
      const layerId = OM_LAYER_IDS[metric]
      if (!map.getLayer(layerId)) continue
      map.setLayoutProperty(layerId, 'visibility', heatLayers[metric] ? 'visible' : 'none')
      map.setPaintProperty(layerId, 'raster-opacity', opacity)
    }
  }, [ready, heatLayers])

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
    () => routes.map((route) => route.id).join('|') + (origin?.label ?? ''),
    [routes, origin],
  )
  const lastFitKey = useRef<string | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !routes.length) return
    // Refit only when the set of routes changes, so selecting a different
    // route or scrubbing the slider never yanks the camera away from the user.
    if (lastFitKey.current === fitKey) return
    lastFitKey.current = fitKey

    const bounds = boundsOf(routes, [origin, destination])
    if (bounds) {
      map.fitBounds(bounds, {
        padding: { top: 64, bottom: 72, left: 48, right: 48 },
        duration: 900,
      })
    }
  }, [ready, fitKey, routes, origin, destination])

  // Flying to a checkpoint picked from the inspector list.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !focused || !selectedRoute) return
    if (focused.routeId !== selectedRoute.id) return

    const cp = selectedRoute.checkpoints.find((item) => item.index === focused.index)
    if (!cp) return

    map.flyTo({ center: [cp.lon, cp.lat], zoom: Math.max(map.getZoom(), 6.5), duration: 700 })
    showPopup(map, [cp.lon, cp.lat], checkpointPopupHtml(cp))
  }, [ready, focused, selectedRoute])

  return (
    <div className="map-shell">
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
      {recommendedRouteId && selectedRouteId !== recommendedRouteId && (
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

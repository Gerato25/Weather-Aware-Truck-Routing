import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
} from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'

import { fetchWeatherMap } from '../api/client'
import { MAP_STYLES, type Theme } from '../lib/theme'
import type { WeatherMapResponse } from '../types'

import 'maplibre-gl/dist/maplibre-gl.css'

const CHICAGO: [number, number] = [-87.6298, 41.8781]
const DENVER: [number, number] = [-104.9903, 39.7392]
const OMAHA: [number, number] = [-95.9345, 41.2565]
const ST_LOUIS: [number, number] = [-90.1994, 38.627]
const CHEYENNE: [number, number] = [-104.8202, 41.14]

const ROUTE_COLORS = ['#2563eb', '#7c3aed', '#64748b']

const FALLBACK_ROUTES: [number, number][][] = [
  [
    CHICAGO,
    [-88.08, 41.53],
    [-90.58, 41.52],
    [-93.61, 41.59],
    OMAHA,
    [-100.77, 41.12],
    [-103.21, 40.63],
    DENVER,
  ],
  [
    CHICAGO,
    [-89.65, 39.78],
    ST_LOUIS,
    [-94.58, 39.1],
    [-97.61, 38.84],
    [-103.69, 39.26],
    DENVER,
  ],
  [CHICAGO, [-89.09, 42.27], [-93.62, 42.03], [-96.4, 42.5], CHEYENNE, DENVER],
]

const BBOX = { west: -106.2, south: 37.8, east: -86.2, north: 43.4 }

type WeatherLayer = 'rain' | 'risk' | 'wind'

interface HomeMapPreviewProps {
  theme: Theme
}

export function HomeMapPreview({ theme }: HomeMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const [hour, setHour] = useState(12)
  const [layer, setLayer] = useState<WeatherLayer>('rain')
  const [weather, setWeather] = useState<WeatherMapResponse | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLES[theme],
      bounds: [
        [BBOX.west, BBOX.south],
        [BBOX.east, BBOX.north],
      ],
      fitBoundsOptions: { padding: 28 },
      attributionControl: false,
      scrollZoom: false,
      renderWorldCopies: false,
    })

    map.addControl(new NavigationControl({ showCompass: false }), 'top-left')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)

    map.on('load', () => {
      map.resize()
      addSources(map)
      addLayers(map)
      setReady(true)
      void loadRoutes().then((routes) => {
        const source = map.getSource('home-routes')
        if (source instanceof GeoJSONSource) source.setData(routes)
        fitRoutes(map, routes)
      })
    })

    mapRef.current = map
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [theme])

  useEffect(() => {
    const controller = new AbortController()
    fetchWeatherMap({ ...BBOX, hours: 48, load_lb: 42_000 }, controller.signal)
      .then(setWeather)
      .catch(() => {
        if (!controller.signal.aborted) setWeather(null)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource('home-weather')
    if (!ready || !weather || !(source instanceof GeoJSONSource)) return
    source.setData(weatherToGeoJSON(weather, hour, layer))
  }, [ready, weather, hour, layer])

  return (
    <div className="home-map-preview">
      <div ref={containerRef} className="home-map-canvas" />
      <aside className="home-map-legend">
        <p>
          <i style={{ background: ROUTE_COLORS[0] }} /> Route 1 – Best
        </p>
        <p>
          <i style={{ background: ROUTE_COLORS[1] }} /> Route 2
        </p>
        <p>
          <i style={{ background: ROUTE_COLORS[2] }} /> Route 3
        </p>
        <label>
          Weather Layer
          <select value={layer} onChange={(event) => setLayer(event.target.value as WeatherLayer)}>
            <option value="rain">Precipitation</option>
            <option value="wind">Wind</option>
            <option value="risk">Risk</option>
          </select>
        </label>
      </aside>
      <div className="home-map-slider">
        <span>Forecast (hours)</span>
        <input type="range" min={0} max={48} value={hour} onChange={(event) => setHour(Number(event.target.value))} />
        <strong>{hour}h</strong>
      </div>
    </div>
  )
}

function addSources(map: MapLibreMap) {
  map.addSource('home-weather', { type: 'geojson', data: empty() })
  map.addSource('home-routes', { type: 'geojson', data: empty() })
  map.addSource('home-ends', { type: 'geojson', data: endpoints() })
}

function addLayers(map: MapLibreMap) {
  map.addLayer({
    id: 'home-heat',
    type: 'heatmap',
    source: 'home-weather',
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': 0.9,
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 18, 6, 42, 8, 64],
      'heatmap-opacity': 0.62,
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(34,197,94,0)',
        0.18,
        'rgba(74,222,128,0.35)',
        0.4,
        'rgba(250,204,21,0.5)',
        0.65,
        'rgba(251,146,60,0.7)',
        0.85,
        'rgba(239,68,68,0.82)',
        1,
        'rgba(185,28,28,0.9)',
      ],
    },
  })
  map.addLayer({
    id: 'home-route-casing',
    type: 'line',
    source: 'home-routes',
    paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.9 },
    layout: { 'line-join': 'round', 'line-cap': 'round' },
  })
  map.addLayer({
    id: 'home-route-line',
    type: 'line',
    source: 'home-routes',
    paint: { 'line-color': ['get', 'color'], 'line-width': 3.5 },
    layout: { 'line-join': 'round', 'line-cap': 'round' },
  })
  map.addLayer({
    id: 'home-ends',
    type: 'circle',
    source: 'home-ends',
    paint: {
      'circle-radius': 7,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })
}

function fitRoutes(map: MapLibreMap, routes: FeatureCollection<LineString>) {
  const bounds = new LngLatBounds()
  for (const feature of routes.features) {
    for (const coord of feature.geometry.coordinates) bounds.extend(coord as [number, number])
  }
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 36, maxZoom: 5.6, duration: 700 })
}

async function loadRoutes(): Promise<FeatureCollection<LineString>> {
  try {
    const legs = await Promise.all([
      fetchOsrm([CHICAGO, DENVER]),
      fetchOsrm([CHICAGO, ST_LOUIS, DENVER]),
      fetchOsrm([CHICAGO, OMAHA, CHEYENNE, DENVER]),
    ])
    const features = legs
      .map((coords, index) => (coords ? routeFeature(coords, index) : null))
      .filter((feature): feature is Feature<LineString> => feature !== null)
    if (features.length) return { type: 'FeatureCollection', features }
  } catch {
    /* public OSRM can throttle; city waypoints still look like a corridor */
  }
  return {
    type: 'FeatureCollection',
    features: FALLBACK_ROUTES.map((coords, index) => routeFeature(coords, index)),
  }
}

async function fetchOsrm(waypoints: [number, number][]): Promise<[number, number][] | null> {
  const path = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`
  const response = await fetch(url)
  if (!response.ok) return null
  const body = (await response.json()) as {
    routes?: { geometry?: { coordinates?: [number, number][] } }[]
  }
  return body.routes?.[0]?.geometry?.coordinates ?? null
}

function routeFeature(coordinates: [number, number][], index: number): Feature<LineString> {
  return {
    type: 'Feature',
    properties: { color: ROUTE_COLORS[index], rank: index },
    geometry: { type: 'LineString', coordinates },
  }
}

function weatherToGeoJSON(
  weather: WeatherMapResponse,
  hour: number,
  layer: WeatherLayer,
): FeatureCollection<Point> {
  const index = Math.max(0, Math.min(hour, (weather.hours.length || 1) - 1))
  const series = weather[layer]
  const max = layer === 'risk' ? 4 : layer === 'wind' ? 55 : 0.6
  return {
    type: 'FeatureCollection',
    features: weather.points.map((point, pointIndex) => {
      const raw = series[pointIndex]?.[index] ?? 0
      return {
        type: 'Feature',
        properties: { weight: Math.max(0, Math.min(1, Number(raw) / max)) },
        geometry: { type: 'Point', coordinates: point },
      }
    }),
  }
}

function endpoints(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { color: '#22c55e' },
        geometry: { type: 'Point', coordinates: CHICAGO },
      },
      {
        type: 'Feature',
        properties: { color: '#ef4444' },
        geometry: { type: 'Point', coordinates: DENVER },
      },
    ],
  }
}

function empty(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

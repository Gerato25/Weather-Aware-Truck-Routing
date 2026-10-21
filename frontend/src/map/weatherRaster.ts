import type { ImageSource, Map as MapLibreMap } from 'maplibre-gl'

import type { OverlayMode } from '../lib/corridorHeat'
import type { WeatherRaster } from '../types'

const SOURCE_A = 'wx-raster-a'
const SOURCE_B = 'wx-raster-b'
const LAYER_A = 'wx-raster-a'
const LAYER_B = 'wx-raster-b'
const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export interface WeatherRasterHandle {
  setHour: (hour: number, mode?: OverlayMode) => void
  remove: () => void
}

function apiUrl(path: string): string {
  const base = String(import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('/api')) return `${base}${path.slice(4)}`
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function metricFor(mode: OverlayMode | undefined): 'risk' | 'wind' | 'rain' | 'snow' {
  if (mode === 'wind' || mode === 'rain' || mode === 'snow') return mode
  return 'risk'
}

export function rasterUrl(raster: WeatherRaster, hour: number, mode?: OverlayMode): string {
  const metric = metricFor(mode)
  const clamped = Math.max(0, Math.min(Math.max(0, raster.hours - 1), Math.floor(hour)))
  const filled = raster.url.replace('{hour}', String(clamped)).replace('{id}', raster.id)
  const withMetric = metric === 'risk' ? filled : `${filled}${filled.includes('?') ? '&' : '?'}metric=${metric}`
  return apiUrl(withMetric)
}

function beforeWaterOrRoads(map: MapLibreMap): string | undefined {
  const layers = map.getStyle().layers ?? []
  const hit = layers.find((layer) =>
    /^(water|waterway|water_|river|lake|transport|road|bridge|tunnel|highway|place_)/i.test(
      layer.id,
    ),
  )
  if (hit) return hit.id
  const first = layers.find((layer) => layer.type !== 'background' && !layer.id.startsWith('wx-'))
  return first?.id
}

function ensureImageSource(
  map: MapLibreMap,
  id: string,
  url: string,
  coordinates: WeatherRaster['coordinates'],
) {
  const existing = map.getSource(id)
  if (existing) {
    ;(existing as ImageSource).updateImage({ url, coordinates })
    return
  }
  map.addSource(id, { type: 'image', url, coordinates })
}

function ensureRasterLayer(map: MapLibreMap, id: string, source: string, beforeId?: string) {
  if (map.getLayer(id)) return
  map.addLayer(
    {
      id,
      type: 'raster',
      source,
      paint: {
        'raster-opacity': 0,
        'raster-fade-duration': 0,
        'raster-resampling': 'linear',
      },
    },
    beforeId,
  )
}

function preload(urls: string[]) {
  for (const url of urls) {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
  }
}

export function addWeatherRaster(map: MapLibreMap, raster: WeatherRaster): WeatherRasterHandle {
  const beforeId = beforeWaterOrRoads(map)
  const coords = raster.coordinates
  ensureImageSource(map, SOURCE_A, rasterUrl(raster, 0), coords)
  ensureImageSource(map, SOURCE_B, rasterUrl(raster, Math.min(1, raster.hours - 1)), coords)
  ensureRasterLayer(map, LAYER_A, SOURCE_A, beforeId)
  ensureRasterLayer(map, LAYER_B, SOURCE_B, beforeId)

  const riskUrls = Array.from({ length: raster.hours }, (_, hour) => rasterUrl(raster, hour, 'all'))
  preload(riskUrls)

  let loHour = 0
  let hiHour = Math.min(1, raster.hours - 1)
  let metric: ReturnType<typeof metricFor> = 'risk'

  const handle: WeatherRasterHandle = {
    setHour(hour: number, mode: OverlayMode = 'all') {
      const show = mode !== 'off'
      const nextMetric = metricFor(mode)
      if (nextMetric !== metric) {
        metric = nextMetric
        preload(Array.from({ length: raster.hours }, (_, h) => rasterUrl(raster, h, mode)))
        loHour = -1
        hiHour = -1
      }
      const maxHour = Math.max(0, raster.hours - 1)
      const clamped = Math.max(0, Math.min(maxHour, hour))
      const lo = Math.min(maxHour, Math.floor(clamped))
      const hi = Math.min(maxHour, lo + 1)
      const frac = show ? clamped - lo : 0
      const strength = document.documentElement.dataset.theme === 'dark' ? 0.62 : 1
      if (lo !== loHour) {
        loHour = lo
        ensureImageSource(map, SOURCE_A, rasterUrl(raster, lo, mode), coords)
      }
      if (hi !== hiHour) {
        hiHour = hi
        ensureImageSource(map, SOURCE_B, rasterUrl(raster, hi, mode), coords)
      }
      if (map.getLayer(LAYER_A)) {
        map.setLayoutProperty(LAYER_A, 'visibility', show ? 'visible' : 'none')
        map.setPaintProperty(LAYER_A, 'raster-opacity', show ? (1 - frac) * strength : 0)
      }
      if (map.getLayer(LAYER_B)) {
        map.setLayoutProperty(LAYER_B, 'visibility', show ? 'visible' : 'none')
        map.setPaintProperty(LAYER_B, 'raster-opacity', show ? frac * strength : 0)
      }
    },
    remove() {
      for (const id of [LAYER_A, LAYER_B]) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      for (const id of [SOURCE_A, SOURCE_B]) {
        if (map.getSource(id)) map.removeSource(id)
      }
    },
  }

  handle.setHour(0, 'all')
  return handle
}

export function emptyRasterPlaceholder(): string {
  return PLACEHOLDER
}

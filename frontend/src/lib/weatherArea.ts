import type { Map as MapLibreMap } from 'maplibre-gl'

import { WX_ARROW_LAYER, hourFilter, type OverlayMode } from './corridorHeat'

/** Slider scrub: arrows stay on the nearest whole hour; rasters cross-fade separately. */
export function setWeatherHour(map: MapLibreMap, hour: number, _mode: OverlayMode = 'all') {
  if (map.getLayer(WX_ARROW_LAYER)) {
    map.setFilter(WX_ARROW_LAYER, hourFilter(Math.round(hour)))
  }
}

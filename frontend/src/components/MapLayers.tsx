import { HEAT_METRICS, HEAT_LAYER_KEYS, type HeatLayers, type HeatMetric } from '../lib/risk'

interface MapLayersProps {
  layers: HeatLayers
  disabled?: boolean
  onToggle: (metric: HeatMetric, visible: boolean) => void
}

const LABELS: Record<HeatMetric, string> = {
  risk: 'Weather Heatmap',
  wind: HEAT_METRICS.wind.label,
  rain: HEAT_METRICS.rain.label,
  snow: HEAT_METRICS.snow.label,
}

export function MapLayers({ layers, disabled, onToggle }: MapLayersProps) {
  return (
    <div className="map-layers">
      <span>Layers</span>
      {HEAT_LAYER_KEYS.map((key) => (
        <label key={key} className="toggle-row">
          <input
            type="checkbox"
            checked={layers[key]}
            disabled={disabled}
            onChange={(event) => onToggle(key, event.target.checked)}
          />
          <span>{LABELS[key]}</span>
        </label>
      ))}
    </div>
  )
}

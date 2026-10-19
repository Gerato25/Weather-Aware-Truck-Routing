import { HEAT_LAYER_KEYS, type HeatLayers, type HeatMetric } from '../lib/risk'

interface MapLayersProps {
  layers: HeatLayers
  disabled?: boolean
  onToggle: (metric: HeatMetric, visible: boolean) => void
}

const LABELS: Record<HeatMetric, string> = {
  risk: 'Weather Heatmap',
  wind: 'Wind',
  rain: 'Rain',
  snow: 'Snow',
}

export function MapLayers({ layers, disabled, onToggle }: MapLayersProps) {
  return (
    <div className="layer-pills" role="group" aria-label="Weather layers">
      {HEAT_LAYER_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={layers[key] ? 'layer-pill active' : 'layer-pill'}
          disabled={disabled}
          aria-pressed={layers[key]}
          onClick={() => onToggle(key, !layers[key])}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  )
}

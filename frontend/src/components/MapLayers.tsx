import { HEAT_LAYER_KEYS, type HeatLayers, type HeatMetric } from '../lib/risk'

interface MapLayersProps {
  layers: HeatLayers
  disabled?: boolean
  onToggle: (metric: HeatMetric, visible: boolean) => void
}

const LAYER_META: Record<HeatMetric, { label: string; hint: string; swatch: string }> = {
  risk: {
    label: 'Corridor risk',
    hint: 'Load-aware heatmap',
    swatch: 'linear-gradient(90deg, #22c55e, #facc15, #fb923c, #ef4444, #c026d3)',
  },
  wind: {
    label: 'Wind',
    hint: 'mph along route',
    swatch: 'linear-gradient(90deg, #86efac, #facc15, #ef4444)',
  },
  rain: {
    label: 'Rain',
    hint: 'in/hr along route',
    swatch: 'linear-gradient(90deg, #86efac, #14b8a6, #0f766e)',
  },
  snow: {
    label: 'Snow',
    hint: 'in/hr along route',
    swatch: 'linear-gradient(90deg, #e0e7ff, #c7d2fe, #ffffff)',
  },
}

export function MapLayers({ layers, disabled, onToggle }: MapLayersProps) {
  return (
    <div className="map-layers" role="group" aria-label="Map layers">
      <strong>Layers</strong>
      {HEAT_LAYER_KEYS.map((key) => {
        const meta = LAYER_META[key]
        return (
          <label key={key} className={layers[key] ? 'layer-row on' : 'layer-row'}>
            <input
              type="checkbox"
              checked={layers[key]}
              disabled={disabled}
              onChange={(event) => onToggle(key, event.target.checked)}
            />
            <span className="layer-copy">
              <span className="layer-name">{meta.label}</span>
              <span className="layer-hint">{meta.hint}</span>
            </span>
            <i className="layer-swatch" style={{ background: meta.swatch }} aria-hidden="true" />
          </label>
        )
      })}
    </div>
  )
}

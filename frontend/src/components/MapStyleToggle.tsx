interface MapStyleToggleProps {
  mode: 'map' | 'satellite'
  onChange: (mode: 'map' | 'satellite') => void
}

export function MapStyleToggle({ mode, onChange }: MapStyleToggleProps) {
  return (
    <div className="map-style-toggle" role="group" aria-label="Basemap">
      <button
        type="button"
        className={mode === 'map' ? 'segment active' : 'segment'}
        onClick={() => onChange('map')}
      >
        Map
      </button>
      <button
        type="button"
        className={mode === 'satellite' ? 'segment active' : 'segment'}
        onClick={() => onChange('satellite')}
      >
        Satellite
      </button>
    </div>
  )
}

import type { TripFormValues } from '../types'

interface SettingsPanelProps {
  intervalMiles: TripFormValues['intervalMiles']
  onInterval: (value: TripFormValues['intervalMiles']) => void
  routing?: string
  weather?: string
  truckProfile?: boolean
}

const INTERVALS: TripFormValues['intervalMiles'][] = [10, 25, 50]

export function SettingsPanel({
  intervalMiles,
  onInterval,
  routing,
  weather,
  truckProfile,
}: SettingsPanelProps) {
  return (
    <section className="settings-panel">
      <header className="panel-head">
        <h2>Settings</h2>
      </header>

      <div className="setting-block">
        <span>Checkpoint spacing</span>
        <div className="segmented" role="group" aria-label="Checkpoint spacing in miles">
          {INTERVALS.map((interval) => (
            <button
              type="button"
              key={interval}
              aria-pressed={intervalMiles === interval}
              className={intervalMiles === interval ? 'segment active' : 'segment'}
              onClick={() => onInterval(interval)}
            >
              {interval} mi
            </button>
          ))}
        </div>
        <p className="field-hint">Weather is sampled at each checkpoint using the truck&apos;s ETA there.</p>
      </div>

      {(routing || weather) && (
        <dl className="setting-providers">
          <div>
            <dt>Routing</dt>
            <dd>
              {routing}
              {truckProfile ? ' · truck' : ' · car'}
            </dd>
          </div>
          <div>
            <dt>Weather</dt>
            <dd>{weather}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

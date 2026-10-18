import { formatPounds } from '../lib/format'
import type { Place, TripFormValues } from '../types'

import { LocationInput } from './LocationInput'

interface TripFormProps {
  values: TripFormValues
  loading: boolean
  onChange: <K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) => void
  onSubmit: () => void
}

export function TripForm({ values, loading, onChange, onSubmit }: TripFormProps) {
  const canSubmit =
    values.origin.trim().length > 1 && values.destination.trim().length > 1 && !loading

  function handleResolve(key: 'originPlace' | 'destinationPlace') {
    return (place: Place | null) => onChange(key, place)
  }

  return (
    <form
      className="trip-form trip-form-bar"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onSubmit()
      }}
    >
      <LocationInput
        label="Origin"
        placeholder="City, state or coordinates"
        value={values.origin}
        resolved={values.originPlace}
        onChange={(value) => onChange('origin', value)}
        onResolve={handleResolve('originPlace')}
      />

      <span className="trip-arrow" aria-hidden="true">
        →
      </span>

      <LocationInput
        label="Destination"
        placeholder="City, state or coordinates"
        value={values.destination}
        resolved={values.destinationPlace}
        onChange={(value) => onChange('destination', value)}
        onResolve={handleResolve('destinationPlace')}
      />

      <div className="field">
        <label htmlFor="departure">Departure Date &amp; Time</label>
        <div className="field-shell">
          <span className="field-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 3v4M16 3v4M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <input
            id="departure"
            type="datetime-local"
            value={values.departure}
            onChange={(event) => onChange('departure', event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="load">Load Weight</label>
        <div className="field-shell">
          <span className="field-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M3 16V8h11l4 4v4H3zM14 8v4h4M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <input
            id="load"
            type="number"
            min={0}
            max={80000}
            step={1000}
            value={values.loadLb}
            aria-valuetext={formatPounds(values.loadLb)}
            onChange={(event) => onChange('loadLb', Number(event.target.value))}
          />
          <span className="field-suffix">lb</span>
        </div>
      </div>

      <button type="submit" className="primary" disabled={!canSubmit}>
        {loading ? 'Planning…' : 'Find safest route'}
        {!loading && <span aria-hidden="true"> →</span>}
      </button>
    </form>
  )
}

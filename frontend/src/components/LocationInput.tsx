import { useEffect, useId, useRef, useState } from 'react'

import { useGeocodeSuggestions } from '../hooks/useGeocodeSuggestions'
import type { Place } from '../types'

interface LocationInputProps {
  label: string
  value: string
  placeholder: string
  resolved: Place | null
  onChange: (value: string) => void
  onResolve: (place: Place | null) => void
}

export function LocationInput({
  label,
  value,
  placeholder,
  resolved,
  onChange,
  onResolve,
}: LocationInputProps) {
  const inputId = useId()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)

  // Suggestions are suppressed once a place is locked in, otherwise selecting a
  // result would immediately re-query for the text it just inserted.
  const { suggestions, loading } = useGeocodeSuggestions(value, open && !resolved)

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  // Clamped during render so a shrinking result list can never leave the
  // highlight pointing past the end.
  const activeIndex = Math.min(highlighted, Math.max(0, suggestions.length - 1))

  function choose(place: Place) {
    onChange(place.label)
    onResolve(place)
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !suggestions.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((index) => (index - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(suggestions[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && !resolved && (suggestions.length > 0 || loading)

  return (
    <div className="field location-field" ref={wrapperRef}>
      <label htmlFor={inputId}>{label}</label>
      <div className="field-shell location-control">
        <span className={resolved ? 'field-icon pin-on' : 'field-icon'} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="12" cy="10" r="2.2" fill="currentColor" />
          </svg>
        </span>
        <input
          id={inputId}
          type="text"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => {
            onChange(event.target.value)
            // Typing invalidates a previously chosen place.
            onResolve(null)
            setOpen(true)
            setHighlighted(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {value && (
          <button
            type="button"
            className="field-clear"
            aria-label={`Clear ${label}`}
            onClick={() => {
              onChange('')
              onResolve(null)
              setOpen(false)
            }}
          >
            ×
          </button>
        )}
      </div>

      {showList && (
        <ul className="suggestions" role="listbox">
          {loading && !suggestions.length && <li className="suggestion-empty">Searching…</li>}
          {suggestions.map((place, index) => (
            <li key={`${place.lat},${place.lon},${index}`}>
              <button
                type="button"
                className={index === activeIndex ? 'suggestion active' : 'suggestion'}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(place)}
              >
                <span className="suggestion-label">{place.label}</span>
                <span className="suggestion-coords">
                  {place.lat.toFixed(3)}, {place.lon.toFixed(3)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

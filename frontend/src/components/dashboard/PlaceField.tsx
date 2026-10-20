import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

import { useGeocodeSuggestions } from '../../hooks/useGeocodeSuggestions'
import type { Place } from '../../types'

import { DashField, dashControlClass } from './DashField'

interface PlaceFieldProps {
  label: string
  value: string
  placeholder: string
  resolved: Place | null
  icon: ReactNode
  compact?: boolean
  onChange: (value: string) => void
  onResolve: (place: Place | null) => void
}

export function PlaceField({
  label,
  value,
  placeholder,
  resolved,
  icon,
  compact = false,
  onChange,
  onResolve,
}: PlaceFieldProps) {
  const inputId = useId()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const { suggestions, loading, error, empty } = useGeocodeSuggestions(value, open && !resolved)

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

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

  const showList =
    open && !resolved && (suggestions.length > 0 || loading || Boolean(error) || empty)

  return (
    <div className="relative" ref={wrapperRef}>
      <DashField
        label={label}
        htmlFor={inputId}
        icon={icon}
        compact={compact}
        trailing={
          value ? (
            <button
              type="button"
              className="mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label={`Clear ${label}`}
              onClick={() => {
                onChange('')
                onResolve(null)
                setOpen(false)
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null
        }
      >
        <input
          id={inputId}
          type="text"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          className={dashControlClass}
          onChange={(event) => {
            onChange(event.target.value)
            onResolve(null)
            setOpen(true)
            setHighlighted(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </DashField>
      {resolved && !compact && (
        <p className="mt-1 text-[11px] tabular-nums text-slate-500">
          Using {resolved.lat.toFixed(4)}, {resolved.lon.toFixed(4)}
        </p>
      )}
      {showList && (
        <ul
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          role="listbox"
        >
          {loading && !suggestions.length && (
            <li className="px-3 py-2 text-xs text-slate-500">Searching…</li>
          )}
          {error && (
            <li className="px-3 py-2 text-xs text-amber-800" role="status">
              {error}
            </li>
          )}
          {empty && (
            <li className="px-3 py-2 text-xs text-slate-500" role="status">
              No matching places. Try a city and state, or paste coordinates like 41.88, -87.63.
            </li>
          )}
          {suggestions.map((place, index) => (
            <li key={`${place.lat},${place.lon},${index}`}>
              <button
                type="button"
                className={`flex w-full flex-col px-3 py-2 text-left ${
                  index === activeIndex ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(place)}
              >
                <span className="text-sm text-slate-900">{place.label}</span>
                <span className="text-[11px] text-slate-400">
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

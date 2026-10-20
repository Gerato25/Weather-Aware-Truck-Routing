import { useEffect, useRef, useState } from 'react'

import { geocode } from '../api/client'
import type { Place } from '../types'

const DEBOUNCE_MS = 350
export const MIN_QUERY_LENGTH = 3

/**
 * Debounced place lookup for the origin/destination inputs.
 *
 * Nominatim asks callers to stay around one request per second, so queries are
 * debounced and any in-flight request is aborted when the user keeps typing.
 */
export function useGeocodeSuggestions(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  const trimmed = query.trim()
  const active = enabled && trimmed.length >= MIN_QUERY_LENGTH

  useEffect(() => {
    if (!active) return

    const lookup = trimmed
    const timer = window.setTimeout(async () => {
      controller.current?.abort()
      const next = new AbortController()
      controller.current = next

      setLoading(true)
      try {
        const results = await geocode(lookup, next.signal)
        if (next.signal.aborted) return
        setSuggestions(results)
        setError(null)
        setSearchedQuery(lookup)
      } catch (caught) {
        if ((caught as Error).name === 'AbortError') return
        setSuggestions([])
        setError('Place search failed. Try a city and state, or paste coordinates like 41.88, -87.63.')
        setSearchedQuery(lookup)
      } finally {
        if (!next.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [trimmed, active])

  useEffect(() => () => controller.current?.abort(), [])

  if (!active) {
    return { suggestions: [] as Place[], loading: false, error: null as string | null, empty: false }
  }

  const settled = searchedQuery === trimmed
  return {
    suggestions,
    loading,
    error: settled ? error : null,
    empty: settled && !loading && !error && suggestions.length === 0,
  }
}

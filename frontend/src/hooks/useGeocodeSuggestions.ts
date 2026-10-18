import { useEffect, useRef, useState } from 'react'

import { geocode } from '../api/client'
import type { Place } from '../types'

const DEBOUNCE_MS = 350
const MIN_QUERY_LENGTH = 3

/**
 * Debounced place lookup for the origin/destination inputs.
 *
 * Nominatim asks callers to stay around one request per second, so queries are
 * debounced and any in-flight request is aborted when the user keeps typing.
 */
export function useGeocodeSuggestions(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const controller = useRef<AbortController | null>(null)

  const active = enabled && query.trim().length >= MIN_QUERY_LENGTH

  useEffect(() => {
    if (!active) return

    const trimmed = query.trim()
    const timer = window.setTimeout(async () => {
      controller.current?.abort()
      const next = new AbortController()
      controller.current = next

      setLoading(true)
      try {
        setSuggestions(await geocode(trimmed, next.signal))
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setSuggestions([])
      } finally {
        if (!next.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [query, active])

  useEffect(() => () => controller.current?.abort(), [])

  // Stale results are filtered out during render rather than cleared from an
  // effect, so a too-short query never shows the previous query's matches.
  return active ? { suggestions, loading } : { suggestions: [], loading: false }
}

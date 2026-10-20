import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, fetchCorridor, planTrip, type PlanPayload } from '../api/client'
import { INITIAL_FORM } from '../lib/demoTrips'
import { fromLocalInputValue } from '../lib/format'
import { rememberTrip } from '../lib/recentTrips'
import { DEFAULT_HEAT_LAYERS } from '../lib/risk'
import type { CheckpointRef } from '../components/MapView'
import type { CorridorResponse, PlanResponse, TripFormValues } from '../types'

export function useTripSession() {
  const [form, setForm] = useState<TripFormValues>(INITIAL_FORM)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [focused, setFocused] = useState<CheckpointRef | null>(null)
  const [corridorState, setCorridorState] = useState<{
    routeId: string
    data: CorridorResponse | null
  } | null>(null)
  const [heatHour, setHeatHour] = useState(0)
  const [heatLayers, setHeatLayers] = useState(DEFAULT_HEAT_LAYERS)

  const planAbort = useRef<AbortController | null>(null)
  const corridorAbort = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      planAbort.current?.abort()
      corridorAbort.current?.abort()
    },
    [],
  )

  const updateField = useCallback(
    <K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) => {
      setForm((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const selectedRoute = useMemo(
    () => plan?.routes.find((route) => route.id === selectedRouteId) ?? null,
    [plan, selectedRouteId],
  )

  const corridor = corridorState?.routeId === selectedRouteId ? corridorState.data : null
  const corridorLoading = Boolean(selectedRoute) && corridorState?.routeId !== selectedRouteId

  const runPlan = useCallback(async (values: TripFormValues) => {
    const originText = values.origin.trim()
    const destinationText = values.destination.trim()
    if (originText.length < 2 || destinationText.length < 2) {
      setError('Enter both an origin and a destination.')
      return false
    }
    if (values.originPlace && values.destinationPlace) {
      const samePlace =
        Math.abs(values.originPlace.lat - values.destinationPlace.lat) < 1e-4 &&
        Math.abs(values.originPlace.lon - values.destinationPlace.lon) < 1e-4
      if (samePlace) {
        setError('Origin and destination must be different locations.')
        return false
      }
    } else if (originText.toLowerCase() === destinationText.toLowerCase()) {
      setError('Origin and destination must be different locations.')
      return false
    }

    planAbort.current?.abort()
    corridorAbort.current?.abort()
    const controller = new AbortController()
    planAbort.current = controller

    setPlanning(true)
    setError(null)
    setCorridorState(null)
    setFocused(null)

    const payload: PlanPayload = {
      origin: values.originPlace ?? { query: originText },
      destination: values.destinationPlace ?? { query: destinationText },
      departure: fromLocalInputValue(values.departure),
      load_lb: values.loadLb,
      interval_miles: values.intervalMiles,
      demo_scenario: values.demoLoadWind ? 'load_wind' : '',
    }

    try {
      const result = await planTrip(payload, controller.signal)
      setPlan(result)
      setSelectedRouteId(result.recommendation.route_id)
      setHeatHour(0)
      setForm((current) => ({
        ...current,
        origin: result.request.origin.label,
        destination: result.request.destination.label,
        originPlace: result.request.origin,
        destinationPlace: result.request.destination,
      }))
      rememberTrip(result)
      return true
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return false
      setPlan(null)
      setSelectedRouteId(null)
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong planning the trip.')
      return false
    } finally {
      if (!controller.signal.aborted) setPlanning(false)
    }
  }, [])

  useEffect(() => {
    if (!plan || !selectedRoute) return

    corridorAbort.current?.abort()
    const controller = new AbortController()
    corridorAbort.current = controller
    const routeId = selectedRoute.id

    fetchCorridor(
      {
        seeds: selectedRoute.corridor_seeds,
        load_lb: plan.request.load_lb,
        anchor: plan.request.departure,
        hours: 48,
        demo_scenario:
          form.demoLoadWind && selectedRoute.id === plan.routes[0]?.id ? 'load_wind' : '',
      },
      controller.signal,
    )
      .then((result) => {
        setCorridorState({ routeId, data: result })
        setHeatHour((hour) => Math.min(hour, Math.max(0, result.hours.length - 1)))
      })
      .catch((caught) => {
        if ((caught as Error).name !== 'AbortError') setCorridorState({ routeId, data: null })
      })

    return () => controller.abort()
  }, [plan, selectedRoute])

  const selectRoute = useCallback((routeId: string) => {
    setSelectedRouteId(routeId)
  }, [])

  return {
    form,
    setForm,
    updateField,
    plan,
    planning,
    error,
    selectedRouteId,
    selectedRoute,
    focused,
    setFocused,
    corridor,
    corridorLoading,
    heatHour,
    setHeatHour,
    heatLayers,
    setHeatLayers,
    runPlan,
    selectRoute,
  }
}

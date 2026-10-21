import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, fetchCorridor, planTrip, type PlanPayload } from '../api/client'
import { mergeCorridorSeeds } from '../lib/corridorHeat'
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
    planId: string
    data: CorridorResponse | null
  } | null>(null)
  const [heatHour, setHeatHour] = useState(0)
  const [heatLayers, setHeatLayers] = useState(DEFAULT_HEAT_LAYERS)

  const planAbort = useRef<AbortController | null>(null)
  const corridorAbort = useRef<AbortController | null>(null)
  const corridorPlanId = useRef<string | null>(null)

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

  const corridor = plan && corridorState?.planId === plan.generated_at ? corridorState.data : null
  const corridorLoading = Boolean(plan) && corridorState?.planId !== plan?.generated_at

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
    corridorPlanId.current = null
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
        demoLoadWind: current.demoLoadWind || result.request.demo_scenario === 'load_wind',
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
    if (!plan) return
    const seeds = mergeCorridorSeeds(plan.routes)
    const planId = plan.generated_at
    if (seeds.length < 2) {
      setCorridorState({ planId, data: null })
      return
    }

    const demoOn = plan.request.demo_scenario === 'load_wind'
    corridorPlanId.current = planId

    fetchCorridor({
      seeds,
      load_lb: plan.request.load_lb,
      anchor: plan.request.departure,
      hours: 48,
      demo_scenario: demoOn ? 'load_wind' : '',
      route_lines: plan.routes.map((route) => route.geometry.coordinates),
    })
      .then((result) => {
        if (corridorPlanId.current !== planId || !result?.hours) return
        setCorridorState({ planId, data: result })
        setHeatHour((hour) => Math.min(hour, Math.max(0, result.hours.length - 1)))
      })
      .catch((caught) => {
        if (corridorPlanId.current !== planId || (caught as Error).name === 'AbortError') return
        setCorridorState({ planId, data: null })
      })
  }, [plan])

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

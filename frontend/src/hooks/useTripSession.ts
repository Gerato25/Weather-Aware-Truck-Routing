import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, fetchCorridor, fetchOpenMeteoInBrowser, planTrip, type PlanPayload } from '../api/client'
import { mergeCorridorSeeds } from '../lib/corridorHeat'
import { INITIAL_FORM } from '../lib/demoTrips'
import { fromLocalInputValue, hoursFromNow, toLocalInputValue } from '../lib/format'
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
  // Re-scoring with Open-Meteo fetched by this browser after the server was
  // rate-limited: 'loading' while it runs, 'failed' if the browser was refused too.
  const [browserWeather, setBrowserWeather] = useState<'idle' | 'loading' | 'failed'>('idle')

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

  useEffect(() => {
    setForm((current) => {
      const fromLa =
        current.origin.includes('Los Angeles') && current.destination.includes('San Francisco')
      if (!fromLa) return current
      const depart = new Date(fromLocalInputValue(current.departure)).getTime()
      if (!Number.isFinite(depart) || depart > Date.now() + 8 * 3_600_000) return current
      return { ...current, departure: toLocalInputValue(hoursFromNow(18)) }
    })
  }, [])

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
    setBrowserWeather('idle')

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
        demoLoadWind: current.demoLoadWind,
      }))
      rememberTrip(result)
      if (result.weather_request) {
        const wanted = result.weather_request
        setBrowserWeather('loading')
        void (async () => {
          try {
            const open_meteo = await fetchOpenMeteoInBrowser(wanted, controller.signal)
            const better = await planTrip(
              {
                ...payload,
                origin: result.request.origin,
                destination: result.request.destination,
                open_meteo,
              },
              controller.signal,
            )
            if (controller.signal.aborted) return
            setPlan(better)
            setSelectedRouteId((current) =>
              current === result.recommendation.route_id || !better.routes.some((r) => r.id === current)
                ? better.recommendation.route_id
                : current,
            )
            setBrowserWeather(better.weather_request ? 'failed' : 'idle')
          } catch (caught) {
            if ((caught as Error).name === 'AbortError' || controller.signal.aborted) return
            setBrowserWeather('failed')
          }
        })()
      }
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
    corridorAbort.current?.abort()
    const controller = new AbortController()
    corridorAbort.current = controller

    const body = {
      seeds,
      load_lb: plan.request.load_lb,
      anchor: plan.request.departure,
      hours: 48,
      demo_scenario: demoOn ? ('load_wind' as const) : ('' as const),
      route_lines: plan.routes.map((route) => route.geometry.coordinates),
    }
    const isCurrent = () => corridorPlanId.current === planId && !controller.signal.aborted

    fetchCorridor(body, controller.signal)
      .then(async (result) => {
        if (!isCurrent() || !result?.hours) return
        setCorridorState({ planId, data: result })
        setHeatHour((hour) => Math.min(hour, Math.max(0, result.hours.length - 1)))
        if (!result.weather_request) return
        // Same hand-off as the plan: replace fallback weather with Open-Meteo
        // fetched by this browser. A failure keeps the heatmap already shown.
        try {
          const open_meteo = await fetchOpenMeteoInBrowser(result.weather_request, controller.signal)
          const better = await fetchCorridor({ ...body, open_meteo }, controller.signal)
          if (isCurrent() && better?.hours) setCorridorState({ planId, data: better })
        } catch {
          /* keep the fallback heatmap */
        }
      })
      .catch((caught) => {
        if (!isCurrent() || (caught as Error).name === 'AbortError') return
        setCorridorState({ planId, data: null })
      })
    return () => controller.abort()
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
    browserWeather,
    runPlan,
    selectRoute,
  }
}

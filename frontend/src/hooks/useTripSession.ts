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
  // Open-Meteo fetched by this browser when the server's shared IP is
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
      let result = await planTrip({ ...payload, defer_weather: !payload.demo_scenario }, controller.signal)
      if (result.weather_request) {
        // The server was refused by Open-Meteo and skipped its slow backups.
        // Fetch the series here; if this browser is refused too, let the
        // server fall back to the National Weather Service.
        setBrowserWeather('loading')
        const retry = { ...payload, origin: result.request.origin, destination: result.request.destination }
        try {
          const open_meteo = await fetchOpenMeteoInBrowser(result.weather_request, controller.signal)
          result = await planTrip({ ...retry, open_meteo }, controller.signal)
          setBrowserWeather('idle')
        } catch (caught) {
          if ((caught as Error).name === 'AbortError') throw caught
          setBrowserWeather('failed')
          result = await planTrip(retry, controller.signal)
        }
      }
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

    const load = async () => {
      const first = await fetchCorridor({ ...body, defer_weather: !demoOn }, controller.signal)
      if (!first.weather_request) return first
      // Same hand-off as the plan: Open-Meteo from this browser, else the
      // server's National Weather Service backup.
      try {
        const open_meteo = await fetchOpenMeteoInBrowser(first.weather_request, controller.signal)
        return await fetchCorridor({ ...body, open_meteo }, controller.signal)
      } catch (caught) {
        if ((caught as Error).name === 'AbortError') throw caught
        return fetchCorridor(body, controller.signal)
      }
    }

    load()
      .then((result) => {
        if (!isCurrent() || !result?.hours) return
        setCorridorState({ planId, data: result })
        setHeatHour((hour) => Math.min(hour, Math.max(0, result.hours.length - 1)))
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

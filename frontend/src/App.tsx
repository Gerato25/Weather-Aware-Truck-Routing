import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, fetchCorridor, planTrip, type PlanPayload } from './api/client'
import { CheckpointList } from './components/CheckpointList'
import { HeatmapBar } from './components/HeatmapBar'
import { MapLayers } from './components/MapLayers'
import { MapView, type CheckpointRef } from './components/MapView'
import { RiskLegend } from './components/RiskLegend'
import { RouteCard } from './components/RouteCard'
import { RouteForecastStrip } from './components/RouteForecastStrip'
import { SettingsPanel } from './components/SettingsPanel'
import { ThemeToggle } from './components/ThemeToggle'
import { TripForm } from './components/TripForm'
import { useTheme } from './hooks/useTheme'
import { fromLocalInputValue, hoursFromNow, toLocalInputValue, weatherGlyph, weatherLabel } from './lib/format'
import { DEFAULT_HEAT_LAYERS, type HeatMetric } from './lib/risk'
import { routeBlurb, routeRoles } from './lib/routeMeta'
import type { CorridorResponse, PlanResponse, TripFormValues } from './types'

const INITIAL_FORM: TripFormValues = {
  origin: 'Chicago, IL',
  destination: 'Denver, CO',
  originPlace: null,
  destinationPlace: null,
  departure: toLocalInputValue(hoursFromNow(2)),
  loadLb: 42_000,
  intervalMiles: 25,
}

export default function App() {
  const { theme, setTheme } = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const roles = useMemo(() => (plan ? routeRoles(plan) : {}), [plan])
  const originWx = selectedRoute?.checkpoints[0]?.weather ?? null

  const handleSubmit = useCallback(async () => {
    planAbort.current?.abort()
    corridorAbort.current?.abort()
    const controller = new AbortController()
    planAbort.current = controller

    setPlanning(true)
    setError(null)
    setCorridorState(null)
    setFocused(null)
    setSettingsOpen(false)

    const payload: PlanPayload = {
      origin: form.originPlace ?? { query: form.origin.trim() },
      destination: form.destinationPlace ?? { query: form.destination.trim() },
      departure: fromLocalInputValue(form.departure),
      load_lb: form.loadLb,
      interval_miles: form.intervalMiles,
    }

    try {
      const result = await planTrip(payload, controller.signal)
      setPlan(result)
      setSelectedRouteId(result.recommendation.route_id)
      setHeatHour(0)
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return
      setPlan(null)
      setSelectedRouteId(null)
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong planning the trip.')
    } finally {
      if (!controller.signal.aborted) setPlanning(false)
    }
  }, [form])

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

  const handleSelectRoute = useCallback((routeId: string) => {
    setSelectedRouteId(routeId)
    setFocused(null)
  }, [])

  return (
    <div className={plan ? 'app has-plan' : 'app'}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <rect x="3" y="12" width="18" height="10" rx="2" fill="currentColor" />
              <path d="M21 14h5l3 4v4h-8V14z" fill="currentColor" opacity="0.85" />
              <circle cx="9" cy="23" r="2.4" fill="#0b1220" />
              <circle cx="23" cy="23" r="2.4" fill="#0b1220" />
            </svg>
          </span>
          <div>
            <h1>Spotter</h1>
            <p>Safer roads. Smarter decisions.</p>
          </div>
        </div>

        <div className="header-actions">
          {originWx && (
            <div className="wx-chip">
              <span aria-hidden="true">{weatherGlyph(originWx.weather_code)}</span>
              <strong>
                {originWx.temperature_f === null ? '—' : `${Math.round(originWx.temperature_f)}°F`}
              </strong>
              <small>{weatherLabel(originWx.weather_code)}</small>
            </div>
          )}
          <ThemeToggle theme={theme} onChange={setTheme} />
          <button
            type="button"
            className={settingsOpen ? 'icon-chip active' : 'icon-chip'}
            aria-label="Settings"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM4 12h2m12 0h2M6.5 6.5l1.4 1.4m8.2 8.2 1.4 1.4M6.5 17.5l1.4-1.4m8.2-8.2 1.4-1.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <section className="composer">
        <p className="composer-kicker">Plan your trip</p>
        <TripForm values={form} loading={planning} onChange={updateField} onSubmit={handleSubmit} />
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </section>

      <main className="map-pane">
        <MapView
          key={`basemap-${theme}`}
          theme={theme}
          routes={plan?.routes ?? []}
          selectedRouteId={selectedRouteId}
          recommendedRouteId={plan?.recommendation.route_id ?? null}
          origin={plan?.request.origin ?? null}
          destination={plan?.request.destination ?? null}
          corridor={corridor}
          heatHour={heatHour}
          heatLayers={heatLayers}
          focused={focused}
          onSelectRoute={handleSelectRoute}
          onFocusCheckpoint={setFocused}
        />

        <RiskLegend />

        <HeatmapBar
          corridor={corridor}
          loading={corridorLoading}
          hour={heatHour}
          onHourChange={setHeatHour}
        />

        <MapLayers
          layers={heatLayers}
          disabled={!corridor}
          onToggle={(metric: HeatMetric, visible) => {
            setHeatLayers((current) => ({ ...current, [metric]: visible }))
          }}
        />

        {planning && (
          <div className="map-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            Sampling weather along each route…
          </div>
        )}
      </main>

      {plan && selectedRoute && (
        <RouteForecastStrip
          route={selectedRoute}
          origin={plan.request.origin}
          destination={plan.request.destination}
          focused={focused}
          onFocus={setFocused}
        />
      )}

      <aside className="inspector">
        {settingsOpen ? (
          <SettingsPanel
            theme={theme}
            onTheme={setTheme}
            intervalMiles={form.intervalMiles}
            onInterval={(value) => updateField('intervalMiles', value)}
            routing={plan?.provider.routing}
            weather={plan?.provider.weather}
            truckProfile={plan?.provider.truck_profile}
          />
        ) : (
          <>
            {!plan && (
              <section className="empty-panel">
                <h2>Recommended routes</h2>
                <p>Plan a trip to compare three corridors with weather risk, then pick the safest one.</p>
              </section>
            )}

            {plan && (
              <div className="route-cards">
                {plan.routes.map((route, index) => {
                  const title = roles[route.id] ?? route.label
                  return (
                    <RouteCard
                      key={route.id}
                      route={route}
                      index={index}
                      title={title}
                      blurb={routeBlurb(title, plan.recommendation.reasons)}
                      selected={route.id === selectedRouteId}
                      recommended={route.id === plan.recommendation.route_id}
                      onSelect={() => handleSelectRoute(route.id)}
                    />
                  )
                })}
              </div>
            )}

            {selectedRoute && (
              <CheckpointList route={selectedRoute} focused={focused} onFocus={setFocused} />
            )}
          </>
        )}
      </aside>
    </div>
  )
}

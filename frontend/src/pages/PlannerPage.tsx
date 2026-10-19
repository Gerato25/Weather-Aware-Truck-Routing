import { useEffect, useMemo, useState } from 'react'

import { fetchWeatherMap } from '../api/client'
import { AppHeader } from '../components/AppHeader'
import { CheckpointList } from '../components/CheckpointList'
import { HeatmapBar } from '../components/HeatmapBar'
import { MapRouteLegend } from '../components/MapRouteLegend'
import { RequirementsPanel } from '../components/RequirementsPanel'
import { MapView } from '../components/MapView'
import { RiskLegend } from '../components/RiskLegend'
import { RouteCard } from '../components/RouteCard'
import { RouteForecastStrip } from '../components/RouteForecastStrip'
import { TripForm } from '../components/TripForm'
import type { useTripSession } from '../hooks/useTripSession'
import type { Page } from '../lib/navigation'
import { DEFAULT_HEAT_LAYERS } from '../lib/risk'
import { routeBlurb, routeRoles } from '../lib/routeMeta'
import type { Theme } from '../lib/theme'
import type { CorridorResponse } from '../types'

type Session = ReturnType<typeof useTripSession>

interface PlannerPageProps {
  theme: Theme
  onTheme: (theme: Theme) => void
  onNavigate: (page: Page, hash?: string) => void
  session: Session
}

const WORLD_BBOX = { west: -170, south: -48, east: 179, north: 72 }

export function PlannerPage({ theme, onTheme, onNavigate, session }: PlannerPageProps) {
  const [worldHeat, setWorldHeat] = useState<CorridorResponse | null>(null)
  const [worldHour, setWorldHour] = useState(0)
  const [worldLoading, setWorldLoading] = useState(true)

  const {
    form,
    updateField,
    plan,
    planning,
    error,
    runPlan,
    selectedRouteId,
    selectedRoute,
    focused,
    setFocused,
    corridor,
    corridorLoading,
    heatHour,
    setHeatHour,
    selectRoute,
  } = session

  const roles = useMemo(() => (plan ? routeRoles(plan) : {}), [plan])
  const originWx = selectedRoute?.checkpoints[0]?.weather ?? null
  const activeCorridor = plan ? corridor : worldHeat
  const activeHour = plan ? heatHour : worldHour
  const heatLoading = plan ? corridorLoading : worldLoading

  useEffect(() => {
    const controller = new AbortController()
    fetchWeatherMap({ ...WORLD_BBOX, hours: 48, load_lb: 42_000 }, controller.signal)
      .then((data) => {
        setWorldHeat({
          anchor: data.anchor,
          hours: data.hours,
          points: data.points,
          risk: data.risk,
          wind: data.wind,
          rain: data.rain,
          snow: data.snow,
          max_score: data.max_score,
          load_lb: data.load_lb,
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) setWorldHeat(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorldLoading(false)
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="app">
      <AppHeader
        page="planner"
        theme={theme}
        onTheme={onTheme}
        onNavigate={onNavigate}
        originWeather={originWx}
      />

      <section className="composer">
        <TripForm values={form} loading={planning} onChange={updateField} onSubmit={() => void runPlan(form)} />
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
          corridor={activeCorridor}
          heatHour={activeHour}
          heatLayers={DEFAULT_HEAT_LAYERS}
          focused={focused}
          hideEmpty
          worldView
          onSelectRoute={selectRoute}
          onFocusCheckpoint={setFocused}
        />
        <RiskLegend />
        <HeatmapBar
          corridor={activeCorridor}
          loading={heatLoading}
          hour={activeHour}
          onHourChange={plan ? setHeatHour : setWorldHour}
        />
        {plan && (
          <MapRouteLegend plan={plan} selectedRouteId={selectedRouteId} onSelect={selectRoute} />
        )}
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
        {plan ? (
          <>
            <div className="setting-block compact-spacing">
              <span>Checkpoint spacing</span>
              <div className="segmented small" role="group" aria-label="Checkpoint spacing in miles">
                {([10, 25, 50] as const).map((interval) => (
                  <button
                    type="button"
                    key={interval}
                    aria-pressed={form.intervalMiles === interval}
                    className={form.intervalMiles === interval ? 'segment active' : 'segment'}
                    onClick={() => updateField('intervalMiles', interval)}
                  >
                    {interval} mi
                  </button>
                ))}
              </div>
            </div>
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
                    onSelect={() => selectRoute(route.id)}
                  />
                )
              })}
            </div>
            {selectedRoute && (
              <CheckpointList route={selectedRoute} focused={focused} onFocus={setFocused} />
            )}
          </>
        ) : (
          <RequirementsPanel
            intervalMiles={form.intervalMiles}
            onInterval={(value) => updateField('intervalMiles', value)}
          />
        )}
      </aside>
    </div>
  )
}

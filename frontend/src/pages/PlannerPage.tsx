import { useMemo } from 'react'

import { AppHeader } from '../components/AppHeader'
import { CheckpointList } from '../components/CheckpointList'
import { HeatmapBar } from '../components/HeatmapBar'
import { MapLayers } from '../components/MapLayers'
import { RequirementsPanel } from '../components/RequirementsPanel'
import { MapView } from '../components/MapView'
import { RiskLegend } from '../components/RiskLegend'
import { RouteCard } from '../components/RouteCard'
import { RouteForecastStrip } from '../components/RouteForecastStrip'
import { TripForm } from '../components/TripForm'
import type { useTripSession } from '../hooks/useTripSession'
import type { Page } from '../lib/navigation'
import type { HeatMetric } from '../lib/risk'
import { corridorName, routeBlurb, routeRoles } from '../lib/routeMeta'
import type { Theme } from '../lib/theme'

type Session = ReturnType<typeof useTripSession>

interface PlannerPageProps {
  theme: Theme
  onTheme: (theme: Theme) => void
  onNavigate: (page: Page, hash?: string) => void
  session: Session
}

export function PlannerPage({ theme, onTheme, onNavigate, session }: PlannerPageProps) {
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
    heatHour,
    setHeatHour,
    heatLayers,
    setHeatLayers,
    selectRoute,
  } = session

  const roles = useMemo(() => (plan ? routeRoles(plan) : {}), [plan])
  const originWx = selectedRoute?.checkpoints[0]?.weather ?? null

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
          heatHour={heatHour}
          heatLayers={heatLayers}
          focused={focused}
          hideEmpty
          worldView
          onSelectRoute={selectRoute}
          onFocusCheckpoint={setFocused}
        />
        <RiskLegend overlay={heatLayers} />
        <HeatmapBar hour={heatHour} onHourChange={setHeatHour} />
        <MapLayers
          layers={heatLayers}
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
        <button
          type="submit"
          form="trip-form"
          className="primary find-route"
          disabled={planning || form.origin.trim().length < 2 || form.destination.trim().length < 2}
        >
          {planning ? 'Planning…' : 'Find safest route'}
          {!planning && <span aria-hidden="true"> →</span>}
        </button>

        {plan ? (
          <>
            <header className="inspector-head">
              <h2>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 7h11M4 12h16M4 17h9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <circle cx="17" cy="7" r="2.2" fill="currentColor" />
                  <circle cx="20" cy="17" r="2.2" fill="currentColor" />
                </svg>
                Route Options
              </h2>
            </header>
            <div className="route-cards">
              {plan.routes.map((route, index) => {
                const title = corridorName(index)
                const rank = roles[route.id] ?? route.label
                return (
                  <RouteCard
                    key={route.id}
                    route={route}
                    index={index}
                    title={title}
                    rank={rank}
                    blurb={routeBlurb(rank, plan.recommendation.reasons)}
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

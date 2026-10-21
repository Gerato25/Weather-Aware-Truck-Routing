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
import { formatDuration } from '../lib/format'
import type { Page } from '../lib/navigation'
import { scoreColor, type HeatMetric } from '../lib/risk'
import { corridorName, routeBlurb, routeRoles } from '../lib/routeMeta'
import type { Theme } from '../lib/theme'

type Session = ReturnType<typeof useTripSession>

interface PlannerPageProps {
  theme: Theme
  onNavigate: (page: Page, hash?: string) => void
  session: Session
}

export function PlannerPage({ theme, onNavigate, session }: PlannerPageProps) {
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
    corridor,
    corridorLoading,
    selectRoute,
  } = session

  const roles = useMemo(() => (plan ? routeRoles(plan) : {}), [plan])
  const originWx = selectedRoute?.checkpoints[0]?.weather ?? null

  return (
    <div className="app">
      <AppHeader page="planner" onNavigate={onNavigate} originWeather={originWx} />

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
          corridor={corridor}
          heatHour={heatHour}
          heatLayers={heatLayers}
          focused={focused}
          hideEmpty
          worldView
          onSelectRoute={selectRoute}
          onFocusCheckpoint={setFocused}
        />
        <RiskLegend overlay={heatLayers} />
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
            <section className="panel recommendation">
              <header className="panel-head">
                <h2>Why this route</h2>
              </header>
              <div className="recommend-banner">
                <strong>{plan.recommendation.label} is recommended</strong>
                <p>
                  {plan.recommendation.reasons[0] ??
                    'Lowest weather risk for this load, then shortest drive time.'}
                </p>
              </div>
              <table className="ranking">
                <caption>
                  Ranked by No Travel miles, then Severe, High, average risk, then time
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">No Travel</th>
                    <th scope="col">Severe</th>
                    <th scope="col">High</th>
                    <th scope="col">Avg</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.recommendation.ranking.map((entry, position) => (
                    <tr
                      key={entry.route_id}
                      className={entry.route_id === plan.recommendation.route_id ? 'best' : undefined}
                      onClick={() => selectRoute(entry.route_id)}
                    >
                      <th scope="row">
                        <span className="rank-position">{position + 1}</span>
                        {entry.label}
                      </th>
                      <td>{Math.round(entry.no_travel_miles)}</td>
                      <td>{Math.round(entry.severe_miles)}</td>
                      <td>{Math.round(entry.high_miles)}</td>
                      <td style={{ color: scoreColor(entry.average_risk) }}>
                        {entry.average_risk == null ? '—' : entry.average_risk.toFixed(2)}
                      </td>
                      <td>{formatDuration(entry.duration_hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
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

import { useMemo, useState } from 'react'

import { AppSidebar } from '../components/AppSidebar'
import { MapStyleToggle } from '../components/MapStyleToggle'
import { MapView } from '../components/MapView'
import { RecommendationPanel } from '../components/RecommendationPanel'
import { RiskLegend } from '../components/RiskLegend'
import { RouteCard } from '../components/RouteCard'
import { RouteSummaryBar } from '../components/RouteSummaryBar'
import { SettingsPanel } from '../components/SettingsPanel'
import { TripSummary } from '../components/TripSummary'
import { WorkspaceBar } from '../components/WorkspaceBar'
import type { useTripSession } from '../hooks/useTripSession'
import type { Page } from '../lib/navigation'
import { HIDDEN_HEAT_LAYERS } from '../lib/risk'
import { routeRoles } from '../lib/routeMeta'
import type { Theme } from '../lib/theme'

type Session = ReturnType<typeof useTripSession>
type RouteFilter = 'recommended' | 'all' | 'compare'

interface RoutesPageProps {
  theme: Theme
  onNavigate: (page: Page) => void
  session: Session
}

export function RoutesPage({ theme, onNavigate, session }: RoutesPageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filter, setFilter] = useState<RouteFilter>('recommended')
  const [basemap, setBasemap] = useState<'map' | 'satellite'>('map')
  const {
    form,
    updateField,
    plan,
    planning,
    error,
    selectedRouteId,
    focused,
    setFocused,
    selectRoute,
  } = session

  const roles = useMemo(() => (plan ? routeRoles(plan) : {}), [plan])

  return (
    <div className="app workspace page-routes">
      <AppSidebar
        page="routes"
        onNavigate={onNavigate}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
      />

      <div className="workspace-main">
        <WorkspaceBar
          title="Route Results"
          action={
            <button type="button" className="ghost edit-trip" onClick={() => onNavigate('planner')}>
              Edit trip
            </button>
          }
        />

        {plan ? (
          <TripSummary plan={plan} />
        ) : (
          <section className="trip-summary empty-summary">
            <p className="empty-note">
              Plan a trip first to compare three corridors.{' '}
              <button type="button" className="link" onClick={() => onNavigate('planner')}>
                Open trip planner
              </button>
            </p>
          </section>
        )}

        <section className="route-rail">
          {plan && (
            <div className="route-tabs" role="tablist" aria-label="Route filter">
              <button
                type="button"
                className={filter === 'recommended' ? 'route-tab active' : 'route-tab'}
                onClick={() => setFilter('recommended')}
              >
                Recommended
              </button>
              <button
                type="button"
                className={filter === 'all' ? 'route-tab active' : 'route-tab'}
                onClick={() => setFilter('all')}
              >
                All Routes
              </button>
              <button
                type="button"
                className={filter === 'compare' ? 'route-tab active' : 'route-tab'}
                onClick={() => setFilter('compare')}
              >
                Compare
              </button>
            </div>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {plan && filter === 'compare' ? (
            <RecommendationPanel plan={plan} onSelect={selectRoute} />
          ) : plan ? (
            <div className="route-cards">
              {plan.routes.map((route) => {
                const index = plan.routes.findIndex((item) => item.id === route.id)
                const title = roles[route.id] ?? route.label
                return (
                  <RouteCard
                    key={route.id}
                    route={route}
                    index={index}
                    title={title}
                    blurb=""
                    selected={route.id === selectedRouteId}
                    recommended={route.id === plan.recommendation.route_id}
                    onSelect={() => selectRoute(route.id)}
                  />
                )
              })}
            </div>
          ) : (
            <section className="empty-panel">
              <h2>Recommended routes</h2>
              <p>Search from the trip planner to see three scored corridors and the safest pick.</p>
            </section>
          )}
        </section>

        <div className="route-stage">
          <main className="map-pane">
            <MapView
              key={`basemap-${theme}`}
              theme={theme}
              routes={plan?.routes ?? []}
              selectedRouteId={selectedRouteId}
              recommendedRouteId={plan?.recommendation.route_id ?? null}
              origin={plan?.request.origin ?? null}
              destination={plan?.request.destination ?? null}
              corridor={null}
              heatHour={0}
              heatLayers={HIDDEN_HEAT_LAYERS}
              focused={focused}
              basemap={basemap}
              onSelectRoute={selectRoute}
              onFocusCheckpoint={setFocused}
            />
            <MapStyleToggle mode={basemap} onChange={setBasemap} />
            <RiskLegend />
            {planning && (
              <div className="map-loading" role="status">
                <span className="spinner" aria-hidden="true" />
                Sampling weather along each route…
              </div>
            )}
          </main>
          {plan && <RouteSummaryBar plan={plan} onSelect={selectRoute} />}
        </div>

        {settingsOpen && (
          <aside className="settings-drawer">
            <SettingsPanel
              intervalMiles={form.intervalMiles}
              onInterval={(value) => updateField('intervalMiles', value)}
              routing={plan?.provider.routing}
              weather={plan?.provider.weather}
              truckProfile={plan?.provider.truck_profile}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

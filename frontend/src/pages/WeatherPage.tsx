import { useState } from 'react'

import { AppSidebar } from '../components/AppSidebar'
import { CheckpointGallery } from '../components/CheckpointGallery'
import { HeatmapBar } from '../components/HeatmapBar'
import { MapLayers } from '../components/MapLayers'
import { MapView } from '../components/MapView'
import { RouteConditions } from '../components/RouteConditions'
import { RouteForecastStrip } from '../components/RouteForecastStrip'
import { SettingsPanel } from '../components/SettingsPanel'
import { WeatherRiskSummary } from '../components/WeatherRiskSummary'
import { WorkspaceBar } from '../components/WorkspaceBar'
import type { useTripSession } from '../hooks/useTripSession'
import type { Page } from '../lib/navigation'
import type { HeatMetric } from '../lib/risk'
import type { Theme } from '../lib/theme'

type Session = ReturnType<typeof useTripSession>

interface WeatherPageProps {
  theme: Theme
  onNavigate: (page: Page) => void
  session: Session
}

export function WeatherPage({ theme, onNavigate, session }: WeatherPageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    form,
    updateField,
    plan,
    planning,
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
    selectRoute,
  } = session

  return (
    <div className="app workspace page-weather">
      <AppSidebar
        page="weather"
        onNavigate={onNavigate}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
      />

      <div className="workspace-main">
        <WorkspaceBar
          subtitle="Weather conditions along your route and at each checkpoint."
          action={
            plan ? (
              <button type="button" className="ghost edit-trip" onClick={() => onNavigate('planner')}>
                Edit trip
              </button>
            ) : undefined
          }
        />

        {!plan && (
          <section className="trip-summary empty-summary">
            <p className="empty-note">
              Plan a trip to scrub the 0–48h corridor heatmap.{' '}
              <button type="button" className="link" onClick={() => onNavigate('planner')}>
                Open trip planner
              </button>
            </p>
          </section>
        )}

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
            onSelectRoute={selectRoute}
            onFocusCheckpoint={setFocused}
          />
          <div className="weather-map-tools">
            <MapLayers
              layers={heatLayers}
              disabled={!corridor}
              onToggle={(metric: HeatMetric, visible) => {
                setHeatLayers((current) => ({ ...current, [metric]: visible }))
              }}
            />
            <HeatmapBar
              corridor={corridor}
              loading={corridorLoading}
              hour={heatHour}
              onHourChange={setHeatHour}
            />
          </div>
          {planning && (
            <div className="map-loading" role="status">
              <span className="spinner" aria-hidden="true" />
              Sampling weather along each route…
            </div>
          )}
        </main>

        {plan && selectedRoute && (
          <>
            <div className="weather-lower">
              <CheckpointGallery
                route={selectedRoute}
                origin={plan.request.origin}
                destination={plan.request.destination}
                intervalMiles={plan.request.interval_miles}
                focused={focused}
                onFocus={setFocused}
              />
              <WeatherRiskSummary summary={selectedRoute.summary} />
            </div>
            <div className="weather-foot">
              <RouteForecastStrip
                route={selectedRoute}
                origin={plan.request.origin}
                destination={plan.request.destination}
                focused={focused}
                onFocus={setFocused}
              />
              <RouteConditions route={selectedRoute} />
            </div>
          </>
        )}

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

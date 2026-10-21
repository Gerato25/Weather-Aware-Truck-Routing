import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarClock,
  Flag,
  Loader2,
  MapPin,
  Search,
  Weight,
  Route as RouteIcon,
} from 'lucide-react'

import { AppHeader } from '../components/AppHeader'
import { CorridorPanel } from '../components/CorridorPanel'
import { CheckpointDetails } from '../components/dashboard/CheckpointDetails'
import { DashField, dashControlClass } from '../components/dashboard/DashField'
import { MapView } from '../components/MapView'
import { PlaceField } from '../components/dashboard/PlaceField'
import { RouteCompareStrip, RouteDetails } from '../components/dashboard/RouteDetails'
import type { useTripSession } from '../hooks/useTripSession'
import type { Page } from '../lib/navigation'
import type { Theme } from '../lib/theme'
import { formatForecastStamp } from '../lib/format'
import type { OverlayMode } from '../lib/corridorHeat'
import { RISK_COLORS, RISK_INK, RISK_LABELS, RISK_LEVELS, routeColor } from '../lib/risk'
import { routeLetter } from '../lib/routeMeta'

type Session = ReturnType<typeof useTripSession>

interface DashboardPageProps {
  session: Session
  theme: Theme
  onNavigate: (page: Page, hash?: string) => void
}

const INTERVALS: Array<10 | 25 | 50> = [10, 25, 50]
const FORECAST_PLAY_HOURS_PER_SEC = 1
const SHELL = 'mx-auto w-full max-w-[1680px] px-3 sm:px-4'

function overlayTimestamp(departure: string | undefined, hour: number, hours: string[] | undefined): string | null {
  const listed = hours?.[Math.round(hour)]
  if (listed) return listed
  if (!departure) return null
  const ms = new Date(departure).getTime() + hour * 3_600_000
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function DashboardPage({ session, theme, onNavigate }: DashboardPageProps) {
  const {
    form,
    updateField,
    plan,
    planning,
    error,
    browserWeather,
    runPlan,
    selectedRouteId,
    focused,
    setFocused,
    corridor,
    corridorLoading,
    heatHour,
    setHeatHour,
    selectRoute,
  } = session

  const [overlayMode, setOverlayMode] = useState<OverlayMode>('all')
  const [hiddenRouteIds, setHiddenRouteIds] = useState<string[]>([])
  const [rasterAvailable, setRasterAvailable] = useState(false)
  const [forecastPlaying, setForecastPlaying] = useState(false)
  const [panToFocused, setPanToFocused] = useState(false)
  const snowInitFor = useRef<string | null>(null)

  useEffect(() => {
    setHiddenRouteIds([])
    setForecastPlaying(false)
    if (!plan) {
      snowInitFor.current = null
      setOverlayMode('all')
      setPanToFocused(false)
      setFocused(null)
      return
    }
    if (snowInitFor.current === plan.generated_at) return
    snowInitFor.current = plan.generated_at
    setOverlayMode('all')
    setPanToFocused(false)
    setFocused(null)
    setHeatHour(0)
    selectRoute(plan.recommendation.route_id)
  }, [plan, plan?.generated_at, selectRoute, setFocused, setHeatHour])

  const revealRoute = useCallback(
    (routeId: string) => {
      setHiddenRouteIds((current) => current.filter((id) => id !== routeId))
      selectRoute(routeId)
    },
    [selectRoute],
  )

  const handleSelectRoute = useCallback(
    (routeId: string) => {
      revealRoute(routeId)
      setPanToFocused(false)
      setFocused(null)
    },
    [revealRoute, setFocused],
  )

  const handleFocusCheckpoint = useCallback(
    (ref: { routeId: string; index: number }) => {
      revealRoute(ref.routeId)
      setPanToFocused(true)
      setFocused(ref)
    },
    [revealRoute, setFocused],
  )

  const toggleRouteVisible = useCallback(
    (routeId: string) => {
      setHiddenRouteIds((current) => {
        if (current.includes(routeId)) return current.filter((id) => id !== routeId)
        const remaining = (plan?.routes ?? []).filter(
          (route) => route.id !== routeId && !current.includes(route.id),
        )
        if (!remaining.length) return current
        if (routeId === selectedRouteId) {
          selectRoute(remaining[0].id)
          setPanToFocused(false)
          setFocused(null)
        }
        return [...current, routeId]
      })
    },
    [plan, selectedRouteId, selectRoute, setFocused],
  )

  const overlayHasData = Boolean(
    corridor?.raster || corridor?.arrows?.features.length || corridor?.points.length,
  )
  const focusedRoute = plan?.routes.find((route) => route.id === focused?.routeId) ?? null
  const focusedCheckpoint =
    focusedRoute && focused
      ? (focusedRoute.checkpoints.find((item) => item.index === focused.index) ?? null)
      : null
  const focusedRouteIndex = plan && focusedRoute ? plan.routes.findIndex((route) => route.id === focusedRoute.id) : -1
  const forecastUnavailable = Boolean(plan) && !corridorLoading && !corridor && !rasterAvailable
  const sliderMax = corridor ? Math.max(0, Math.min(48, corridor.hours.length - 1)) : 48
  const overlayAt = overlayTimestamp(plan?.request.departure, heatHour, corridor?.hours)
  const canSubmit = form.origin.trim().length > 1 && form.destination.trim().length > 1 && !planning

  useEffect(() => {
    if (!forecastPlaying || !plan || overlayMode === 'off' || sliderMax <= 0) return
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      setHeatHour((hour) => {
        const next = hour + dt * FORECAST_PLAY_HOURS_PER_SEC
        return next >= sliderMax ? 0 : next
      })
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [forecastPlaying, plan, overlayMode, sliderMax, setHeatHour])

  const showNoTravel = Boolean(plan?.routes.some((route) => route.summary.miles_by_level.NO_TRAVEL > 0.05))

  return (
    <div className="dash-app min-h-screen">
      <AppHeader page="planner" onNavigate={onNavigate} />

      <main className={`${SHELL} flex flex-col gap-3 py-3`}>
        <form
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) void runPlan(form)
          }}
        >
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_7.5rem_8.5rem_auto]">
            <PlaceField
              compact
              label="Origin"
              placeholder="City, state"
              value={form.origin}
              resolved={form.originPlace}
              icon={<MapPin className="h-3.5 w-3.5" />}
              onChange={(value) => updateField('origin', value)}
              onResolve={(place) => updateField('originPlace', place)}
            />
            <PlaceField
              compact
              label="Destination"
              placeholder="City, state"
              value={form.destination}
              resolved={form.destinationPlace}
              icon={<Flag className="h-3.5 w-3.5" />}
              onChange={(value) => updateField('destination', value)}
              onResolve={(place) => updateField('destinationPlace', place)}
            />
            <DashField compact label="Departure" htmlFor="departure" icon={<CalendarClock className="h-3.5 w-3.5" />}>
              <input
                id="departure"
                type="datetime-local"
                value={form.departure}
                className={dashControlClass}
                onChange={(event) => updateField('departure', event.target.value)}
              />
            </DashField>
            <DashField compact label="Load (lbs)" htmlFor="load" icon={<Weight className="h-3.5 w-3.5" />}>
              <input
                id="load"
                type="number"
                min={0}
                max={80000}
                step={500}
                value={form.loadLb}
                className={dashControlClass}
                onChange={(event) => updateField('loadLb', Number(event.target.value))}
              />
            </DashField>
            <DashField compact label="Interval" htmlFor="interval" icon={<RouteIcon className="h-3.5 w-3.5" />}>
              <select
                id="interval"
                value={form.intervalMiles}
                className={dashControlClass}
                onChange={(event) => {
                  const intervalMiles = Number(event.target.value) as 10 | 25 | 50
                  updateField('intervalMiles', intervalMiles)
                  if (plan && form.origin.trim().length > 1 && form.destination.trim().length > 1) {
                    void runPlan({ ...form, intervalMiles })
                  }
                }}
              >
                {INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {interval} mi
                  </option>
                ))}
              </select>
            </DashField>
            <button
              type="submit"
              disabled={!canSubmit}
              className="dash-btn-analyze inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed lg:w-auto"
            >
              {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {planning ? 'Analyzing…' : 'Analyze Routes'}
            </button>
          </div>
          <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-slate-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[#0b1f3a]"
              checked={form.demoLoadWind}
              onChange={(event) => updateField('demoLoadWind', event.target.checked)}
            />
            Demo weather: scripted storms for the Loom. Off = live Open-Meteo at each lat/lon. Re-analyze to apply.
          </label>
          {plan && (
            <p className="mt-2 text-[11px] font-medium text-slate-600">
              {plan.provider.weather === 'open-meteo'
                ? 'Weather source: live Open-Meteo at each checkpoint lat/lon and truck ETA.'
                : /^(nws|met-norway)(\+|$)/.test(plan.provider.weather)
                  ? `Weather source: live ${plan.provider.weather
                      .split('+')
                      .map((name) => (name === 'nws' ? 'National Weather Service' : 'MET Norway'))
                      .join(' + ')} forecast at each checkpoint and truck ETA (Open-Meteo was rate-limited).`
                  : plan.provider.weather === 'demo'
                  ? 'Weather source: scripted demo storms (Demo box was checked).'
                  : plan.provider.weather === 'demo-fallback'
                    ? 'Weather source: Open-Meteo unavailable. Dry placeholders only — not scripted storms.'
                    : `Weather source: ${plan.provider.weather}`}
              {browserWeather === 'loading' && ' Fetching Open-Meteo from your browser to match a local run…'}
              {browserWeather === 'failed' && ' Your browser could not reach Open-Meteo either, so the backup forecast stays.'}
            </p>
          )}
          {plan?.provider.weather === 'demo-fallback' && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
              Open-Meteo and the backup forecasts were all unavailable. Risk is scored as calm/dry, so do not
              rely on this recommendation. Try again shortly, or check Demo weather and Analyze for scripted storms.
            </div>
          )}
          {error && (
            <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {error}
            </div>
          )}
        </form>

        <div className="dash-map-row has-drawer">
          <aside className="dash-drawer-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="shrink-0 border-b border-slate-100 px-3 py-2">
              <h2 className="text-sm font-semibold text-slate-900">Routes</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Compare time, distance, and weather risk</p>
            </div>
            {plan ? (
              <div className="shrink-0 border-b border-slate-100 p-2">
                <RouteCompareStrip
                  plan={plan}
                  selectedRouteId={selectedRouteId}
                  onSelectRoute={handleSelectRoute}
                />
              </div>
            ) : (
              <p className="border-b border-slate-100 px-3 py-4 text-center text-xs text-slate-500">
                Analyze a trip to score three route options.
              </p>
            )}
            <RouteDetails
              embedded
              plan={plan}
              selectedRouteId={selectedRouteId}
              focused={focused}
              heatHour={heatHour}
              onSelectRoute={handleSelectRoute}
              onFocusCheckpoint={handleFocusCheckpoint}
            />
          </aside>

          <section className="dash-map-stage relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <MapView
              theme={theme}
              className="dash-map"
              routes={plan?.routes ?? []}
              selectedRouteId={selectedRouteId}
              recommendedRouteId={plan?.recommendation.route_id ?? null}
              origin={plan?.request.origin ?? null}
              destination={plan?.request.destination ?? null}
              corridor={plan ? corridor : null}
              heatHour={heatHour}
              overlayMode={overlayMode}
              focused={focused}
              panToFocused={panToFocused}
              hiddenRouteIds={hiddenRouteIds}
              hideEmpty
              showJump={false}
              weatherRaster={false}
              loadLb={plan?.request.load_lb ?? 0}
              departureIso={plan?.request.departure ?? null}
              onSelectRoute={revealRoute}
              onFocusCheckpoint={(ref) => {
                if (ref) handleFocusCheckpoint(ref)
              }}
              onWeatherCatalog={setRasterAvailable}
            />

            {!plan && !planning && (
              <div className="dash-map-empty pointer-events-none absolute inset-0 z-20 grid place-items-center">
                <div className="dash-map-empty-card mx-4 max-w-sm px-6 py-5 text-center">
                  <p className="text-[15px] font-semibold tracking-tight">Analyze a trip to draw routes</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
                    Set origin, destination, departure, and load, then analyze to score live forecasts at each
                    checkpoint ETA.
                  </p>
                </div>
              </div>
            )}

            <div className="pointer-events-none absolute bottom-3 left-3 z-10">
              <div className="dash-map-legend flex flex-wrap items-center gap-x-2.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] font-semibold leading-4 shadow-sm">
                {RISK_LEVELS.filter((level) => {
                  if (level === 'NO_TRAVEL' && !showNoTravel) return false
                  if (
                    (overlayMode === 'wind' || overlayMode === 'rain' || overlayMode === 'snow') &&
                    level === 'LOW'
                  ) {
                    return false
                  }
                  return true
                }).map((level) => (
                  <span key={level} className="inline-flex items-center gap-1" style={{ color: RISK_COLORS[level] }}>
                    <i
                      className="h-2 w-2 rounded-full"
                      style={{ background: RISK_COLORS[level], boxShadow: `0 0 0 1px ${RISK_INK[level]}22` }}
                    />
                    {RISK_LABELS[level]}
                  </span>
                ))}
              </div>
            </div>

            {plan && (
              <>
                <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
                  {overlayMode !== 'off' && !corridorLoading && !overlayHasData && (
                    <div className="rounded-lg bg-white/95 px-3 py-1.5 text-xs text-amber-800 shadow-sm">
                      Live weather overlay unavailable
                    </div>
                  )}
                  <div className="dash-map-legend w-[11.5rem] rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-[10px] leading-4 text-slate-700 shadow-sm">
                    <div className="mb-1.5 flex items-center gap-2">
                      {(plan.routes ?? []).slice(0, 3).map((route, index) => {
                        const hidden = hiddenRouteIds.includes(route.id)
                        return (
                          <button
                            key={route.id}
                            type="button"
                            className="inline-flex items-center gap-1 text-[10px] font-semibold"
                            style={{ opacity: hidden ? 0.35 : 1 }}
                            aria-pressed={!hidden}
                            aria-label={`${hidden ? 'Show' : 'Hide'} Route ${routeLetter(index)}`}
                            onClick={() => toggleRouteVisible(route.id)}
                          >
                            <i className="h-2 w-2 rounded-full" style={{ background: routeColor(index) }} />
                            {routeLetter(index)}
                          </button>
                        )
                      })}
                    </div>
                    <p className="font-semibold text-slate-800">42 mi corridor</p>
                    <p className="mt-1.5 text-[9px] leading-4 text-slate-500">
                      Traveled miles use arrival weather. The slider only marks how far the truck has gone.
                    </p>
                  </div>
                </div>
              </>
            )}

            {planning && (
              <div className="dash-map-empty absolute inset-0 z-30 grid place-items-center">
                <div className="dash-map-empty-card inline-flex items-center gap-2 px-5 py-3 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sampling weather along each route…
                </div>
              </div>
            )}
          </section>

          <aside className="dash-drawer-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="shrink-0 border-b border-slate-100 px-3 py-2">
              <h2 className="text-sm font-semibold text-slate-900">Checkpoint Details</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Weather at the selected stop’s truck ETA</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {focusedCheckpoint && focusedRoute && plan && focusedRouteIndex >= 0 ? (
                <CheckpointDetails
                  route={focusedRoute}
                  routeIndex={focusedRouteIndex}
                  checkpoint={focusedCheckpoint}
                  origin={plan.request.origin.label}
                  destination={plan.request.destination.label}
                  loadLb={plan.request.load_lb}
                  departure={plan.request.departure}
                  corridor={corridor}
                  heatHour={heatHour}
                  overlayAt={overlayAt}
                />
              ) : (
                <p className="px-2 py-4 text-center text-xs leading-5 text-slate-500">
                  {plan
                    ? 'Click a checkpoint on the map or a row in Route Details.'
                    : 'Analyze a trip to see wind, rain, snow, temperature, and risk for a checkpoint.'}
                </p>
              )}
            </div>
          </aside>
        </div>

        <CorridorPanel
          plan={plan}
          corridor={corridor}
          selectedRouteId={selectedRouteId}
          heatHour={heatHour}
          sliderMax={sliderMax}
          overlayMode={overlayMode}
          overlayAt={overlayAt}
          forecastPlaying={forecastPlaying}
          showNoTravel={showNoTravel}
          onMode={(mode) => {
            setForecastPlaying(false)
            setOverlayMode(mode)
          }}
          onHour={(hour) => {
            setForecastPlaying(false)
            setHeatHour(hour)
          }}
          onPlay={() => setForecastPlaying((value) => !value)}
        />
        {forecastUnavailable && (
          <p className="text-xs text-amber-800">Corridor forecast unavailable for this hour.</p>
        )}
        {plan && corridor && !corridorLoading && overlayMode !== 'off' && !overlayHasData && (
          <p className="text-xs text-amber-800">
            No overlay forecast for {overlayAt ? formatForecastStamp(overlayAt) : `+${heatHour}h`}. ETA weather is unchanged.
          </p>
        )}
      </main>

      <footer className="bg-[var(--header-bg)] text-[var(--text-dim)]">
        <div className={`${SHELL} flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs`}>
          <p>
            <span className="font-semibold text-white">WeatherRoute</span>
            <span className="mx-2 text-slate-500">|</span>
            Truck Route Intelligence
          </p>
          <p>Powered by OpenFreeMap · OpenStreetMap · Open-Meteo</p>
        </div>
      </footer>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CalendarClock,
  Check,
  CloudRain,
  Flag,
  Info,
  Lightbulb,
  Loader2,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  Route as RouteIcon,
  Search,
  Snowflake,
  Thermometer,
  Weight,
  Wind,
  X,
} from 'lucide-react'

import { AppHeader } from '../components/AppHeader'
import { CheckpointDetails } from '../components/dashboard/CheckpointDetails'
import { DashField, dashControlClass } from '../components/dashboard/DashField'
import { MapView } from '../components/MapView'
import { PlaceField } from '../components/dashboard/PlaceField'
import { RouteDetails } from '../components/dashboard/RouteDetails'
import type { useTripSession } from '../hooks/useTripSession'
import type { Page } from '../lib/navigation'
import type { Theme } from '../lib/theme'
import {
  corridorHourStats,
  corridorRiskStops,
  corridorSampleAt,
} from '../lib/corridorHour'
import {
  formatDateTime,
  formatDuration,
  formatMiles,
  formatRiskScore,
  formatWeather,
} from '../lib/format'
import {
  RISK_COLORS,
  RISK_LABELS,
  RISK_LEVELS,
  routeColor,
  type HeatLayers,
} from '../lib/risk'
import { routeLetter, routeRoles } from '../lib/routeMeta'
import type { Checkpoint, PlanResponse, Route } from '../types'

type Session = ReturnType<typeof useTripSession>

interface DashboardPageProps {
  session: Session
  theme: Theme
  onTheme: (theme: Theme) => void
  onNavigate: (page: Page, hash?: string) => void
}

const INTERVALS: Array<10 | 25 | 50> = [10, 25, 50]
const FORECAST_TICKS = [0, 12, 24, 36, 48]
const FORECAST_PLAY_MS = 1000
const RANKING_ORDER =
  'Ranked by fewest Severe miles, then High miles, then lowest average risk, then shortest travel time.'

type WeatherOverlay = 'rain' | 'wind' | 'snow'

const WEATHER_OVERLAYS: Array<{
  id: WeatherOverlay
  label: string
  unit: string
  icon: typeof CloudRain
  swatch: string
}> = [
  { id: 'rain', label: 'Precipitation', unit: 'in/hr', icon: CloudRain, swatch: 'linear-gradient(90deg, #dbeafe, #3b82f6, #1e3a8a)' },
  { id: 'wind', label: 'Wind', unit: 'mph', icon: Wind, swatch: 'linear-gradient(90deg, #e0f2fe, #0284c7, #4c1d95)' },
  { id: 'snow', label: 'Snow', unit: 'in/hr', icon: Snowflake, swatch: 'linear-gradient(90deg, #ede9fe, #a78bfa, #4c1d95)' },
]

const OFF_LAYERS: HeatLayers = { risk: false, wind: false, rain: false, snow: false }
const SHELL = 'mx-auto w-full max-w-[1680px] px-4 sm:px-6'

function overlayLayers(on: boolean, metric: WeatherOverlay): HeatLayers {
  if (!on) return OFF_LAYERS
  return {
    risk: false,
    rain: metric === 'rain',
    wind: metric === 'wind',
    snow: metric === 'snow',
  }
}

function recommendationWhy(plan: PlanResponse): string {
  const reason = plan.recommendation.reasons.find((entry) => entry.trim().length > 0)
  return reason ?? RANKING_ORDER
}

function comparisonReason(plan: PlanResponse, route: Route): string {
  if (route.id === plan.recommendation.route_id) {
    return plan.recommendation.reasons[0] ?? 'Fewest severe miles, lower risk.'
  }
  const recommended = plan.routes.find((item) => item.id === plan.recommendation.route_id)
  if (!recommended) return route.label
  const faster = route.summary.duration_hours + 0.05 < recommended.summary.duration_hours
  const moreSevere =
    route.summary.miles_by_level.SEVERE > recommended.summary.miles_by_level.SEVERE + 0.5
  const moreHigh = route.summary.miles_by_level.HIGH > recommended.summary.miles_by_level.HIGH + 0.5
  if (faster && (moreSevere || moreHigh)) return 'Faster, but higher risk.'
  if (moreSevere || moreHigh) return 'Longer, higher weather risk.'
  if (faster) return 'Faster alternative.'
  return 'Alternative corridor.'
}

function pickCheckpoint(route: Route): Checkpoint | null {
  const points = route.checkpoints
  if (!points.length) return null
  const inner = points.length > 2 ? points.slice(1, -1) : points
  const ranked = [...inner].sort((a, b) => b.risk.score - a.risk.score)
  if (ranked[0] && ranked[0].risk.score > 0) return ranked[0]
  return inner[Math.floor(inner.length / 2)] ?? points[0]
}

function corridorGradient(stops: ReturnType<typeof corridorRiskStops>): string {
  if (!stops.length) return '#e2e8f0'
  return `linear-gradient(90deg, ${stops
    .map((stop) => `${RISK_COLORS[stop.level]} ${Math.round(stop.t * 100)}%`)
    .join(', ')})`
}

export function DashboardPage({ session, theme, onTheme, onNavigate }: DashboardPageProps) {
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

  const [overlayOn, setOverlayOn] = useState(true)
  const [weatherOverlay, setWeatherOverlay] = useState<WeatherOverlay>('rain')
  const [hiddenRouteIds, setHiddenRouteIds] = useState<string[]>([])
  const [rasterAvailable, setRasterAvailable] = useState(false)
  const [forecastPlaying, setForecastPlaying] = useState(false)
  const [panToFocused, setPanToFocused] = useState(false)

  useEffect(() => {
    setHiddenRouteIds([])
    setOverlayOn(true)
    setWeatherOverlay('rain')
    setForecastPlaying(false)
    setPanToFocused(false)
    if (!plan) {
      setFocused(null)
      return
    }
    const route =
      plan.routes.find((item) => item.id === plan.recommendation.route_id) ?? plan.routes[0]
    const checkpoint = route ? pickCheckpoint(route) : null
    setFocused(checkpoint ? { routeId: route.id, index: checkpoint.index } : null)
  }, [plan, plan?.generated_at, setFocused])

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
      const route = plan?.routes.find((item) => item.id === routeId)
      const checkpoint = route ? pickCheckpoint(route) : null
      setPanToFocused(false)
      setFocused(checkpoint ? { routeId, index: checkpoint.index } : null)
    },
    [plan, revealRoute, setFocused],
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
          const next = plan?.routes.find((item) => item.id === remaining[0].id)
          const checkpoint = next ? pickCheckpoint(next) : null
          setPanToFocused(false)
          setFocused(checkpoint ? { routeId: remaining[0].id, index: checkpoint.index } : null)
        }
        return [...current, routeId]
      })
    },
    [plan, selectedRouteId, selectRoute, setFocused],
  )

  const roles = useMemo(() => (plan ? routeRoles(plan) : {}), [plan])
  const heatLayers = overlayLayers(overlayOn, weatherOverlay)
  const overlayHasData = rasterAvailable || Boolean(corridor?.points.length)
  const recommended = plan?.routes.find((route) => route.id === plan.recommendation.route_id)
  const recommendedIndex = plan?.routes.findIndex((route) => route.id === plan.recommendation.route_id) ?? -1
  const whyCopy = plan ? recommendationWhy(plan) : RANKING_ORDER
  const focusedRoute = plan?.routes.find((route) => route.id === focused?.routeId) ?? null
  const focusedCheckpoint =
    focusedRoute && focused
      ? (focusedRoute.checkpoints.find((item) => item.index === focused.index) ?? null)
      : null
  const focusedRouteIndex = plan && focusedRoute ? plan.routes.findIndex((route) => route.id === focusedRoute.id) : -1
  const forecastUnavailable = Boolean(plan) && !corridorLoading && !corridor && !rasterAvailable
  const sliderMax = corridor ? Math.max(0, corridor.hours.length - 1) : 48
  const canSubmit = form.origin.trim().length > 1 && form.destination.trim().length > 1 && !planning

  useEffect(() => {
    if (!forecastPlaying || !plan || !overlayOn || sliderMax <= 0) return
    const timer = window.setInterval(() => {
      setHeatHour((hour) => (hour >= sliderMax ? 0 : hour + 1))
    }, FORECAST_PLAY_MS)
    return () => window.clearInterval(timer)
  }, [forecastPlaying, plan, overlayOn, sliderMax, setHeatHour])

  const activeOverlay = WEATHER_OVERLAYS.find((item) => item.id === weatherOverlay) ?? WEATHER_OVERLAYS[0]
  const showNoTravel = Boolean(plan?.routes.some((route) => route.summary.miles_by_level.NO_TRAVEL > 0.05))
  const fill = sliderMax === 0 ? 0 : (Math.min(heatHour, sliderMax) / sliderMax) * 100
  const hourStats = corridorHourStats(corridor, heatHour)
  const riskStops = corridorRiskStops(corridor, heatHour)
  const selectedDistance = selectedRoute?.summary.distance_miles ?? 0
  const locationForecast =
    focusedCheckpoint && corridor
      ? corridorSampleAt(corridor, focusedCheckpoint.lon, focusedCheckpoint.lat, heatHour)
      : null

  return (
    <div className="dash-app min-h-screen">
      <AppHeader page="planner" theme={theme} onTheme={onTheme} onNavigate={onNavigate} />

      <main className={`${SHELL} py-4 sm:py-5`}>
        <div className="dash-board">
          <aside className="dash-board-left flex flex-col gap-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-[17px] font-semibold tracking-tight text-slate-900">Plan Your Trip</h2>
              <form
                className="flex flex-col gap-3.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (canSubmit) void runPlan(form)
                }}
              >
                <PlaceField
                  label="Origin"
                  placeholder="City, state"
                  value={form.origin}
                  resolved={form.originPlace}
                  icon={<MapPin className="h-4 w-4" />}
                  onChange={(value) => updateField('origin', value)}
                  onResolve={(place) => updateField('originPlace', place)}
                />
                <PlaceField
                  label="Destination"
                  placeholder="City, state"
                  value={form.destination}
                  resolved={form.destinationPlace}
                  icon={<Flag className="h-4 w-4" />}
                  onChange={(value) => updateField('destination', value)}
                  onResolve={(place) => updateField('destinationPlace', place)}
                />
                <DashField label="Departure Date & Time" htmlFor="departure" icon={<CalendarClock className="h-4 w-4" />}>
                  <input
                    id="departure"
                    type="datetime-local"
                    value={form.departure}
                    className={dashControlClass}
                    onChange={(event) => updateField('departure', event.target.value)}
                  />
                </DashField>
                <DashField label="Load Weight (lbs)" htmlFor="load" icon={<Weight className="h-4 w-4" />}>
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
                <DashField label="Checkpoint Interval" htmlFor="interval" icon={<RouteIcon className="h-4 w-4" />}>
                  <select
                    id="interval"
                    value={form.intervalMiles}
                    className={dashControlClass}
                    onChange={(event) =>
                      updateField('intervalMiles', Number(event.target.value) as 10 | 25 | 50)
                    }
                  >
                    {INTERVALS.map((interval) => (
                      <option key={interval} value={interval}>
                        {interval} miles
                      </option>
                    ))}
                  </select>
                </DashField>
                {error && (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                    <p>{error}</p>
                    <button type="submit" className="mt-2 font-semibold text-red-800 underline" disabled={!canSubmit}>
                      Retry analysis
                    </button>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="dash-btn-analyze mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold shadow-sm disabled:cursor-not-allowed"
                >
                  {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {planning ? 'Analyzing routes…' : 'Analyze Routes'}
                </button>
                <p className="flex items-start gap-2 text-[12px] leading-5 text-slate-500">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  We’ll generate 3 route options, check weather at each checkpoint based on arrival time, and
                  recommend the safest route for your load.
                </p>
              </form>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Route Recommendation</h2>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                  Best Route
                </span>
              </div>
              {recommended && recommendedIndex >= 0 && plan ? (
                <button
                  type="button"
                  onClick={() => handleSelectRoute(recommended.id)}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-600 text-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <p className="text-sm font-semibold text-emerald-950">
                      Route {routeLetter(recommendedIndex)}
                    </p>
                    <i
                      className="ml-auto h-2.5 w-2.5 rounded-full"
                      style={{ background: routeColor(recommendedIndex) }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-emerald-900">{roles[recommended.id] ?? 'Safest scored corridor'}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MiniStat label="Travel time" value={formatDuration(recommended.summary.duration_hours)} />
                    <MiniStat label="Distance" value={formatMiles(recommended.summary.distance_miles)} />
                    <MiniStat label="Severe" value={`${Math.round(recommended.summary.miles_by_level.SEVERE)}`} />
                    <MiniStat label="High" value={`${Math.round(recommended.summary.miles_by_level.HIGH)}`} />
                    <MiniStat label="Avg. risk" value={formatRiskScore(recommended.summary.average_risk)} />
                    {showNoTravel && (
                      <MiniStat
                        label="No Travel"
                        value={`${Math.round(recommended.summary.miles_by_level.NO_TRAVEL)}`}
                      />
                    )}
                  </dl>
                  <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-slate-600">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    {whyCopy}
                  </p>
                </button>
              ) : (
                <EmptyNote
                  title="No ranking yet"
                  body="After analysis, the safest corridor is chosen by fewest Severe miles, then High miles, average risk, then travel time."
                />
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">All Routes</h2>
              {plan ? (
                <div className="space-y-2">
                  {plan.routes.map((route, index) => {
                    const selected = route.id === selectedRouteId
                    const isBest = route.id === plan.recommendation.route_id
                    return (
                      <button
                        key={route.id}
                        type="button"
                        onClick={() => handleSelectRoute(route.id)}
                        className={`w-full rounded-xl border p-3 text-left ${
                          selected
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <i className="h-2.5 w-2.5 rounded-full" style={{ background: routeColor(index) }} />
                          <p className="text-sm font-semibold text-slate-900">Route {routeLetter(index)}</p>
                          {isBest && (
                            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                              Recommended
                            </span>
                          )}
                          {!isBest && route.summary.max_level === 'NO_TRAVEL' && (
                            <span className="text-[10px] font-semibold text-slate-500">Highest risk</span>
                          )}
                        </div>
                        <dl className="mt-2 grid grid-cols-4 gap-2">
                          <MiniStat label="Time" value={formatDuration(route.summary.duration_hours)} />
                          <MiniStat label="Distance" value={formatMiles(route.summary.distance_miles)} />
                          <MiniStat label="Severe" value={`${Math.round(route.summary.miles_by_level.SEVERE)}`} />
                          <MiniStat label="High" value={`${Math.round(route.summary.miles_by_level.HIGH)}`} />
                        </dl>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Avg. risk {formatRiskScore(route.summary.average_risk)}
                        </p>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <EmptyNote title="No corridors yet" body="Analyze a trip to list the three scored alternatives." />
              )}
            </section>
          </aside>

          <section className="dash-board-map dash-map relative min-h-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:min-h-[480px]">
            <MapView
              theme={theme}
              className="dash-map"
              routes={plan?.routes ?? []}
              selectedRouteId={selectedRouteId}
              recommendedRouteId={plan?.recommendation.route_id ?? null}
              origin={plan?.request.origin ?? null}
              destination={plan?.request.destination ?? null}
              corridor={overlayOn && plan ? corridor : null}
              heatHour={heatHour}
              heatLayers={heatLayers}
              focused={focused}
              panToFocused={panToFocused}
              hiddenRouteIds={hiddenRouteIds}
              hideEmpty
              showJump={false}
              weatherRaster={overlayOn && Boolean(plan)}
              rasterOpacity={0.4}
              onSelectRoute={revealRoute}
              onFocusCheckpoint={setFocused}
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

            {plan && (
              <>
                <div className="absolute right-3 top-3 z-10 flex max-w-[min(100%-1.5rem,22rem)] flex-col items-end gap-2">
                  <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm">
                    <span className="text-xs font-semibold text-slate-700">Weather Overlay</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={overlayOn}
                      className="dash-switch"
                      onClick={() => setOverlayOn((value) => !value)}
                    >
                      <i />
                    </button>
                    <select
                      className="dash-overlay-select"
                      aria-label="Weather overlay layer"
                      value={weatherOverlay}
                      onChange={(event) => {
                        setOverlayOn(true)
                        setWeatherOverlay(event.target.value as WeatherOverlay)
                      }}
                    >
                      {WEATHER_OVERLAYS.map((layer) => (
                        <option key={layer.id} value={layer.id}>
                          {layer.label}
                        </option>
                      ))}
                    </select>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                      +{heatHour}h
                    </span>
                  </div>
                  {overlayOn && !corridorLoading && !overlayHasData && (
                    <div className="rounded-lg bg-white/95 px-3 py-1.5 text-xs text-amber-800 shadow-sm">
                      Live weather overlay unavailable
                    </div>
                  )}
                  <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-[11px] leading-4 text-slate-700 shadow-sm">
                    <p className="mb-1.5 font-semibold text-slate-800">Route Legend</p>
                    <div className="flex flex-col gap-1.5">
                      {(plan.routes ?? []).slice(0, 3).map((route, index) => {
                        const hidden = hiddenRouteIds.includes(route.id)
                        return (
                          <label
                            key={route.id}
                            className={`inline-flex cursor-pointer items-center gap-1.5 ${hidden ? 'text-slate-400' : 'text-slate-700'}`}
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3 accent-[#0b1f3a]"
                              checked={!hidden}
                              aria-label={`Show Route ${routeLetter(index)}`}
                              onChange={() => toggleRouteVisible(route.id)}
                            />
                            <i
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ background: routeColor(index), opacity: hidden ? 0.35 : 1 }}
                            />
                            Route {routeLetter(index)}
                          </label>
                        )
                      })}
                    </div>
                    <p className="mb-1.5 mt-2 font-semibold text-slate-800">Risk Level</p>
                    <div className="flex flex-col gap-1 text-slate-600">
                      {RISK_LEVELS.filter((level) => level !== 'NO_TRAVEL' || showNoTravel).map((level) => (
                        <span key={level} className="inline-flex items-center gap-1.5">
                          <i className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_COLORS[level] }} />
                          {RISK_LABELS[level]}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {overlayOn && (
                  <div className="absolute bottom-3 left-3 z-10 w-[min(100%-1.5rem,16rem)] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm">
                    <p className="text-[10px] font-semibold text-slate-600">
                      {activeOverlay.label} ({activeOverlay.unit})
                    </p>
                    <i className="mt-1 block h-2 w-full rounded-full" style={{ background: activeOverlay.swatch }} />
                    {rasterAvailable ? (
                      <p className="mt-1 text-[10px] text-slate-500">Open-Meteo map layer</p>
                    ) : corridor ? (
                      <p className="mt-1 text-[10px] text-slate-500">Corridor forecast</p>
                    ) : null}
                  </div>
                )}
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

          <aside className="dash-board-right flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Checkpoint Details</h2>
              {focusedCheckpoint && (
                <button
                  type="button"
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                  aria-label="Close checkpoint details"
                  onClick={() => setFocused(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {focusedCheckpoint && focusedRoute && plan && focusedRouteIndex >= 0 ? (
                <CheckpointDetails
                  route={focusedRoute}
                  routeIndex={focusedRouteIndex}
                  checkpoint={focusedCheckpoint}
                  origin={plan.request.origin.label}
                  destination={plan.request.destination.label}
                  loadLb={plan.request.load_lb}
                  heatHour={heatHour}
                  locationForecast={locationForecast}
                  corridorLoading={corridorLoading}
                />
              ) : (
                <EmptyNote
                  title="Select a checkpoint"
                  body="Click a marker on the map to inspect ETA weather, wind, rain, snow, temperature, risk, and load-rule reasons."
                />
              )}
            </div>
          </aside>

          <section className="dash-board-weather overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Weather & Forecast</h2>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                Forecast: +{heatHour}h
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ForecastStat
                icon={<Wind className="h-5 w-5 text-sky-600" />}
                label="Max wind"
                value={formatWeather(hourStats?.wind, 0, ' mph')}
                hint="along route"
                active={overlayOn && weatherOverlay === 'wind'}
              />
              <ForecastStat
                icon={<CloudRain className="h-5 w-5 text-blue-600" />}
                label="Peak rain"
                value={formatWeather(hourStats?.rain, 2, ' in/hr')}
                hint="along route"
                active={overlayOn && weatherOverlay === 'rain'}
              />
              <ForecastStat
                icon={<Snowflake className="h-5 w-5 text-indigo-500" />}
                label="Peak snow"
                value={formatWeather(hourStats?.snow, 1, ' in/hr')}
                hint="along route"
                active={overlayOn && weatherOverlay === 'snow'}
              />
              <ForecastStat
                icon={<Thermometer className="h-5 w-5 text-orange-500" />}
                label="Avg. temp"
                value={formatWeather(hourStats?.temp, 0, '°F')}
                hint="along route"
              />
            </dl>
            {!plan && (
              <p className="mt-3 text-xs text-slate-500">Analyze a trip to load the 0–48 hour corridor forecast.</p>
            )}
            {plan && corridorLoading && (
              <p className="mt-3 text-xs text-slate-500">Loading corridor forecast…</p>
            )}
            {forecastUnavailable && (
              <p className="mt-3 text-xs text-amber-800">Corridor forecast unavailable for this hour.</p>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                aria-pressed={forecastPlaying}
                aria-label={forecastPlaying ? 'Pause forecast' : 'Play forecast'}
                disabled={!plan}
                className="dash-btn-primary grid h-9 w-9 shrink-0 place-items-center rounded-lg disabled:cursor-not-allowed"
                onClick={() => setForecastPlaying((value) => !value)}
              >
                {forecastPlaying ? (
                  <Pause className="h-3.5 w-3.5" fill="currentColor" />
                ) : (
                  <Play className="h-3.5 w-3.5" fill="currentColor" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={sliderMax}
                step={1}
                value={Math.min(heatHour, sliderMax)}
                aria-label="Forecast hour offset, 0 to 48 hours"
                className="dash-forecast-slider min-w-0 flex-1"
                style={{
                  background: `linear-gradient(to right, #2563eb ${fill}%, #e2e8f0 ${fill}%)`,
                }}
                onPointerDown={() => setForecastPlaying(false)}
                onChange={(event) => setHeatHour(Number(event.target.value))}
                disabled={!plan}
              />
            </div>
            <div className="mt-1 flex justify-between pl-12 text-[11px] font-medium text-slate-500">
              {FORECAST_TICKS.map((tick) => (
                <span key={tick}>{tick}h</span>
              ))}
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold text-slate-900">Route risk along corridor (forecast)</h3>
              <div className="mt-2">
                <div
                  className="dash-risk-strip"
                  style={{ background: riskStops.length ? corridorGradient(riskStops) : undefined }}
                  aria-label="Forecast risk along the selected corridor"
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                  <span>0 mi</span>
                  {selectedDistance > 0 && <span>{Math.round(selectedDistance * 0.25)} mi</span>}
                  {selectedDistance > 0 && <span>{Math.round(selectedDistance * 0.5)} mi</span>}
                  {selectedDistance > 0 && <span>{Math.round(selectedDistance * 0.75)} mi</span>}
                  <span>{selectedDistance > 0 ? formatMiles(selectedDistance) : '—'}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                {RISK_LEVELS.filter((level) => level !== 'NO_TRAVEL' || showNoTravel).map((level) => (
                  <span key={level} className="inline-flex items-center gap-1">
                    <i className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS[level] }} />
                    {RISK_LABELS[level]}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                Forecast shows expected weather along the selected corridor at +{heatHour}h. Checkpoint risk
                still uses the forecast at each truck ETA, not this slider hour.
              </p>
            </div>
          </section>

          <section className="dash-board-compare overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Route Comparison</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">{RANKING_ORDER}</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedRoute && plan && (
                  <p className="text-[11px] text-slate-500">
                    Selected: Route {routeLetter(plan.routes.findIndex((route) => route.id === selectedRoute.id))}
                  </p>
                )}
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed"
                  disabled={!canSubmit}
                  onClick={() => void runPlan(form)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Recalculate
                </button>
              </div>
            </div>
            {plan ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Route</th>
                      <th className="px-3 py-2.5">Travel time</th>
                      <th className="px-3 py-2.5">Distance</th>
                      <th className="px-3 py-2.5">Severe miles</th>
                      <th className="px-3 py-2.5">High miles</th>
                      {showNoTravel && <th className="px-3 py-2.5">No Travel</th>}
                      <th className="px-3 py-2.5">Avg. risk</th>
                      <th className="px-3 py-2.5">Reason</th>
                      <th className="px-4 py-2.5 text-right"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.routes.map((route, index) => {
                      const selected = route.id === selectedRouteId
                      const isBest = route.id === plan.recommendation.route_id
                      return (
                        <tr
                          key={route.id}
                          className={`border-t border-slate-100 ${
                            isBest ? 'bg-emerald-50/70' : selected ? 'bg-slate-50' : 'bg-white'
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <i className="h-2.5 w-2.5 rounded-full" style={{ background: routeColor(index) }} />
                              <p className="font-semibold text-slate-900">Route {routeLetter(index)}</p>
                              {isBest && (
                                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                                  Recommended
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 font-medium text-slate-800">
                            {formatDuration(route.summary.duration_hours)}
                            {route.summary.arrival && (
                              <p className="text-[11px] font-normal text-slate-500">
                                {formatDateTime(route.summary.arrival)}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3 font-medium text-slate-800">
                            {formatMiles(route.summary.distance_miles)}
                          </td>
                          <td className="px-3 py-3 font-medium text-slate-800">
                            {Math.round(route.summary.miles_by_level.SEVERE)}
                          </td>
                          <td className="px-3 py-3 font-medium text-slate-800">
                            {Math.round(route.summary.miles_by_level.HIGH)}
                          </td>
                          {showNoTravel && (
                            <td className="px-3 py-3 font-medium text-slate-800">
                              {Math.round(route.summary.miles_by_level.NO_TRAVEL)}
                            </td>
                          )}
                          <td className="px-3 py-3 font-medium text-slate-800">
                            {formatRiskScore(route.summary.average_risk)}
                          </td>
                          <td className="max-w-[220px] px-3 py-3 text-[12px] leading-5 text-slate-600">
                            {comparisonReason(plan, route)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleSelectRoute(route.id)}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                selected
                                  ? 'dash-btn-primary'
                                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {selected ? 'Viewing' : 'View'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-8">
                <EmptyNote
                  title="No routes to compare"
                  body="Analyze a trip to fill this table with live Severe miles, High miles, average risk, distance, and ETA for each alternative."
                />
              </div>
            )}
            {plan && plan.routes.length < 3 && (
              <p className="border-t border-slate-100 px-4 py-3 text-[11px] leading-5 text-amber-800">
                The routing provider returned {plan.routes.length} distinct corridor
                {plan.routes.length === 1 ? '' : 's'}. Extra alternatives were requested via detours; none are
                fabricated.
              </p>
            )}
          </section>

          <RouteDetails
            plan={plan}
            selectedRouteId={selectedRouteId}
            focused={focused}
            onSelectRoute={handleSelectRoute}
            onFocusCheckpoint={handleFocusCheckpoint}
          />
        </div>
      </main>

      <footer className="bg-[#0b1f3a] text-slate-300">
        <div className={`${SHELL} flex flex-wrap items-center justify-between gap-2 py-3 text-xs`}>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="text-[12px] font-semibold text-slate-800">{value}</dd>
      <dt className="text-[10px] text-slate-500">{label}</dt>
    </div>
  )
}

function ForecastStat({
  icon,
  label,
  value,
  hint,
  active = false,
}: {
  icon: ReactNode
  label: string
  value: string
  hint: string
  active?: boolean
}) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${active ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-slate-50'}`}>
      <dt className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{value}</dd>
      <p className="text-[10px] text-slate-500">{hint}</p>
    </div>
  )
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-2 py-3 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{body}</p>
    </div>
  )
}

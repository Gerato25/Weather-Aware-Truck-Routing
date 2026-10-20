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
  Route as RouteIcon,
  Search,
  Snowflake,
  Thermometer,
  Truck,
  Weight,
  Wind,
} from 'lucide-react'

import { DashField, dashControlClass } from '../components/dashboard/DashField'
import { MapView } from '../components/MapView'
import { PlaceField } from '../components/dashboard/PlaceField'
import { RiskBadge } from '../components/dashboard/RiskBadge'
import type { useTripSession } from '../hooks/useTripSession'
import { corridorHourStats, levelFromScore } from '../lib/corridorHour'
import {
  formatDateTime,
  formatDuration,
  formatEta,
  formatEtaRelative,
  formatMiles,
  formatPounds,
  formatRiskScore,
  formatWeather,
  shortPlaceName,
} from '../lib/format'
import {
  RISK_COLORS,
  RISK_LABELS,
  RISK_LEVELS,
  routeColor,
  type HeatLayers,
} from '../lib/risk'
import { routeLetter, routeRoles } from '../lib/routeMeta'
import type { Checkpoint, CorridorResponse, PlanResponse, Route } from '../types'

type Session = ReturnType<typeof useTripSession>

interface DashboardPageProps {
  session: Session
}

const INTERVALS: Array<10 | 25 | 50> = [10, 25, 50]
const FORECAST_TICKS = [0, 12, 24, 36, 48]
/** One forecast hour on the overlay, animated. */
const FORECAST_PLAY_MS = 1000
const RANKING_ORDER =
  'Ranked by fewest Severe miles, then High miles, then lowest average risk, then shortest travel time. Load-specific wind rules can still produce No Travel.'

type WeatherOverlay = 'rain' | 'wind' | 'snow'

const WEATHER_OVERLAYS: Array<{
  id: WeatherOverlay
  label: string
  icon: typeof CloudRain
  swatch: string
}> = [
  { id: 'rain', label: 'Precipitation', icon: CloudRain, swatch: 'linear-gradient(90deg, #dbeafe, #3b82f6, #1e3a8a)' },
  { id: 'wind', label: 'Wind', icon: Wind, swatch: 'linear-gradient(90deg, #e0f2fe, #0284c7, #4c1d95)' },
  { id: 'snow', label: 'Snow', icon: Snowflake, swatch: 'linear-gradient(90deg, #ede9fe, #a78bfa, #4c1d95)' },
]

const OFF_LAYERS: HeatLayers = { risk: false, wind: false, rain: false, snow: false }
const SHELL = 'mx-auto w-full max-w-[1680px] px-4 sm:px-6'

function checkpointLabel(route: Route, checkpoint: Checkpoint, origin: string, destination: string) {
  if (checkpoint.index === 0) return `${shortPlaceName(origin)} (Start)`
  if (checkpoint.index === route.checkpoints.length - 1) return `${shortPlaceName(destination)} (End)`
  return `Mile ${Math.round(checkpoint.mile)}`
}

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

export function DashboardPage({ session }: DashboardPageProps) {
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
  const [forecastPlaying, setForecastPlaying] = useState(() => Boolean(plan))

  useEffect(() => {
    setHiddenRouteIds([])
    setOverlayOn(true)
    setWeatherOverlay('rain')
    setForecastPlaying(Boolean(plan))
  }, [plan?.generated_at])

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
      setFocused(null)
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
          setFocused(null)
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
  const showNoTravel = Boolean(
    plan?.routes.some((route) => route.summary.miles_by_level.NO_TRAVEL > 0.05),
  )
  const fill = sliderMax === 0 ? 0 : (Math.min(heatHour, sliderMax) / sliderMax) * 100

  return (
    <div className="min-h-screen bg-[#e8eef4] text-slate-800">
      <header className="bg-[#0b1f3a] text-white">
        <div className={`${SHELL} flex items-center justify-between py-3`}>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10">
              <Truck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold leading-none tracking-tight">WeatherRoute</p>
              <p className="mt-1 text-[11px] text-slate-300">Truck Route Intelligence</p>
            </div>
          </div>
          <p className="hidden text-sm text-slate-300 sm:block">Safer routes. Smarter decisions.</p>
        </div>
      </header>

      <main className={`${SHELL} space-y-4 py-4 sm:py-5`}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col gap-4">
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
                  className="dash-btn-primary mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold shadow-sm disabled:cursor-not-allowed"
                >
                  {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {planning ? 'Analyzing routes…' : 'Analyze Routes'}
                </button>
                <p className="flex items-start gap-2 text-[12px] leading-5 text-slate-500">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  We’ll generate 3 route options, score live weather at each checkpoint ETA, and
                  recommend the safest corridor for this load.
                </p>
              </form>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Recommended Route</h2>
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
                  <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <MiniStat label="ETA" value={formatDuration(recommended.summary.duration_hours)} />
                    <MiniStat label="Distance" value={formatMiles(recommended.summary.distance_miles)} />
                    <MiniStat label="Avg. risk" value={formatRiskScore(recommended.summary.average_risk)} />
                    <MiniStat label="Severe miles" value={`${Math.round(recommended.summary.miles_by_level.SEVERE)}`} />
                    <MiniStat label="High miles" value={`${Math.round(recommended.summary.miles_by_level.HIGH)}`} />
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
                  {whyCopy !== RANKING_ORDER && (
                    <p className="mt-2 text-[10px] leading-4 text-slate-500">{RANKING_ORDER}</p>
                  )}
                </button>
              ) : (
                <EmptyNote
                  title="No ranking yet"
                  body="After analysis, the safest corridor is chosen by fewest Severe miles, then High miles, average risk, then travel time. Load wind rules can still mark a stretch as No Travel."
                />
              )}
            </section>

            {focusedCheckpoint && focusedRoute && plan && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">Checkpoint</h2>
                <CheckpointPanel
                  route={focusedRoute}
                  checkpoint={focusedCheckpoint}
                  origin={plan.request.origin.label}
                  destination={plan.request.destination.label}
                  loadLb={plan.request.load_lb}
                />
              </section>
            )}
          </aside>

          <section className="dash-map relative min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:min-h-[580px] xl:min-h-[calc(100vh-7.5rem)]">
            <MapView
              theme="light"
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
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-50/55">
                <EmptyNote
                  title="Analyze a trip to draw routes"
                  body="Origin, destination, departure, and load are scored against live forecasts at each checkpoint ETA."
                />
              </div>
            )}

            <div className="absolute right-3 top-3 z-10 flex max-w-[min(100%-1.5rem,28rem)] flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  aria-pressed={overlayOn}
                  onClick={() => setOverlayOn((value) => !value)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm"
                >
                  Weather overlay
                  <span
                    className={`h-2 w-2 rounded-full ${overlayOn && overlayHasData ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  />
                </button>
              </div>
              <div
                className="flex overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm"
                role="radiogroup"
                aria-label="Weather overlay layer"
              >
                {WEATHER_OVERLAYS.map((layer) => {
                  const active = overlayOn && weatherOverlay === layer.id
                  const Icon = layer.icon
                  return (
                    <button
                      key={layer.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setOverlayOn(true)
                        setWeatherOverlay(layer.id)
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${
                        active ? 'dash-btn-primary' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {layer.label}
                    </button>
                  )
                })}
              </div>
              {plan && overlayOn && !corridorLoading && !overlayHasData && (
                <div className="rounded-lg bg-white/95 px-3 py-1.5 text-xs text-amber-800 shadow-sm">
                  Live weather overlay unavailable
                </div>
              )}
            </div>

            <div className="absolute bottom-[10.5rem] left-3 z-20 w-[min(100%-1.5rem,19rem)] rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-[11px] leading-4 text-slate-700 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {(plan?.routes ?? [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).slice(0, 3).map((route, index) => {
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
                        disabled={!plan}
                        aria-label={`Show Route ${routeLetter(index)}`}
                        onChange={() => plan && toggleRouteVisible(route.id)}
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
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-slate-600">
                {RISK_LEVELS.map((level) => (
                  <span key={level} className="inline-flex items-center gap-1">
                    <i className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS[level] }} />
                    {RISK_LABELS[level]}
                  </span>
                ))}
              </div>
              {overlayOn && (
                <p className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                  <i className="h-1.5 w-8 rounded-full" style={{ background: activeOverlay.swatch }} />
                  {activeOverlay.label}
                  {rasterAvailable ? ' map layer' : corridor ? ' corridor forecast' : ''}
                </p>
              )}
            </div>

            <div className="absolute inset-x-3 bottom-3 z-20 rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm">
              <ForecastSlider
                corridor={corridor}
                corridorLoading={corridorLoading}
                forecastUnavailable={forecastUnavailable}
                hasPlan={Boolean(plan)}
                heatHour={heatHour}
                sliderMax={sliderMax}
                fill={fill}
                rasterAvailable={rasterAvailable}
                overlayOn={overlayOn}
                overlayLabel={activeOverlay.label}
                playing={forecastPlaying}
                onPlayingChange={setForecastPlaying}
                onHourChange={setHeatHour}
              />
            </div>

            {planning && (
              <div className="absolute inset-0 z-30 grid place-items-center bg-white/60 text-sm font-medium text-slate-700">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sampling weather along each route…
                </span>
              </div>
            )}
          </section>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Route comparison</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">{RANKING_ORDER}</p>
            </div>
            {selectedRoute && (
              <p className="text-[11px] text-slate-500">
                Selected {formatMiles(selectedRoute.summary.distance_miles)} ·{' '}
                {formatDuration(selectedRoute.summary.duration_hours)}
              </p>
            )}
          </div>
          {plan ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Route</th>
                    <th className="px-3 py-2.5">Severe mi</th>
                    <th className="px-3 py-2.5">High mi</th>
                    {showNoTravel && <th className="px-3 py-2.5">No Travel</th>}
                    <th className="px-3 py-2.5">Avg. risk</th>
                    <th className="px-3 py-2.5">Distance</th>
                    <th className="px-3 py-2.5">ETA</th>
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
                            <div>
                              <p className="font-semibold text-slate-900">Route {routeLetter(index)}</p>
                              <p className="text-[11px] text-slate-500">{roles[route.id] ?? route.label}</p>
                            </div>
                            {isBest && (
                              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                                Recommended
                              </span>
                            )}
                          </div>
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
                        <td className="px-3 py-3 font-medium text-slate-800">
                          {formatMiles(route.summary.distance_miles)}
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-slate-800">
                            {formatDuration(route.summary.duration_hours)}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {route.summary.arrival ? formatDateTime(route.summary.arrival) : '—'}
                          </p>
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
              {plan.routes.length === 1 ? '' : 's'}. Extra alternatives were requested via detours;
              none are fabricated.
            </p>
          )}
        </section>
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

function HourStat({
  icon,
  label,
  value,
  active = false,
}: {
  icon: ReactNode
  label: string
  value: string
  active?: boolean
}) {
  return (
    <div className={`rounded-lg px-1 py-1 ${active ? 'bg-slate-100' : 'bg-slate-50'}`}>
      <dt className="inline-flex items-center justify-center gap-0.5 text-[10px] text-slate-500">
        {icon}
        {label}
      </dt>
      <dd className="text-[11px] font-semibold text-slate-800">{value}</dd>
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

function ForecastSlider({
  corridor,
  corridorLoading,
  forecastUnavailable,
  hasPlan,
  heatHour,
  sliderMax,
  fill,
  rasterAvailable,
  overlayOn,
  overlayLabel,
  playing,
  onPlayingChange,
  onHourChange,
}: {
  corridor: CorridorResponse | null
  corridorLoading: boolean
  forecastUnavailable: boolean
  hasPlan: boolean
  heatHour: number
  sliderMax: number
  fill: number
  rasterAvailable: boolean
  overlayOn: boolean
  overlayLabel: string
  playing: boolean
  onPlayingChange: (playing: boolean) => void
  onHourChange: (hour: number) => void
}) {
  const timestamp = corridor?.hours[heatHour]
    ? new Date(corridor.hours[heatHour])
    : new Date(Date.now() + heatHour * 3_600_000)
  const hourStats = corridorHourStats(corridor, heatHour)
  const hourLevel = levelFromScore(hourStats?.risk)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-800">
          Forecast {overlayOn ? overlayLabel.toLowerCase() : 'hour'} · +{heatHour}h
        </p>
        <p className="text-[11px] text-slate-500">
          {corridorLoading
            ? 'Loading corridor…'
            : forecastUnavailable
              ? 'Overlay unavailable'
              : timestamp.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
          {rasterAvailable && overlayOn ? ' · Open-Meteo' : ''}
        </p>
      </div>
      <dl className="mt-2 grid grid-cols-5 gap-1 text-center">
        <HourStat
          icon={<Wind className="h-3 w-3" />}
          label="Wind"
          value={formatWeather(hourStats?.wind, 0, ' mph')}
          active={overlayOn && overlayLabel === 'Wind'}
        />
        <HourStat
          icon={<CloudRain className="h-3 w-3" />}
          label="Rain"
          value={formatWeather(hourStats?.rain, 2, '"')}
          active={overlayOn && overlayLabel === 'Precipitation'}
        />
        <HourStat
          icon={<Snowflake className="h-3 w-3" />}
          label="Snow"
          value={formatWeather(hourStats?.snow, 1, '"')}
          active={overlayOn && overlayLabel === 'Snow'}
        />
        <HourStat
          icon={<Thermometer className="h-3 w-3" />}
          label="Temp"
          value={formatWeather(hourStats?.temp, 0, '°F')}
        />
        <div className="rounded-lg bg-slate-50 px-1 py-1">
          <dt className="text-[10px] text-slate-500">Risk</dt>
          <dd className="mt-0.5 flex justify-center">
            {hourStats ? (
              <RiskBadge level={hourLevel} />
            ) : (
              <span className="text-[11px] font-semibold text-slate-400">—</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          aria-pressed={playing}
          aria-label={playing ? 'Pause forecast' : 'Play forecast'}
          disabled={!hasPlan}
                          className="dash-btn-primary grid h-8 w-8 shrink-0 place-items-center rounded-lg disabled:cursor-not-allowed"
          onClick={() => onPlayingChange(!playing)}
        >
          {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
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
            background: `linear-gradient(to right, #0b1f3a ${fill}%, #e2e8f0 ${fill}%)`,
          }}
          onPointerDown={() => onPlayingChange(false)}
          onChange={(event) => onHourChange(Number(event.target.value))}
          disabled={!hasPlan}
        />
      </div>
      <div className="mt-1 flex justify-between pl-10 text-[11px] font-medium text-slate-500">
        {FORECAST_TICKS.map((tick) => (
          <span key={tick}>{tick}h</span>
        ))}
      </div>
    </div>
  )
}

function CheckpointPanel({
  route,
  checkpoint,
  origin,
  destination,
  loadLb,
}: {
  route: Route
  checkpoint: Checkpoint
  origin: string
  destination: string
  loadLb: number
}) {
  const relative = formatEtaRelative(checkpoint.eta)
  const weather = checkpoint.weather
  return (
    <>
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-4 w-4 text-slate-400" />
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {checkpointLabel(route, checkpoint, origin, destination)}
          </p>
          <p className="text-xs text-slate-500">
            ETA {formatEta(checkpoint.eta)}
            {relative ? ` (${relative})` : ''}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
        <div>
          <dt className="inline-flex items-center gap-1 text-[10px] text-slate-500">
            <Wind className="h-3.5 w-3.5" /> Wind
          </dt>
          <dd className="text-sm font-semibold">{formatWeather(weather.wind_mph, 0, ' mph')}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-slate-500">Gusts</dt>
          <dd className="text-sm font-semibold">{formatWeather(weather.wind_gust_mph, 0, ' mph')}</dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1 text-[10px] text-slate-500">
            <CloudRain className="h-3.5 w-3.5" /> Rain
          </dt>
          <dd className="text-sm font-semibold">{formatWeather(weather.rain_in_hr, 2, ' in/hr')}</dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1 text-[10px] text-slate-500">
            <Snowflake className="h-3.5 w-3.5" /> Snow
          </dt>
          <dd className="text-sm font-semibold">{formatWeather(weather.snow_in_hr, 1, ' in/hr')}</dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1 text-[10px] text-slate-500">
            <Thermometer className="h-3.5 w-3.5" /> Temp
          </dt>
          <dd className="text-sm font-semibold">{formatWeather(weather.temperature_f, 0, '°F')}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-slate-500">Risk</dt>
          <dd className="flex justify-center pt-0.5">
            <RiskBadge level={checkpoint.risk.level} />
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Load weight
        <span className="ml-2 font-semibold text-slate-800">{formatPounds(loadLb)}</span>
      </p>
      {checkpoint.risk.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] leading-5 text-slate-600">
          {checkpoint.risk.reasons.map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      )}
      {checkpoint.risk.available === false && (
        <p className="mt-3 text-[11px] leading-5 text-amber-800">
          Weather was unavailable at this arrival time; the checkpoint was not scored as Low.
        </p>
      )}
    </>
  )
}

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  CalendarClock,
  CloudRain,
  Flag,
  Loader2,
  MapPin,
  Pause,
  Play,
  Search,
  Snowflake,
  Thermometer,
  Weight,
  Wind,
  Route as RouteIcon,
} from 'lucide-react'

import { AppHeader } from '../components/AppHeader'
import { CheckpointDetails } from '../components/dashboard/CheckpointDetails'
import { DashField, dashControlClass } from '../components/dashboard/DashField'
import { MapView } from '../components/MapView'
import { PlaceField } from '../components/dashboard/PlaceField'
import { RouteCompareStrip, RouteDetails } from '../components/dashboard/RouteDetails'
import type { useTripSession } from '../hooks/useTripSession'
import type { Page } from '../lib/navigation'
import type { Theme } from '../lib/theme'
import {
  corridorHourStats,
  corridorRiskStops,
  corridorSampleAt,
} from '../lib/corridorHour'
import { truckAtHour } from '../lib/truckAtHour'
import {
  formatDateTime,
  formatForecastStamp,
  formatWeather,
} from '../lib/format'
import type { OverlayMode } from '../lib/corridorHeat'
import {
  RISK_COLORS,
  RISK_LABELS,
  RISK_LEVELS,
  routeColor,
} from '../lib/risk'
import { routeLetter } from '../lib/routeMeta'
import type { Checkpoint } from '../types'

type Session = ReturnType<typeof useTripSession>

interface DashboardPageProps {
  session: Session
  theme: Theme
  onTheme: (theme: Theme) => void
  onNavigate: (page: Page, hash?: string) => void
}

const INTERVALS: Array<10 | 25 | 50> = [10, 25, 50]
const FORECAST_PLAY_MS = 1000
const SHELL = 'mx-auto w-full max-w-[1680px] px-3 sm:px-4'

function forecastTicks(max: number): number[] {
  if (max <= 0) return [0]
  const step = max <= 12 ? Math.max(1, Math.round(max / 4)) : max <= 24 ? 6 : 12
  const ticks: number[] = []
  for (let hour = 0; hour <= max; hour += step) ticks.push(hour)
  if (ticks[ticks.length - 1] !== max) ticks.push(max)
  return ticks
}

const OVERLAY_MODES: Array<{ id: OverlayMode; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'wind', label: 'Wind' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'off', label: 'Off' },
]

const DETAIL_SCALES: Record<
  'wind' | 'rain' | 'snow',
  { label: string; unit: string; swatch: string; ticks: string[] }
> = {
  rain: {
    label: 'Rain',
    unit: 'in/hr',
    swatch: 'linear-gradient(90deg, #dbeafe, #3b82f6, #1e3a8a)',
    ticks: ['0', '0.10', '0.25', '0.50', '1.00'],
  },
  wind: {
    label: 'Wind',
    unit: 'mph',
    swatch: 'linear-gradient(90deg, #e0f2fe, #0284c7, #4c1d95)',
    ticks: ['0', '25', '35', '45', '55'],
  },
  snow: {
    label: 'Snow',
    unit: 'in/hr',
    swatch: 'linear-gradient(90deg, #ede9fe, #a78bfa, #4c1d95)',
    ticks: ['0', '0.5', '1.0', '2.0', '3.0'],
  },
}

function pickCheckpoint(route: { checkpoints: Checkpoint[] }): Checkpoint | null {
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

  const [overlayMode, setOverlayMode] = useState<OverlayMode>('all')
  const [hiddenRouteIds, setHiddenRouteIds] = useState<string[]>([])
  const [rasterAvailable, setRasterAvailable] = useState(false)
  const [forecastPlaying, setForecastPlaying] = useState(false)
  const [panToFocused, setPanToFocused] = useState(false)

  useEffect(() => {
    setHiddenRouteIds([])
    setOverlayMode('all')
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

  const overlayHasData = rasterAvailable || Boolean(corridor?.points.length)
  const focusedRoute = plan?.routes.find((route) => route.id === focused?.routeId) ?? null
  const focusedCheckpoint =
    focusedRoute && focused
      ? (focusedRoute.checkpoints.find((item) => item.index === focused.index) ?? null)
      : null
  const focusedRouteIndex = plan && focusedRoute ? plan.routes.findIndex((route) => route.id === focusedRoute.id) : -1
  const forecastUnavailable = Boolean(plan) && !corridorLoading && !corridor && !rasterAvailable
  const sliderMax = corridor ? Math.max(0, Math.min(48, corridor.hours.length - 1)) : 48
  const overlayAt = corridor?.hours[Math.min(heatHour, sliderMax)] ?? null
  const canSubmit = form.origin.trim().length > 1 && form.destination.trim().length > 1 && !planning

  useEffect(() => {
    if (!forecastPlaying || !plan || overlayMode === 'off' || sliderMax <= 0) return
    const timer = window.setInterval(() => {
      setHeatHour((hour) => (hour >= sliderMax ? 0 : hour + 1))
    }, FORECAST_PLAY_MS)
    return () => window.clearInterval(timer)
  }, [forecastPlaying, plan, overlayMode, sliderMax, setHeatHour])

  const detailScale =
    overlayMode === 'wind' || overlayMode === 'rain' || overlayMode === 'snow'
      ? DETAIL_SCALES[overlayMode]
      : null
  const showNoTravel = Boolean(plan?.routes.some((route) => route.summary.miles_by_level.NO_TRAVEL > 0.05))
  const fill = sliderMax === 0 ? 0 : (Math.min(heatHour, sliderMax) / sliderMax) * 100
  const hourStats = corridorHourStats(corridor, heatHour)
  const hourHasOverlay = Boolean(
    hourStats &&
      [hourStats.wind, hourStats.rain, hourStats.snow, hourStats.temp].some(
        (value) => value != null && Number.isFinite(value),
      ),
  )
  const riskStops = corridorRiskStops(corridor, heatHour)
  const truck = truckAtHour(selectedRoute, heatHour)
  const truckForecast =
    truck && corridor ? corridorSampleAt(corridor, truck.lon, truck.lat, heatHour) : null
  const locationWeather = truckForecast ?? hourStats
  const locationForecast =
    focusedCheckpoint && corridor
      ? corridorSampleAt(corridor, focusedCheckpoint.lon, focusedCheckpoint.lat, heatHour)
      : null

  return (
    <div className="dash-app min-h-screen">
      <AppHeader page="planner" theme={theme} onTheme={onTheme} onNavigate={onNavigate} />

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
                onChange={(event) =>
                  updateField('intervalMiles', Number(event.target.value) as 10 | 25 | 50)
                }
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
            Demo weather: 40 mph wind on Route A (42,000 lb → Severe). Re-analyze to apply.
          </label>
          {error && (
            <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {error}
            </div>
          )}
        </form>

        <div className="dash-map-row has-drawer">
          <aside className="dash-drawer-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-3 py-2">
              <h2 className="text-sm font-semibold text-slate-900">Routes</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Compare time, distance, and weather risk</p>
            </div>
            {plan ? (
              <div className="border-b border-slate-100 p-2">
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

            {plan && (
              <>
                <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
                  <div className="flex flex-wrap items-center justify-end gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm">
                    <div className="dash-overlay-tabs" role="tablist" aria-label="Weather overlay">
                      {OVERLAY_MODES.map((layer) => (
                        <button
                          key={layer.id}
                          type="button"
                          role="tab"
                          aria-selected={overlayMode === layer.id}
                          className="dash-overlay-tab"
                          onClick={() => setOverlayMode(layer.id)}
                        >
                          {layer.label}
                        </button>
                      ))}
                    </div>
                    <span className="px-1.5 text-[11px] font-semibold text-slate-600">+{heatHour}h</span>
                  </div>
                  {overlayMode !== 'off' && !corridorLoading && !overlayHasData && (
                    <div className="rounded-lg bg-white/95 px-3 py-1.5 text-xs text-amber-800 shadow-sm">
                      Live weather overlay unavailable
                    </div>
                  )}
                  <div className="rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-[10px] leading-4 text-slate-700 shadow-sm">
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {(plan.routes ?? []).slice(0, 3).map((route, index) => (
                        <label key={route.id} className="flex cursor-pointer items-center gap-1">
                          <input
                            type="checkbox"
                            className="h-3 w-3 accent-[#0b1f3a]"
                            checked={!hiddenRouteIds.includes(route.id)}
                            aria-label={`Show Route ${routeLetter(index)}`}
                            onChange={() => toggleRouteVisible(route.id)}
                          />
                          <i className="h-2 w-2 rounded-full" style={{ background: routeColor(index) }} />
                          {routeLetter(index)}
                        </label>
                      ))}
                    </div>
                    <p className="font-semibold text-slate-800">Color = risk level</p>
                    {detailScale ? (
                      <div className="mt-0.5">
                        <p className="text-[9px] text-slate-500">
                          {detailScale.label} ({detailScale.unit})
                        </p>
                        <i className="mt-0.5 block h-1.5 w-full rounded-full" style={{ background: detailScale.swatch }} />
                        <div className="mt-0.5 flex justify-between text-[8px] tabular-nums text-slate-500">
                          {detailScale.ticks.map((tick) => (
                            <span key={tick}>{tick}</span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {RISK_LEVELS.filter((level) => level !== 'NO_TRAVEL' || showNoTravel).map((level) => (
                          <span key={level} className="inline-flex items-center gap-1">
                            <i className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS[level] }} />
                            {RISK_LABELS[level]}
                          </span>
                        ))}
                      </span>
                    )}
                    <p className="mb-0.5 mt-1.5 font-semibold text-slate-800">Symbol = cause</p>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="inline-flex items-center gap-1">
                        <CauseGlyph kind="wind" />
                        arrow wind
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CauseGlyph kind="rain" />
                        drop rain
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CauseGlyph kind="snow" />
                        flake snow
                      </span>
                    </span>
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
            <div className="border-b border-slate-100 px-3 py-2">
              <h2 className="text-sm font-semibold text-slate-900">Checkpoint Details</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Weather at the selected stop’s truck ETA</p>
            </div>
            <div className="p-3">
              {focusedCheckpoint && focusedRoute && plan && focusedRouteIndex >= 0 ? (
                <CheckpointDetails
                  route={focusedRoute}
                  routeIndex={focusedRouteIndex}
                  checkpoint={focusedCheckpoint}
                  origin={plan.request.origin.label}
                  destination={plan.request.destination.label}
                  loadLb={plan.request.load_lb}
                  departure={plan.request.departure}
                  heatHour={heatHour}
                  overlayAt={overlayAt}
                  locationForecast={locationForecast}
                  corridorLoading={corridorLoading}
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

        <section className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:px-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-xs font-semibold text-slate-700">Forecast time</p>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              +{heatHour}h{overlayAt ? ` · ${formatDateTime(overlayAt)}` : ''}
            </span>
            <button
              type="button"
              aria-pressed={forecastPlaying}
              aria-label={forecastPlaying ? 'Pause forecast' : 'Play forecast'}
              disabled={!plan}
              className="dash-btn-primary grid h-8 w-8 shrink-0 place-items-center rounded-lg disabled:cursor-not-allowed"
              onClick={() => setForecastPlaying((value) => !value)}
            >
              {forecastPlaying ? (
                <Pause className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                <Play className="h-3.5 w-3.5" fill="currentColor" />
              )}
            </button>
            <div className="min-w-[12rem] flex-1">
              <input
                type="range"
                min={0}
                max={sliderMax}
                step={1}
                value={Math.min(heatHour, sliderMax)}
                aria-label={`Forecast hour offset, 0 to ${sliderMax} hours`}
                className="dash-forecast-slider w-full"
                style={{
                  background: `linear-gradient(to right, #2563eb ${fill}%, #e2e8f0 ${fill}%)`,
                }}
                onPointerDown={() => setForecastPlaying(false)}
                onChange={(event) => setHeatHour(Number(event.target.value))}
                disabled={!plan}
              />
              <div className="mt-0.5 flex justify-between text-[10px] font-medium text-slate-500">
                {forecastTicks(sliderMax).map((tick) => (
                  <span key={tick}>{tick}h</span>
                ))}
              </div>
            </div>
            <dl className="flex flex-wrap gap-3 text-[12px]">
              <InlineStat icon={<Wind className="h-3.5 w-3.5 text-sky-600" />} label="Wind" value={formatWeather(locationWeather?.wind, 0, ' mph')} />
              <InlineStat icon={<CloudRain className="h-3.5 w-3.5 text-blue-600" />} label="Rain" value={formatWeather(locationWeather?.rain, 2, ' in/hr')} />
              <InlineStat icon={<Snowflake className="h-3.5 w-3.5 text-indigo-500" />} label="Snow" value={formatWeather(locationWeather?.snow, 1, ' in/hr')} />
              <InlineStat icon={<Thermometer className="h-3.5 w-3.5 text-orange-500" />} label="Temp" value={formatWeather(locationWeather?.temp, 0, '°F')} />
            </dl>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div
              className="dash-risk-strip min-w-[10rem] flex-1"
              style={{ background: riskStops.length ? corridorGradient(riskStops) : undefined }}
              aria-label="Forecast risk along the selected corridor"
            />
            <div className="flex flex-wrap items-center gap-x-2.5 text-[10px] text-slate-600">
              {RISK_LEVELS.filter((level) => level !== 'NO_TRAVEL' || showNoTravel).map((level) => (
                <span key={level} className="inline-flex items-center gap-1">
                  <i className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS[level] }} />
                  {RISK_LABELS[level]}
                </span>
              ))}
            </div>
            {truck && selectedRoute && (
              <p className="text-[10px] text-slate-500">
                {truck.arrived ? 'Truck arrived' : `Truck near mile ${Math.round(truck.mile)}`} · overlay only
              </p>
            )}
          </div>
          {forecastUnavailable && (
            <p className="mt-2 text-xs text-amber-800">Corridor forecast unavailable for this hour.</p>
          )}
          {plan && corridor && !corridorLoading && !hourHasOverlay && (
            <p className="mt-2 text-xs text-amber-800">
              No overlay forecast for {overlayAt ? formatForecastStamp(overlayAt) : `+${heatHour}h`}. ETA weather is unchanged.
            </p>
          )}
        </section>
      </main>

      <footer className="bg-[#0b1f3a] text-slate-300">
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

function CauseGlyph({ kind }: { kind: 'wind' | 'rain' | 'snow' }) {
  if (kind === 'wind') {
    return (
      <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-slate-700" aria-hidden>
        <path fill="currentColor" d="M8 1.2 13.2 8H9.6v6.8H6.4V8H2.8z" />
      </svg>
    )
  }
  if (kind === 'rain') {
    return (
      <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-slate-700" aria-hidden>
        <path fill="currentColor" d="M8 1.4C8 1.4 3.4 7.2 3.4 10.1a4.6 4.6 0 0 0 9.2 0C12.6 7.2 8 1.4 8 1.4z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-slate-700" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        d="M8 2v12M2.5 5.2l11 5.6M2.5 10.8l11-5.6"
      />
    </svg>
  )
}

function InlineStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      {icon}
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  )
}

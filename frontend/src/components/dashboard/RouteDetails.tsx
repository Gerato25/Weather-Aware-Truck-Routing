import { CheckCircle2 } from 'lucide-react'

import type { CheckpointRef } from '../MapView'
import {
  formatDuration,
  formatEta,
  formatMiles,
  formatRiskScore,
  formatWeather,
  shortPlaceName,
} from '../../lib/format'
import { RISK_LABELS, routeColor } from '../../lib/risk'
import { routeLetter } from '../../lib/routeMeta'
import type { Checkpoint, PlanResponse, RiskDisplaySlug, Route } from '../../types'

interface RouteDetailsProps {
  plan: PlanResponse | null
  selectedRouteId: string | null
  focused: CheckpointRef | null
  compact?: boolean
  embedded?: boolean
  onSelectRoute: (routeId: string) => void
  onFocusCheckpoint: (ref: CheckpointRef) => void
}

const RANKING_ORDER =
  'Ranked by fewest Severe miles, then High miles, lowest average risk, then shortest travel time.'

const BADGE_STYLE: Record<RiskDisplaySlug, { background: string; color: string }> = {
  LOW: { background: '#16a34a', color: '#ffffff' },
  MODERATE: { background: '#eab308', color: '#422006' },
  HIGH: { background: '#f97316', color: '#ffffff' },
  SEVERE: { background: '#ef4444', color: '#ffffff' },
  NO_TRAVEL: { background: '#7f1d1d', color: '#ffffff' },
  UNKNOWN: { background: '#94a3b8', color: '#0f172a' },
}

function checkpointLabel(route: Route, checkpoint: Checkpoint, origin: string, destination: string) {
  if (checkpoint.index === 0) return `${shortPlaceName(origin)} (Start)`
  if (checkpoint.index === route.checkpoints.length - 1) return `${shortPlaceName(destination)} (End)`
  return `Mile ${Math.round(checkpoint.mile)}`
}

function comparisonReason(plan: PlanResponse, route: Route): string {
  if (route.id === plan.recommendation.route_id) {
    return plan.recommendation.reasons[0] ?? 'Best overall balance of safety and travel time.'
  }
  const recommended = plan.routes.find((item) => item.id === plan.recommendation.route_id)
  if (!recommended) return route.label
  const faster = route.summary.duration_hours + 0.05 < recommended.summary.duration_hours
  const moreSevere =
    route.summary.miles_by_level.SEVERE > recommended.summary.miles_by_level.SEVERE + 0.5
  const moreHigh = route.summary.miles_by_level.HIGH > recommended.summary.miles_by_level.HIGH + 0.5
  if (faster && (moreSevere || moreHigh)) return 'Faster, but higher weather risk.'
  if (moreSevere || moreHigh) return 'Longer route with higher overall risk.'
  if (faster) return 'Faster alternative with similar risk.'
  return 'Alternative corridor.'
}

export function RouteCompareStrip({
  plan,
  selectedRouteId,
  onSelectRoute,
}: {
  plan: PlanResponse
  selectedRouteId: string | null
  onSelectRoute: (routeId: string) => void
}) {
  const selectedId =
    plan.routes.find((route) => route.id === selectedRouteId)?.id ?? plan.routes[0]?.id ?? null

  return (
    <div className="flex flex-col gap-1.5">
      {plan.routes.slice(0, 3).map((route, index) => {
        const active = route.id === selectedId
        const recommended = route.id === plan.recommendation.route_id
        const noTravel = route.summary.miles_by_level.NO_TRAVEL > 0.05
        const reason = comparisonReason(plan, route)
        return (
          <button
            key={route.id}
            type="button"
            onClick={() => onSelectRoute(route.id)}
            className={`w-full min-w-0 rounded-lg border px-2 py-2 text-left transition ${
              active
                ? 'border-blue-300 bg-blue-50/80 shadow-sm'
                : recommended
                  ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: routeColor(index) }} />
              <span className="text-[11px] font-semibold text-slate-900">
                Route {routeLetter(index)}
              </span>
              {recommended && (
                <span className="rounded-full bg-emerald-600 px-1.5 py-px text-[8px] font-semibold leading-none text-white">
                  Recommended
                </span>
              )}
            </span>
            <dl className={`mt-1.5 grid gap-x-1.5 gap-y-1 ${noTravel ? 'grid-cols-3' : 'grid-cols-5'}`}>
              <MiniStat label="Travel time" value={formatDuration(route.summary.duration_hours)} />
              <MiniStat label="Distance" value={formatMiles(route.summary.distance_miles)} />
              <MiniStat label="Severe mi" value={`${Math.round(route.summary.miles_by_level.SEVERE)}`} />
              <MiniStat label="High mi" value={`${Math.round(route.summary.miles_by_level.HIGH)}`} />
              <MiniStat label="Avg. risk" value={formatRiskScore(route.summary.average_risk)} />
              {noTravel && (
                <MiniStat label="No Travel" value={`${Math.round(route.summary.miles_by_level.NO_TRAVEL)}`} />
              )}
            </dl>
            <span
              className={`mt-1.5 flex items-start gap-1 text-[10px] leading-[13px] ${
                recommended ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              {recommended && <CheckCircle2 className="mt-px h-3 w-3 shrink-0" />}
              {reason}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dd className="truncate text-[11px] font-semibold tabular-nums leading-4 text-slate-800">{value}</dd>
      <dt className="truncate text-[8px] leading-3 text-slate-500">{label}</dt>
    </div>
  )
}

export function RouteDetails({
  plan,
  selectedRouteId,
  focused,
  compact = false,
  embedded = false,
  onSelectRoute,
  onFocusCheckpoint,
}: RouteDetailsProps) {
  const selected =
    plan?.routes.find((route) => route.id === selectedRouteId) ?? plan?.routes[0] ?? null
  const origin = plan?.request.origin.label ?? ''
  const destination = plan?.request.destination.label ?? ''
  const tight = compact || embedded

  return (
    <section
      className={
        embedded
          ? 'flex min-h-0 shrink-0 flex-col border-t border-slate-100'
          : `flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${
              compact ? 'dash-drawer' : 'rounded-2xl'
            }`
      }
    >
      <div
        className={`flex flex-wrap items-end justify-between gap-2 ${
          embedded ? 'px-3 py-2' : tight ? 'border-b border-slate-100 px-3 py-2' : 'border-b border-slate-100 px-4 py-3'
        }`}
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Route Details</h2>
          <p className={`mt-0.5 text-[11px] text-slate-500 ${tight ? 'leading-4' : ''}`}>
            {RANKING_ORDER}
          </p>
        </div>
        {selected && (
          <p className="text-[11px] text-slate-500">
            {selected.checkpoints.length} checkpoints · arrival-time forecast
          </p>
        )}
      </div>

      {plan && selected ? (
        <>
          {!embedded && (
          <div
            className={`flex flex-wrap items-center gap-1.5 ${tight ? 'px-3 pt-2' : 'px-4 pt-3'}`}
            role="tablist"
          >
            {plan.routes.map((route, index) => {
              const active = route.id === selected.id
              return (
                <button
                  key={route.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    active
                      ? 'dash-btn-primary'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => onSelectRoute(route.id)}
                >
                  <i className="h-2 w-2 rounded-full" style={{ background: routeColor(index) }} />
                  Route {routeLetter(index)}
                </button>
              )
            })}
          </div>
          )}

          <div
            className={`dash-table-scroll min-h-0 flex-1 overflow-auto rounded-xl border border-slate-100 ${
              embedded
                ? 'mx-2 mb-2 mt-1 max-h-64'
                : compact
                  ? 'mx-2 mb-2 mt-2 max-h-none'
                  : 'mx-4 my-3 max-h-72'
            }`}
          >
            <table className={`w-full text-left ${embedded ? 'text-[11px]' : tight ? 'min-w-[640px] text-[12px]' : 'min-w-[720px] text-[13px]'}`}>
              <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2">Checkpoint</th>
                  <th className="px-2 py-2">Dist</th>
                  <th className="px-2 py-2">ETA</th>
                  <th className="px-2 py-2">Risk</th>
                  {!embedded && (
                    <>
                      <th className="px-3 py-2.5">Wind</th>
                      <th className="px-3 py-2.5">Rain</th>
                      <th className="px-3 py-2.5">Snow</th>
                      <th className="px-3 py-2.5">Temp</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {selected.checkpoints.map((checkpoint) => {
                  const active =
                    focused?.routeId === selected.id && focused.index === checkpoint.index
                  const gusts =
                    checkpoint.weather.wind_gust_mph != null &&
                    Number.isFinite(checkpoint.weather.wind_gust_mph)
                      ? ` (gust ${Math.round(checkpoint.weather.wind_gust_mph)})`
                      : ''
                  return (
                    <tr
                      key={checkpoint.index}
                      className={`cursor-pointer border-t border-slate-100 ${
                        active ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'
                      }`}
                      onClick={() =>
                        onFocusCheckpoint({ routeId: selected.id, index: checkpoint.index })
                      }
                    >
                      <td className="px-2 py-1.5 font-medium text-slate-800">
                        <span className="inline-flex items-center gap-1.5">
                          <i
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: BADGE_STYLE[checkpoint.risk.level].background }}
                          />
                          {checkpointLabel(selected, checkpoint, origin, destination)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">
                        {Math.round(checkpoint.mile)} mi
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">
                        {formatEta(checkpoint.eta)}
                      </td>
                      <td className="px-2 py-1.5">
                        <CompactRiskBadge level={checkpoint.risk.level} />
                      </td>
                      {!embedded && (
                        <>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                            {formatWeather(checkpoint.weather.wind_mph, 0, ' mph')}
                            {checkpoint.weather.wind_mph == null ? '' : gusts}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                            {formatWeather(checkpoint.weather.rain_in_hr, 2, ' in/hr')}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                            {formatWeather(checkpoint.weather.snow_in_hr, 1, ' in/hr')}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                            {formatWeather(checkpoint.weather.temperature_f, 0, '°F')}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">No routes yet</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Analyze a trip to compare three corridors and inspect checkpoint weather at each arrival time.
          </p>
        </div>
      )}
    </section>
  )
}

function CompactRiskBadge({ level }: { level: RiskDisplaySlug }) {
  const style = BADGE_STYLE[level]
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
      style={style}
    >
      {RISK_LABELS[level]}
    </span>
  )
}

import type { ReactNode } from 'react'
import { Clock3, Gauge, Mountain, Route as RouteIcon, Weight } from 'lucide-react'

import type { CheckpointRef } from '../MapView'
import {
  formatDuration,
  formatEta,
  formatMiles,
  formatPounds,
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
  onSelectRoute: (routeId: string) => void
  onFocusCheckpoint: (ref: CheckpointRef) => void
}

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

export function RouteDetails({
  plan,
  selectedRouteId,
  focused,
  onSelectRoute,
  onFocusCheckpoint,
}: RouteDetailsProps) {
  const selected =
    plan?.routes.find((route) => route.id === selectedRouteId) ?? plan?.routes[0] ?? null
  const origin = plan?.request.origin.label ?? ''
  const destination = plan?.request.destination.label ?? ''

  return (
    <section className="dash-board-details overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Route Details</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Checkpoint weather is the forecast at each arrival time. Click a row to inspect it on the
            map.
          </p>
        </div>
        {plan && (
          <dl className="flex flex-wrap gap-2">
            <InfoChip
              icon={<Weight className="h-3.5 w-3.5" />}
              label="Load weight"
              value={formatPounds(plan.request.load_lb)}
            />
            <InfoChip
              icon={<RouteIcon className="h-3.5 w-3.5" />}
              label="Checkpoint interval"
              value={`${plan.request.interval_miles} miles`}
            />
          </dl>
        )}
      </div>

      {plan && selected ? (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 pt-3" role="tablist" aria-label="Route details">
            {plan.routes.map((route, index) => {
              const active = route.id === selected.id
              return (
                <button
                  key={route.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold ${
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

          <dl className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-3 xl:grid-cols-5">
            <Metric
              icon={<Clock3 className="h-3.5 w-3.5" />}
              label="Travel time"
              value={formatDuration(selected.summary.duration_hours)}
            />
            <Metric
              icon={<RouteIcon className="h-3.5 w-3.5" />}
              label="Distance"
              value={formatMiles(selected.summary.distance_miles)}
            />
            <Metric
              icon={<Mountain className="h-3.5 w-3.5" />}
              label="Severe risk miles"
              value={`${Math.round(selected.summary.miles_by_level.SEVERE)}`}
            />
            <Metric
              icon={<Mountain className="h-3.5 w-3.5" />}
              label="High risk miles"
              value={`${Math.round(selected.summary.miles_by_level.HIGH)}`}
            />
            <Metric
              icon={<Gauge className="h-3.5 w-3.5" />}
              label="Average risk"
              value={formatRiskScore(selected.summary.average_risk)}
            />
          </dl>

          <div className="dash-table-scroll mx-4 mb-4 h-64 overflow-y-auto overflow-x-auto rounded-xl border border-slate-100 sm:h-72">
            <table className="w-full min-w-[560px] table-fixed text-left text-[13px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-[28%] px-3 py-2.5">Checkpoint</th>
                  <th className="w-[14%] px-3 py-2.5">ETA</th>
                  <th className="w-[14%] px-3 py-2.5">Wind</th>
                  <th className="w-[16%] px-3 py-2.5">Rain</th>
                  <th className="w-[16%] px-3 py-2.5">Snow</th>
                  <th className="w-[12%] px-3 py-2.5">Risk</th>
                </tr>
              </thead>
              <tbody>
                {selected.checkpoints.map((checkpoint) => {
                  const active =
                    focused?.routeId === selected.id && focused.index === checkpoint.index
                  return (
                    <tr
                      key={checkpoint.index}
                      className={`cursor-pointer border-t border-slate-100 ${
                        active ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                      onClick={() =>
                        onFocusCheckpoint({ routeId: selected.id, index: checkpoint.index })
                      }
                    >
                      <td className="truncate px-3 py-2 font-medium text-slate-800">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <i
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              background: BADGE_STYLE[checkpoint.risk.level].background,
                            }}
                          />
                          <span className="truncate">
                            {checkpointLabel(selected, checkpoint, origin, destination)}
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {formatEta(checkpoint.eta)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {formatWeather(checkpoint.weather?.wind_mph, 0, ' mph')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {formatWeather(checkpoint.weather?.rain_in_hr, 2, ' in/hr')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {formatWeather(checkpoint.weather?.snow_in_hr, 1, ' in/hr')}
                      </td>
                      <td className="px-3 py-2">
                        <CompactRiskBadge level={checkpoint.risk.level} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">No checkpoints yet</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Analyze a trip to list each checkpoint’s ETA, wind, rain, snow, and risk for Route A, B,
            and C.
          </p>
        </div>
      )}
    </section>
  )
}

function InfoChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
      <dt className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
        {icon}
        {label}
      </dt>
      <dd className="text-[12px] font-semibold text-slate-800">{value}</dd>
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <dt className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tracking-tight text-slate-900">{value}</dd>
    </div>
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

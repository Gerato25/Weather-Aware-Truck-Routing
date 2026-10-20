import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CloudRain, Snowflake, Thermometer, Wind } from 'lucide-react'

import { corridorSampleAt } from '../../lib/corridorHour'
import {
  formatEta,
  formatEtaRelative,
  formatPounds,
  formatWeather,
  shortPlaceName,
} from '../../lib/format'
import { RISK_COLORS, RISK_LABELS } from '../../lib/risk'
import { routeLetter } from '../../lib/routeMeta'
import type { Checkpoint, RiskDisplaySlug, Route } from '../../types'

interface CheckpointDetailsProps {
  route: Route
  routeIndex: number
  checkpoint: Checkpoint
  origin: string
  destination: string
  loadLb: number
  heatHour: number
  locationForecast: ReturnType<typeof corridorSampleAt>
  corridorLoading: boolean
}

const METER_WIDTH: Record<RiskDisplaySlug, number> = {
  LOW: 22,
  MODERATE: 44,
  HIGH: 66,
  SEVERE: 84,
  NO_TRAVEL: 100,
  UNKNOWN: 0,
}

function reasonCopy(checkpoint: Checkpoint, loadLb: number): string {
  if (checkpoint.risk.available === false) {
    return 'Weather was unavailable at this arrival time; this checkpoint was not scored as Low.'
  }
  if (checkpoint.risk.reasons.length > 0) {
    return checkpoint.risk.reasons.join(' ')
  }
  if (checkpoint.risk.level === 'LOW') {
    return 'Low risk due to conditions within thresholds, within load limits.'
  }
  return `Risk uses the forecast at this checkpoint’s ETA. Load ${formatPounds(loadLb)}.`
}

function checkpointLabel(route: Route, checkpoint: Checkpoint, origin: string, destination: string) {
  if (checkpoint.index === 0) return `${shortPlaceName(origin)} (Start)`
  if (checkpoint.index === route.checkpoints.length - 1) return `${shortPlaceName(destination)} (End)`
  return `Mile ${Math.round(checkpoint.mile)}`
}

function etaOffset(iso: string | null): string | null {
  const relative = formatEtaRelative(iso)
  if (!relative || relative === 'now') return relative
  return relative.replace(/^in /, '+')
}

function badgeLabel(level: RiskDisplaySlug): string {
  if (level === 'NO_TRAVEL' || level === 'UNKNOWN') return RISK_LABELS[level]
  return `${RISK_LABELS[level]} Risk`
}

export function CheckpointDetails({
  route,
  routeIndex,
  checkpoint,
  origin,
  destination,
  loadLb,
  heatHour,
  locationForecast,
  corridorLoading,
}: CheckpointDetailsProps) {
  const weather = checkpoint.weather
  const relative = etaOffset(checkpoint.eta)
  const level = checkpoint.risk.level
  const low = level === 'LOW'
  const gusts =
    weather.wind_gust_mph != null && Number.isFinite(weather.wind_gust_mph)
      ? Math.round(weather.wind_gust_mph)
      : null

  return (
    <div className="cp-details">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="cp-title truncate text-[15px] font-semibold tracking-tight">
            {checkpointLabel(route, checkpoint, origin, destination)} (Route {routeLetter(routeIndex)})
          </p>
          <p className="mt-0.5 text-[12px] text-slate-500">
            ETA {formatEta(checkpoint.eta)}
            {relative ? ` (${relative})` : ''}
          </p>
        </div>
        <span className="cp-pill shrink-0" data-level={level}>
          {badgeLabel(level)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-4 gap-1.5">
        <WeatherTile
          icon={<Wind strokeWidth={1.75} className="h-6 w-6" />}
          value={formatWeather(weather.wind_mph, 0, ' mph')}
          hint={gusts == null ? 'Wind' : `Gusts ${gusts}`}
        />
        <WeatherTile
          icon={<CloudRain strokeWidth={1.75} className="h-6 w-6" />}
          value={formatWeather(weather.rain_in_hr, 2, ' in/hr')}
          hint="Rain"
        />
        <WeatherTile
          icon={<Snowflake strokeWidth={1.75} className="h-6 w-6" />}
          value={formatWeather(weather.snow_in_hr, 1, ' in/hr')}
          hint="Snow"
        />
        <WeatherTile
          icon={<Thermometer strokeWidth={1.75} className="h-6 w-6" />}
          value={formatWeather(weather.temperature_f, 0, '°F')}
          hint="Temp"
        />
      </dl>

      <div className={`cp-reason mt-3 ${low ? 'is-low' : 'is-elevated'}`}>
        {low ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: RISK_COLORS[level] }} />
        )}
        <p>{reasonCopy(checkpoint, loadLb)}</p>
      </div>

      <div className="mt-5">
        <h3 className="text-[13px] font-semibold text-slate-900">Forecast at this location</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">+{heatHour}h (from now)</p>

        {corridorLoading && !locationForecast ? (
          <p className="mt-3 text-[12px] text-slate-500">Loading corridor forecast…</p>
        ) : locationForecast ? (
          <>
            <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Conditions
            </p>
            <dl className="space-y-2">
              <ConditionRow
                icon={<Wind className="h-4 w-4" />}
                label="Wind"
                value={
                  gusts == null
                    ? formatWeather(locationForecast.wind, 0, ' mph')
                    : `${formatWeather(locationForecast.wind, 0, ' mph')} (gusts ${gusts})`
                }
              />
              <ConditionRow
                icon={<CloudRain className="h-4 w-4" />}
                label="Rain"
                value={formatWeather(locationForecast.rain, 2, ' in/hr')}
              />
              <ConditionRow
                icon={<Snowflake className="h-4 w-4" />}
                label="Snow"
                value={formatWeather(locationForecast.snow, 1, ' in/hr')}
              />
              <ConditionRow
                icon={<Thermometer className="h-4 w-4" />}
                label="Temperature"
                value={formatWeather(locationForecast.temp, 0, '°F')}
              />
            </dl>

            <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Risk breakdown
            </p>
            <div className="space-y-2.5">
              <RiskMeter label="Wind Risk" level={checkpoint.risk.components.wind} />
              <RiskMeter label="Rain Risk" level={checkpoint.risk.components.rain} />
              <RiskMeter label="Snow Risk" level={checkpoint.risk.components.snow} />
            </div>
          </>
        ) : (
          <p className="mt-3 text-[12px] text-amber-800">Forecast at this location is unavailable.</p>
        )}
      </div>
    </div>
  )
}

function WeatherTile({
  icon,
  value,
  hint,
}: {
  icon: ReactNode
  value: string
  hint: string
}) {
  return (
    <div className="cp-tile">
      <dt className="cp-tile-icon">{icon}</dt>
      <dd className="mt-1 text-[11px] font-semibold leading-tight text-slate-900">{value}</dd>
      <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>
    </div>
  )
}

function ConditionRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <dt className="inline-flex items-center gap-2 text-slate-500">
        <span className="cp-cond-icon">{icon}</span>
        {label}
      </dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  )
}

function RiskMeter({ label, level }: { label: string; level: RiskDisplaySlug }) {
  const color = RISK_COLORS[level]
  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_4.5rem] items-center gap-2">
      <p className="text-[11px] font-medium text-slate-600">{label}</p>
      <div className="cp-meter">
        <i style={{ width: `${METER_WIDTH[level]}%`, background: color }} />
      </div>
      <p className="text-right text-[11px] font-semibold" style={{ color }}>
        {RISK_LABELS[level]}
      </p>
    </div>
  )
}

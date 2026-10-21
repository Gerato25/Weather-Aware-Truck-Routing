import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CloudRain, Snowflake, Thermometer, Wind } from 'lucide-react'

import {
  compassFromDeg,
  formatEtaRelative,
  formatForecastStamp,
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
  departure: string
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

function etaOffset(iso: string | null, departure: string): string | null {
  return formatEtaRelative(iso, departure)
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
  departure,
}: CheckpointDetailsProps) {
  const weather = checkpoint.weather
  const relative = etaOffset(checkpoint.eta, departure)
  const windUsed =
    checkpoint.risk.wind_used_mph != null && Number.isFinite(checkpoint.risk.wind_used_mph)
      ? Math.round(checkpoint.risk.wind_used_mph)
      : null
  const level = checkpoint.risk.level
  const low = level === 'LOW'
  const etaAvailable = checkpoint.risk.available !== false
  const gusts =
    weather.wind_gust_mph != null && Number.isFinite(weather.wind_gust_mph)
      ? Math.round(weather.wind_gust_mph)
      : null
  const windDir = weather.wind_dir ?? compassFromDeg(weather.wind_dir_deg)

  return (
    <div className="cp-details">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="cp-title truncate text-[15px] font-semibold tracking-tight">
            {checkpointLabel(route, checkpoint, origin, destination)} (Route {routeLetter(routeIndex)})
          </p>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Truck ETA {formatForecastStamp(checkpoint.eta)}
            {relative ? ` (${relative})` : ''}
          </p>
          <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
            {checkpoint.lat.toFixed(4)}, {checkpoint.lon.toFixed(4)} · mile {checkpoint.mile.toFixed(1)}
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
          hint={[windDir, gusts == null ? 'Wind mph' : `Gusts ${gusts} mph`].filter(Boolean).join(' · ')}
        />
        <WeatherTile
          icon={<CloudRain strokeWidth={1.75} className="h-6 w-6" />}
          value={formatWeather(weather.rain_in_hr, 2, ' in/hr')}
          hint="Rain in/hr"
        />
        <WeatherTile
          icon={<Snowflake strokeWidth={1.75} className="h-6 w-6" />}
          value={formatWeather(weather.snow_in_hr, 1, ' in/hr')}
          hint="Snow in/hr"
        />
        <WeatherTile
          icon={<Thermometer strokeWidth={1.75} className="h-6 w-6" />}
          value={formatWeather(weather.temperature_f, 0, '°F')}
          hint="Temp °F"
        />
      </dl>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {etaAvailable
          ? `Forecast matched to the truck’s arrival (${formatForecastStamp(weather.forecast_at ?? checkpoint.eta)}). Risk uses the higher of sustained wind and gusts${
              windUsed != null ? ` (${windUsed} mph)` : ''
            }.`
          : 'Forecast unavailable for this arrival time.'}
      </p>

      <div className={`cp-reason mt-3 ${low ? 'is-low' : 'is-elevated'}`}>
        {low ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: RISK_COLORS[level] }} />
        )}
        <p>{reasonCopy(checkpoint, loadLb)}</p>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Risk at truck ETA
        </p>
        <div className="space-y-2.5">
          <RiskMeter label="Wind Risk" level={checkpoint.risk.components.wind} />
          <RiskMeter label="Rain Risk" level={checkpoint.risk.components.rain} />
          <RiskMeter label="Snow Risk" level={checkpoint.risk.components.snow} />
        </div>
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

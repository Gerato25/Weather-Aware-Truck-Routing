import { Pause, Play } from 'lucide-react'

import { routeLiveStatus, sampleMetricScore } from '../lib/weatherPath'
import { formatDateTime } from '../lib/format'
import type { OverlayMode } from '../lib/corridorHeat'
import { RISK_COLORS, rampColor } from '../lib/risk'
import { routeLetter } from '../lib/routeMeta'
import type { PlanResponse } from '../types'

const AXIS_TICKS = [0, 6, 12, 18, 24, 30, 36, 42, 48]
const MODES: Array<{ id: OverlayMode; label: string }> = [
  { id: 'all', label: 'Risk' },
  { id: 'wind', label: 'Wind' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
]
/** Half the 16px range thumb, so 0h/48h line up with the slider value. */
const THUMB_INSET = 8

interface CorridorPanelProps {
  plan: PlanResponse | null
  selectedRouteId: string | null
  heatHour: number
  sliderMax: number
  overlayMode: OverlayMode
  overlayAt: string | null
  forecastPlaying: boolean
  showNoTravel: boolean
  onMode: (mode: OverlayMode) => void
  onHour: (hour: number) => void
  onPlay: () => void
}

function stripGradient(
  route: PlanResponse['routes'][number],
  maxHour: number,
  mode: OverlayMode,
): string {
  const path = route.weather_path
  const arrival = Math.min(maxHour, Math.max(0.1, route.summary.duration_hours))
  if (!path?.length) {
    const end = (arrival / maxHour) * 100
    return `linear-gradient(90deg, var(--track) 0%, var(--track) ${end.toFixed(2)}%, var(--track) 100%)`
  }
  const parts: string[] = []
  for (const sample of path) {
    if (sample.t > arrival) break
    const pct = Math.max(0, Math.min(100, (sample.t / maxHour) * 100))
    const score = sampleMetricScore(sample, mode)
    const stormsOnly = mode === 'wind' || mode === 'rain' || mode === 'snow'
    const color =
      score < 0
        ? RISK_COLORS.UNKNOWN
        : stormsOnly && score < 1
          ? 'var(--track)'
          : rampColor(score)
    parts.push(`${color} ${pct.toFixed(2)}%`)
  }
  const end = (arrival / maxHour) * 100
  parts.push(`var(--track) ${end.toFixed(2)}%`, `var(--track) 100%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

function formatHourOffset(hour: number): string {
  const rounded = Math.round(hour * 10) / 10
  return Number.isInteger(rounded) ? `+${rounded}h` : `+${rounded.toFixed(1)}h`
}

function axisLeft(pct: number): string {
  const t = Math.max(0, Math.min(1, pct))
  return `calc(${THUMB_INSET}px + (100% - ${THUMB_INSET * 2}px) * ${t})`
}

export function CorridorPanel({
  plan,
  selectedRouteId,
  heatHour,
  sliderMax,
  overlayMode,
  overlayAt,
  forecastPlaying,
  showNoTravel: _showNoTravel,
  onMode,
  onHour,
  onPlay,
}: CorridorPanelProps) {
  const heatmapOn = overlayMode !== 'off'
  const fill = sliderMax === 0 ? 0 : (Math.min(heatHour, sliderMax) / sliderMax) * 100
  const hourT = sliderMax === 0 ? 0 : Math.min(heatHour, sliderMax) / sliderMax
  const recommended = plan?.routes.find((route) => route.id === plan.recommendation.route_id)
  const etaT =
    recommended && sliderMax > 0
      ? Math.min(1, recommended.summary.duration_hours / sliderMax)
      : null
  const stripRows = plan?.routes.length ?? 0

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          role="switch"
          aria-checked={heatmapOn}
          className="dash-switch"
          onClick={() => onMode(heatmapOn ? 'off' : 'all')}
        >
          <i />
        </button>
        <span className="text-xs font-semibold text-slate-700">Heatmap</span>
        <div className="dash-overlay-tabs" role="tablist" aria-label="Corridor weather metric">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={overlayMode === mode.id}
              className="dash-overlay-tab"
              onClick={() => onMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={forecastPlaying}
          aria-label={forecastPlaying ? 'Pause forecast' : 'Play forecast'}
          disabled={!plan}
          className="dash-btn-primary grid h-8 w-8 shrink-0 place-items-center rounded-lg disabled:cursor-not-allowed"
          onClick={onPlay}
        >
          {forecastPlaying ? (
            <Pause className="h-3.5 w-3.5" fill="currentColor" />
          ) : (
            <Play className="h-3.5 w-3.5" fill="currentColor" />
          )}
        </button>
        <p className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-slate-700">
          {formatHourOffset(heatHour)}
          {overlayAt ? ` ${formatDateTime(overlayAt)}` : ''}
        </p>
      </div>

      <div
        className="mt-2 grid items-center gap-x-3 gap-y-2"
        style={{ gridTemplateColumns: '4.5rem minmax(0,1fr) minmax(11rem,auto)' }}
      >
        {plan && stripRows > 0 && (
          <div
            className="pointer-events-none relative col-start-2 self-stretch"
            style={{ gridRow: `2 / ${2 + stripRows}` }}
            aria-hidden
          >
            <i className="dash-hour-line" style={{ left: axisLeft(hourT) }} />
          </div>
        )}

        <div className="col-start-2 row-start-1">
          <div className="relative pt-2">
            {etaT != null && (
              <span
                className="pointer-events-none absolute -top-0.5 z-[1] -translate-x-1/2 text-[11px] leading-none"
                style={{ left: axisLeft(etaT) }}
                title="Recommended route arrival"
              >
                🚩
              </span>
            )}
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={0.1}
              value={Math.min(heatHour, sliderMax)}
              aria-label={`Forecast hour offset, 0 to ${sliderMax} hours`}
              className="dash-forecast-slider w-full"
              style={{
                background: `linear-gradient(to right, var(--track-fill) ${fill}%, var(--track) ${fill}%)`,
              }}
              onChange={(event) => onHour(Number(event.target.value))}
              disabled={!plan}
            />
            <div
              className="mt-0.5 flex justify-between text-[10px] font-medium text-slate-500"
              style={{ paddingLeft: THUMB_INSET, paddingRight: THUMB_INSET }}
            >
              {AXIS_TICKS.filter((tick) => tick <= sliderMax).map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
          </div>
        </div>

        {plan?.routes.map((route, index) => {
          const status = routeLiveStatus(route, heatHour, overlayMode)
          const selected = route.id === selectedRouteId
          const arrivalT = sliderMax > 0 ? Math.min(1, route.summary.duration_hours / sliderMax) : 0
          const row = index + 2
          return (
            <div key={route.id} className="contents">
              <span
                className={`text-[11px] font-bold text-slate-800 ${selected ? '' : 'opacity-90'}`}
                style={{ gridRow: row, gridColumn: 1 }}
              >
                Route {routeLetter(index)}
              </span>
              <div
                className={`relative min-h-[10px] ${selected ? '' : 'opacity-90'}`}
                style={{ gridRow: row, gridColumn: 2 }}
              >
                <div
                  className="h-2.5 overflow-hidden rounded-full"
                  style={{
                    marginLeft: THUMB_INSET,
                    marginRight: THUMB_INSET,
                    background: stripGradient(route, sliderMax, overlayMode),
                  }}
                  aria-label={`Route ${routeLetter(index)} ${overlayMode === 'off' ? 'risk' : overlayMode} until arrival`}
                />
                <i
                  className="pointer-events-none absolute top-1/2 z-[1] h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-slate-900"
                  style={{ left: axisLeft(arrivalT) }}
                  title="Arrival"
                />
              </div>
              <p
                className={`flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-[11px] leading-4 ${selected ? '' : 'opacity-90'}`}
                style={{ gridRow: row, gridColumn: 3 }}
              >
                <span
                  className="inline-flex items-center gap-1 font-bold tabular-nums"
                  style={{ color: RISK_COLORS[status.arrived ? 'LOW' : status.level] }}
                >
                  <i
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: RISK_COLORS[status.arrived ? 'LOW' : status.level] }}
                  />
                  {status.text}
                </span>
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

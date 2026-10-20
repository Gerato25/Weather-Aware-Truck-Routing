import type { Route } from '../types'

interface RouteConditionsProps {
  route: Route
}

export function RouteConditions({ route }: RouteConditionsProps) {
  const winds = route.checkpoints
    .map((cp) => cp.weather.wind_mph)
    .filter((value): value is number => value !== null)
  const temps = route.checkpoints
    .map((cp) => cp.weather.temperature_f)
    .filter((value): value is number => value !== null)
  const highestWind = winds.length ? Math.max(...winds) : null
  const lowestTemp = temps.length ? Math.min(...temps) : null

  return (
    <section className="panel route-conditions">
      <h2>Route Conditions</h2>
      <dl>
        <div>
          <dt>Highest Wind</dt>
          <dd>{highestWind === null ? '—' : `${Math.round(highestWind)} mph`}</dd>
        </div>
        <div>
          <dt>Lowest Temp</dt>
          <dd>{lowestTemp === null ? '—' : `${Math.round(lowestTemp)}°F`}</dd>
        </div>
      </dl>
    </section>
  )
}

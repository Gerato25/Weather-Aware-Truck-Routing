"""Builds the 0-48 hour weather heatmap for the trip corridor.

The client posts a thinned set of points along the chosen route and gets back a
``point x hour`` grid of risk scores. The whole 48-hour series comes down in one
response so the time slider scrubs instantly against data already in the browser
instead of refetching on every tick.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from django.conf import settings

from .geo import Coord, initial_bearing_deg, miles_to_meters, offset_coord
from .risk import RiskLevel, assess_score
from .weather.open_meteo import OpenMeteoClient, PointForecast, snap

# Lateral offsets from the route centreline, which give the heatmap a corridor
# with width rather than a thin line of points.
LATERAL_OFFSETS_MILES = (-30.0, 0.0, 30.0)
MAX_CORRIDOR_POINTS = 240
DEFAULT_HOURS = 48


@dataclass(frozen=True)
class CorridorRequest:
    seeds: list[Coord]
    load_lb: float
    anchor: datetime
    hours: int = DEFAULT_HOURS


def _thin(seeds: list[Coord], max_points: int) -> list[Coord]:
    """Drop intermediate seeds so the expanded corridor stays under the cap."""
    per_seed = len(LATERAL_OFFSETS_MILES)
    allowed = max(2, max_points // per_seed)
    if len(seeds) <= allowed:
        return seeds
    step = len(seeds) / allowed
    thinned = [seeds[int(i * step)] for i in range(allowed)]
    if thinned[-1] != seeds[-1]:
        thinned[-1] = seeds[-1]
    return thinned


def expand(seeds: list[Coord]) -> list[Coord]:
    """Widen a centreline into a corridor of sample points."""
    seeds = _thin(seeds, MAX_CORRIDOR_POINTS)
    if len(seeds) < 2:
        return list(seeds)

    points: list[Coord] = []
    seen: set[Coord] = set()
    for i, seed in enumerate(seeds):
        # Perpendicular to the local direction of travel.
        nxt = seeds[min(i + 1, len(seeds) - 1)]
        prv = seeds[max(i - 1, 0)]
        heading = initial_bearing_deg(prv, nxt) if prv != nxt else 0.0

        for offset_miles in LATERAL_OFFSETS_MILES:
            if offset_miles == 0.0:
                candidate = seed
            else:
                side = 90 if offset_miles > 0 else -90
                candidate = offset_coord(
                    seed, heading + side, miles_to_meters(abs(offset_miles))
                )
            key = snap(candidate)
            if key in seen:
                continue
            seen.add(key)
            points.append(candidate)
    return points


def build_heatmap(
    request: CorridorRequest, weather_client: OpenMeteoClient | None = None
) -> dict:
    """Return the corridor point grid with per-hour risk and raw weather values."""
    hours = max(1, min(72, request.hours))
    points = expand(request.seeds)
    if not points:
        return {"points": [], "hours": [], "risk": [], "wind": [], "rain": [], "snow": []}

    # Align the series to the top of the hour so every point shares a time axis.
    anchor = request.anchor.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    timestamps = [anchor + timedelta(hours=h) for h in range(hours + 1)]

    client = weather_client or OpenMeteoClient()
    forecast_days = client.forecast_days_for(timestamps[-1])
    forecasts: dict[Coord, PointForecast] = client.forecasts(points, forecast_days)

    wind_metric = settings.WIND_RISK_METRIC
    risk_grid: list[list[int]] = []
    wind_grid: list[list[float]] = []
    rain_grid: list[list[float]] = []
    snow_grid: list[list[float]] = []
    kept_points: list[list[float]] = []

    for point in points:
        forecast = forecasts.get(snap(point))
        if forecast is None or not forecast.times:
            continue

        risk_row: list[int] = []
        wind_row: list[float] = []
        rain_row: list[float] = []
        snow_row: list[float] = []
        for ts in timestamps:
            sample = forecast.sample_at(ts.timestamp())
            risk_row.append(
                assess_score(
                    sample.wind_mph,
                    sample.wind_gust_mph,
                    sample.rain_in_hr,
                    sample.snow_in_hr,
                    request.load_lb,
                    wind_metric,
                )
            )
            wind_row.append(round(sample.effective_wind(wind_metric), 1))
            rain_row.append(sample.rain_in_hr)
            snow_row.append(sample.snow_in_hr)

        kept_points.append([round(point[0], 4), round(point[1], 4)])
        risk_grid.append(risk_row)
        wind_grid.append(wind_row)
        rain_grid.append(rain_row)
        snow_grid.append(snow_row)

    return {
        "anchor": anchor.isoformat(),
        "hours": [ts.isoformat() for ts in timestamps],
        "points": kept_points,
        "risk": risk_grid,
        "wind": wind_grid,
        "rain": rain_grid,
        "snow": snow_grid,
        "max_score": int(RiskLevel.NO_TRAVEL),
        "load_lb": request.load_lb,
    }

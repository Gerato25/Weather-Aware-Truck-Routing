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
from .risk import RiskLevel, assess
from .weather.open_meteo import OpenMeteoClient, PointForecast, forecasts_for_request, snap
from .weather.storms import build_demo_scenario

# Lateral offsets from the route centreline, which give the heatmap a corridor
# with width rather than a thin line of points.
# Open-Meteo bills every location, so the corridor is three points wide.
LATERAL_OFFSETS_MILES = (-15.0, 0.0, 15.0)
MAX_CORRIDOR_POINTS = 180
DEFAULT_HOURS = 48


@dataclass(frozen=True)
class DemoStormPoint:
    lon: float
    lat: float
    wind_mph: float
    wind_dir_deg: float | None = None


@dataclass(frozen=True)
class CorridorRequest:
    seeds: list[Coord]
    load_lb: float
    anchor: datetime
    hours: int = DEFAULT_HOURS
    demo_scenario: str = ""
    demo_storm: tuple[DemoStormPoint, ...] = ()
    route_lines: tuple[tuple[Coord, ...], ...] = ()


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
    hours = max(1, min(DEFAULT_HOURS, request.hours))
    points = expand(request.seeds)
    if not points:
        return {
            "points": [],
            "hours": [],
            "risk": [],
            "cause": [],
            "wind": [],
            "wind_dir": [],
            "rain": [],
            "snow": [],
            "fill": {"type": "FeatureCollection", "features": []},
            "arrows": {"type": "FeatureCollection", "features": []},
            "mask": {"type": "FeatureCollection", "features": []},
            "raster": None,
        }

    # Align the series to the top of the hour so every point shares a time axis.
    anchor = request.anchor.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    timestamps = [anchor + timedelta(hours=h) for h in range(hours + 1)]

    scenario = None
    if request.demo_scenario == "load_wind":
        lines = [list(line) for line in request.route_lines if len(line) >= 2]
        scenario = build_demo_scenario(lines or [request.seeds])

    client = weather_client or OpenMeteoClient()
    forecasts: dict[Coord, PointForecast] = {}
    if scenario is None:
        forecasts, weather_fallback = forecasts_for_request(
            client, points, timestamps[-1], request.demo_scenario
        )
        if weather_fallback:
            scenario = None

    wind_metric = settings.WIND_RISK_METRIC
    risk_grid: list[list[int]] = []
    cause_grid: list[list[str]] = []
    wind_grid: list[list[float]] = []
    wind_dir_grid: list[list[float | None]] = []
    rain_grid: list[list[float]] = []
    snow_grid: list[list[float]] = []
    temp_grid: list[list[float | None]] = []
    kept_points: list[list[float]] = []

    for point in points:
        forecast = None if scenario else forecasts.get(snap(point))
        if scenario is None and (forecast is None or not forecast.times):
            continue

        risk_row: list[int] = []
        cause_row: list[str] = []
        wind_row: list[float] = []
        wind_dir_row: list[float | None] = []
        rain_row: list[float] = []
        snow_row: list[float] = []
        temp_row: list[float | None] = []
        for hour, ts in enumerate(timestamps):
            if scenario is not None:
                sample = scenario.sample(point[1], point[0], float(hour))
            else:
                assert forecast is not None
                sample = forecast.sample_at(ts.timestamp())
            result = assess(sample, request.load_lb, wind_metric)
            risk_row.append(result.score if result.available else -1)
            cause_row.append(
                result.driver
                if result.available and result.level > RiskLevel.LOW and result.driver in ("wind", "rain", "snow")
                else ""
            )
            wind = sample.effective_wind(wind_metric)
            wind_row.append(None if wind is None else round(wind, 1))
            wind_dir_row.append(
                None if sample.wind_dir_deg is None else round(sample.wind_dir_deg, 1)
            )
            rain_row.append(sample.rain_in_hr)
            snow_row.append(sample.snow_in_hr)
            temp_row.append(sample.temperature_f)

        kept_points.append([round(point[0], 4), round(point[1], 4)])
        risk_grid.append(risk_row)
        cause_grid.append(cause_row)
        wind_grid.append(wind_row)
        wind_dir_grid.append(wind_dir_row)
        rain_grid.append(rain_row)
        snow_grid.append(snow_row)
        temp_grid.append(temp_row)

    from .area import build_area_overlay
    from .weather.raster import build_and_cache_rasters

    area = build_area_overlay(request, timestamps, client)
    raster = build_and_cache_rasters(request, timestamps, client, forecasts=forecasts)

    return {
        "anchor": anchor.isoformat(),
        "hours": [ts.isoformat() for ts in timestamps],
        "points": kept_points,
        "risk": risk_grid,
        "cause": cause_grid,
        "wind": wind_grid,
        "wind_dir": wind_dir_grid,
        "rain": rain_grid,
        "snow": snow_grid,
        "temperature": temp_grid,
        "max_score": int(RiskLevel.NO_TRAVEL),
        "load_lb": request.load_lb,
        "fill": {"type": "FeatureCollection", "features": []},
        "arrows": area["arrows"],
        "mask": {"type": "FeatureCollection", "features": []},
        "raster": raster.as_dict(),
    }

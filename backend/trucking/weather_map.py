"""US weather map: a bbox grid heatmap plus single-point inspection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import ceil, sqrt

from django.conf import settings

from .geo import Coord
from .risk import RiskLevel, assess_score
from .weather.open_meteo import OpenMeteoClient, PointForecast, snap

MAX_GRID_POINTS = 160
DEFAULT_HOURS = 48
# Contiguous US, used when the client has not panned yet.
CONUS_BOUNDS = (-125.0, 24.0, -66.0, 50.0)


@dataclass(frozen=True)
class WeatherMapRequest:
    west: float
    south: float
    east: float
    north: float
    load_lb: float
    anchor: datetime
    hours: int = DEFAULT_HOURS


def _clamp_bbox(west: float, south: float, east: float, north: float) -> tuple[float, float, float, float]:
    west, east = sorted((max(-180.0, west), min(180.0, east)))
    south, north = sorted((max(-90.0, south), min(90.0, north)))
    if east - west < 0.2:
        east = min(180.0, west + 0.2)
    if north - south < 0.2:
        north = min(90.0, south + 0.2)
    return west, south, east, north


def grid_points(west: float, south: float, east: float, north: float, max_points: int = MAX_GRID_POINTS) -> list[Coord]:
    """Even lat/lon samples across a bbox, snapped onto the weather grid."""
    west, south, east, north = _clamp_bbox(west, south, east, north)
    cols = max(3, min(16, int(ceil(sqrt(max_points * (east - west) / max(north - south, 0.01))))))
    rows = max(3, max_points // cols)
    while cols * rows > max_points and (cols > 3 or rows > 3):
        if cols >= rows and cols > 3:
            cols -= 1
        elif rows > 3:
            rows -= 1
        else:
            break

    lon_step = (east - west) / max(cols - 1, 1)
    lat_step = (north - south) / max(rows - 1, 1)
    seen: set[Coord] = set()
    points: list[Coord] = []
    for row in range(rows):
        lat = south + lat_step * row
        for col in range(cols):
            lon = west + lon_step * col
            key = snap((lon, lat))
            if key in seen:
                continue
            seen.add(key)
            points.append(key)
    return points


def _hours(anchor: datetime, count: int) -> list[datetime]:
    start = anchor.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return [start + timedelta(hours=h) for h in range(count + 1)]


def _sample_row(forecast: PointForecast, timestamps: list[datetime], load_lb: float, wind_metric: str):
    risk: list[int] = []
    wind: list[float] = []
    rain: list[float] = []
    snow: list[float] = []
    temp: list[float | None] = []
    for ts in timestamps:
        sample = forecast.sample_at(ts.timestamp())
        risk.append(
            assess_score(
                sample.wind_mph,
                sample.wind_gust_mph,
                sample.rain_in_hr,
                sample.snow_in_hr,
                load_lb,
                wind_metric,
            )
        )
        wind.append(round(sample.effective_wind(wind_metric), 1))
        rain.append(sample.rain_in_hr)
        snow.append(sample.snow_in_hr)
        temp.append(sample.temperature_f)
    return risk, wind, rain, snow, temp


def build_weather_map(request: WeatherMapRequest, weather_client: OpenMeteoClient | None = None) -> dict:
    hours = max(1, min(72, request.hours))
    points = grid_points(request.west, request.south, request.east, request.north)
    timestamps = _hours(request.anchor, hours)
    client = weather_client or OpenMeteoClient()
    forecasts = client.forecasts(points, client.forecast_days_for(timestamps[-1]))
    wind_metric = settings.WIND_RISK_METRIC

    kept: list[list[float]] = []
    risk_grid: list[list[int]] = []
    wind_grid: list[list[float]] = []
    rain_grid: list[list[float]] = []
    snow_grid: list[list[float]] = []
    temp_grid: list[list[float | None]] = []

    for point in points:
        forecast = forecasts.get(snap(point))
        if forecast is None or not forecast.times:
            continue
        risk, wind, rain, snow, temp = _sample_row(forecast, timestamps, request.load_lb, wind_metric)
        kept.append([round(point[0], 4), round(point[1], 4)])
        risk_grid.append(risk)
        wind_grid.append(wind)
        rain_grid.append(rain)
        snow_grid.append(snow)
        temp_grid.append(temp)

    return {
        "anchor": timestamps[0].isoformat(),
        "hours": [ts.isoformat() for ts in timestamps],
        "points": kept,
        "risk": risk_grid,
        "wind": wind_grid,
        "rain": rain_grid,
        "snow": snow_grid,
        "temperature": temp_grid,
        "max_score": int(RiskLevel.NO_TRAVEL),
        "load_lb": request.load_lb,
        "bounds": {
            "west": request.west,
            "south": request.south,
            "east": request.east,
            "north": request.north,
        },
    }


def _compass(degrees: float | None) -> str | None:
    if degrees is None:
        return None
    labels = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return labels[round(degrees / 45) % 8]


def _extras(forecast: PointForecast, ts: float) -> dict:
    i, j, frac = forecast._bracket(ts)

    def series(values: list[float]) -> float | None:
        if not values:
            return None
        return round(forecast._interpolate(values, i, j, frac), 1)

    humidity = series(forecast.humidity)
    dewpoint = series(forecast.dewpoint)
    wind_dir = series(forecast.wind_dir)
    return {
        "humidity_pct": humidity,
        "dewpoint_f": dewpoint,
        "wind_dir_deg": wind_dir,
        "wind_dir": _compass(wind_dir),
    }


def inspect_point(
    lon: float,
    lat: float,
    hours: int,
    load_lb: float,
    anchor: datetime | None = None,
    weather_client: OpenMeteoClient | None = None,
) -> dict:
    """Hourly forecast at one coordinate, for the weather-map inspector."""
    hours = max(1, min(72, hours))
    when = (anchor or datetime.now(timezone.utc)).astimezone(timezone.utc)
    timestamps = _hours(when, hours)
    client = weather_client or OpenMeteoClient()
    coord = snap((lon, lat))
    forecasts = client.forecasts([coord], client.forecast_days_for(timestamps[-1]))
    forecast = forecasts.get(coord)
    wind_metric = settings.WIND_RISK_METRIC

    series = []
    if forecast and forecast.times:
        for ts in timestamps:
            sample = forecast.sample_at(ts.timestamp())
            extra = _extras(forecast, ts.timestamp())
            score = assess_score(
                sample.wind_mph,
                sample.wind_gust_mph,
                sample.rain_in_hr,
                sample.snow_in_hr,
                load_lb,
                wind_metric,
            )
            series.append(
                {
                    "at": ts.isoformat(),
                    "wind_mph": sample.wind_mph,
                    "wind_gust_mph": sample.wind_gust_mph,
                    "rain_in_hr": sample.rain_in_hr,
                    "snow_in_hr": sample.snow_in_hr,
                    "temperature_f": sample.temperature_f,
                    "visibility_mi": sample.visibility_mi,
                    "weather_code": sample.weather_code,
                    "risk": score,
                    **extra,
                }
            )

    now = series[0] if series else None
    return {
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "hours": [ts.isoformat() for ts in timestamps],
        "current": now,
        "series": series,
        "load_lb": load_lb,
    }

"""Open-Meteo forecast client.

Open-Meteo is a good fit here: no API key, and it accepts many coordinates in a
single request, which matters when a 10-mile sampling interval on three routes
produces hundreds of checkpoints. We ask for the values directly in the units
the risk table uses (mph, inches) so no conversion happens in the risk code.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime, timezone

from django.conf import settings
from django.core.cache import cache

from ..geo import Coord
from ..http import UpstreamError, request_json
from ..risk import WeatherSample

logger = logging.getLogger(__name__)

HOURLY_VARIABLES = (
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "rain",
    "showers",
    "snowfall",
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "visibility",
    "weather_code",
)

# Weather models have a ~2-11 km grid, so coordinates are snapped to ~2 km
# before lookup. Checkpoints from different routes that share a highway then
# collapse onto the same cache key instead of making duplicate requests.
GRID_DEGREES = 0.02
MAX_FORECAST_DAYS = 16
SECONDS_PER_HOUR = 3600
# Open-Meteo's free tier rejects overlapping connections ("Too many concurrent
# requests"). Every call in the process goes through this lock, including the
# corridor heatmap that starts the moment a plan returns.
_OPEN_METEO_GATE = threading.Lock()
_MAX_429_RETRIES = 5


def snap(coord: Coord) -> Coord:
    """Round a coordinate onto the weather grid."""
    lon, lat = coord
    return (
        round(round(lon / GRID_DEGREES) * GRID_DEGREES, 4),
        round(round(lat / GRID_DEGREES) * GRID_DEGREES, 4),
    )


@dataclass
class PointForecast:
    """Hourly forecast series for one grid cell."""

    lon: float
    lat: float
    times: list[int] = field(default_factory=list)
    wind: list[float] = field(default_factory=list)
    gust: list[float] = field(default_factory=list)
    rain: list[float] = field(default_factory=list)
    snow: list[float] = field(default_factory=list)
    temperature: list[float] = field(default_factory=list)
    humidity: list[float] = field(default_factory=list)
    dewpoint: list[float] = field(default_factory=list)
    wind_dir: list[float] = field(default_factory=list)
    visibility: list[float] = field(default_factory=list)
    code: list[int] = field(default_factory=list)

    def _interpolate(self, series: list[float], i: int, j: int, frac: float) -> float:
        if not series:
            return 0.0
        a = series[i] if i < len(series) and series[i] is not None else 0.0
        b = series[j] if j < len(series) and series[j] is not None else a
        return float(a) + (float(b) - float(a)) * frac

    def _bracket(self, ts: float) -> tuple[int, int, float]:
        """Indices either side of ``ts`` plus the fraction between them."""
        if ts <= self.times[0]:
            return 0, 0, 0.0
        if ts >= self.times[-1]:
            last = len(self.times) - 1
            return last, last, 0.0
        i = max(0, bisect_right(self.times, ts) - 1)
        j = min(i + 1, len(self.times) - 1)
        span = self.times[j] - self.times[i]
        frac = 0.0 if span <= 0 else (ts - self.times[i]) / span
        return i, j, frac

    def sample_at(self, ts: float) -> WeatherSample:
        """Forecast conditions at an arbitrary instant, linearly interpolated.

        Checkpoint ETAs rarely land on the hour, so interpolating between the
        bracketing hours avoids the step changes you would get from snapping to
        the nearest hour.
        """
        if not self.times:
            return WeatherSample()

        i, j, frac = self._bracket(ts)
        visibility_m = self._interpolate(self.visibility, i, j, frac) if self.visibility else None
        return WeatherSample(
            wind_mph=round(self._interpolate(self.wind, i, j, frac), 1),
            wind_gust_mph=round(self._interpolate(self.gust, i, j, frac), 1),
            rain_in_hr=round(self._interpolate(self.rain, i, j, frac), 3),
            snow_in_hr=round(self._interpolate(self.snow, i, j, frac), 3),
            temperature_f=round(self._interpolate(self.temperature, i, j, frac), 1)
            if self.temperature
            else None,
            visibility_mi=round(visibility_m / 1609.344, 1) if visibility_m else None,
            # Weather code is categorical: snap to the nearer hour.
            weather_code=int(self.code[j if frac >= 0.5 else i]) if self.code else None,
        )

    def hourly_index(self, ts: float) -> int:
        """Nearest hourly index, used to build the heatmap time series."""
        i, j, frac = self._bracket(ts)
        return j if frac >= 0.5 else i


class OpenMeteoClient:
    name = "open-meteo"

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or settings.OPEN_METEO_BASE_URL

    # -- public API ---------------------------------------------------------

    def forecasts(
        self, coords: list[Coord], forecast_days: int = 3
    ) -> dict[Coord, PointForecast]:
        """Fetch forecasts for many coordinates, deduplicated and cached."""
        forecast_days = max(2, min(MAX_FORECAST_DAYS, forecast_days))
        wanted = {snap(c) for c in coords}
        if not wanted:
            return {}

        results: dict[Coord, PointForecast] = {}
        missing: list[Coord] = []
        for key in wanted:
            cached = cache.get(self._cache_key(key, forecast_days))
            if cached is not None:
                results[key] = cached
            else:
                missing.append(key)

        if missing:
            batches = [
                missing[i : i + settings.WEATHER_BATCH_SIZE]
                for i in range(0, len(missing), settings.WEATHER_BATCH_SIZE)
            ]
            pause = max(0.0, float(getattr(settings, "WEATHER_MIN_INTERVAL_SECONDS", 0.35)))
            # One in-flight Open-Meteo call at a time. Parallel batches are what
            # trigger 429s on the free forecast endpoint.
            with _OPEN_METEO_GATE:
                for index, batch in enumerate(batches):
                    if index:
                        time.sleep(pause)
                    fetched = self._fetch_batch(batch, forecast_days)
                    for key, forecast in fetched.items():
                        results[key] = forecast
                        cache.set(
                            self._cache_key(key, forecast_days),
                            forecast,
                            settings.WEATHER_CACHE_SECONDS,
                        )

        return results

    def forecast_days_for(self, latest: datetime) -> int:
        """How many forecast days cover everything up to ``latest``.

        Open-Meteo's hourly series always starts at 00:00 UTC today, so the
        span is measured from there rather than from the departure time.
        """
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        hours = (latest - start).total_seconds() / SECONDS_PER_HOUR
        return max(2, min(MAX_FORECAST_DAYS, math.ceil(hours / 24) + 1))

    # -- internals ----------------------------------------------------------

    def _cache_key(self, coord: Coord, days: int) -> str:
        return f"om:{coord[0]:.4f}:{coord[1]:.4f}:{days}"

    def _fetch_batch(self, coords: list[Coord], forecast_days: int) -> dict[Coord, PointForecast]:
        params = {
            "latitude": ",".join(f"{lat:.4f}" for _, lat in coords),
            "longitude": ",".join(f"{lon:.4f}" for lon, _ in coords),
            "hourly": ",".join(HOURLY_VARIABLES),
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "temperature_unit": "fahrenheit",
            "timeformat": "unixtime",
            "timezone": "GMT",
            "forecast_days": str(forecast_days),
            "models": "best_match",
            "cell_selection": "nearest",
        }
        payload = self._request_with_retry(params)

        # A single coordinate yields an object; several yield a list.
        entries = payload if isinstance(payload, list) else [payload]
        if len(entries) != len(coords):
            raise UpstreamError(
                f"Open-Meteo returned {len(entries)} series for {len(coords)} points",
                provider="Open-Meteo",
            )

        out: dict[Coord, PointForecast] = {}
        for coord, entry in zip(coords, entries):
            out[coord] = self._parse(coord, entry)
        return out

    def _request_with_retry(self, params: dict):
        """GET with backoff on 429 so a brief burst does not fail the whole plan."""
        last_error: UpstreamError | None = None
        for attempt in range(_MAX_429_RETRIES + 1):
            try:
                return request_json("GET", self.base_url, provider="Open-Meteo", params=params)
            except UpstreamError as exc:
                last_error = exc
                if exc.status != 429 or attempt >= _MAX_429_RETRIES:
                    raise
                delay = exc.retry_after if exc.retry_after and exc.retry_after > 0 else 1.5 * (2**attempt)
                delay = min(20.0, delay)
                logger.warning(
                    "Open-Meteo rate-limited (attempt %s/%s); waiting %.1fs",
                    attempt + 1,
                    _MAX_429_RETRIES,
                    delay,
                )
                time.sleep(delay)
        raise last_error or UpstreamError("Open-Meteo rate-limited", provider="Open-Meteo", status=429)

    @staticmethod
    def _parse(coord: Coord, entry: dict) -> PointForecast:
        hourly = (entry or {}).get("hourly") or {}

        def series(name: str) -> list:
            return [v if v is not None else 0.0 for v in (hourly.get(name) or [])]

        rain = series("rain")
        showers = series("showers")
        # Open-Meteo splits stratiform rain from convective showers; the risk
        # table has a single "Rain in/hr" row, so they are summed.
        combined_rain = [
            float(r) + float(showers[i]) if i < len(showers) else float(r)
            for i, r in enumerate(rain)
        ]

        return PointForecast(
            lon=coord[0],
            lat=coord[1],
            times=[int(t) for t in (hourly.get("time") or [])],
            wind=[float(v) for v in series("wind_speed_10m")],
            gust=[float(v) for v in series("wind_gusts_10m")],
            rain=combined_rain,
            snow=[float(v) for v in series("snowfall")],
            temperature=[float(v) for v in series("temperature_2m")],
            humidity=[float(v) for v in series("relative_humidity_2m")],
            dewpoint=[float(v) for v in series("dew_point_2m")],
            wind_dir=[float(v) for v in series("wind_direction_10m")],
            visibility=[float(v) for v in series("visibility")],
            code=[int(v) for v in series("weather_code")],
        )

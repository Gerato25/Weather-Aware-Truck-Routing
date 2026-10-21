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
from datetime import datetime, timedelta, timezone

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
    "visibility",
    "weather_code",
)

# Weather models have a ~2-11 km grid, so coordinates are snapped to ~2 km
# before lookup. Checkpoints from different routes that share a highway then
# collapse onto the same cache key instead of making duplicate requests.
GRID_DEGREES = 0.02
MAX_FORECAST_DAYS = 16
SECONDS_PER_HOUR = 3600
# Hourly series may miss the exact ETA by a few minutes; beyond this window we
# must not substitute the first or last hour (wrong time, wrong weather).
FORECAST_SLACK_S = 30 * 60
# Open-Meteo's free tier rejects overlapping connections ("Too many concurrent
# requests"). Every call in the process goes through this lock, including the
# corridor heatmap that starts the moment a plan returns.
_OPEN_METEO_GATE = threading.Lock()
_MAX_429_RETRIES = 5


def _is_daily_limit(exc: UpstreamError) -> bool:
    text = str(exc).lower()
    return exc.status == 429 and ("daily" in text or "limit exceeded" in text)


def calm_forecasts(coords: list[Coord]) -> dict[Coord, PointForecast]:
    """Local 8 mph / dry series so demo mode can run when Open-Meteo is exhausted."""
    start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=1)
    count = 24 * 8
    times = [int((start + timedelta(hours=hour)).timestamp()) for hour in range(count)]
    out: dict[Coord, PointForecast] = {}
    for coord in coords:
        key = snap(coord)
        if key in out:
            continue
        out[key] = PointForecast(
            lon=key[0],
            lat=key[1],
            times=times,
            wind=[8.0] * count,
            gust=[10.0] * count,
            wind_dir=[270.0] * count,
            rain=[0.0] * count,
            snow=[0.0] * count,
            temperature=[55.0] * count,
            visibility=[16000.0] * count,
            code=[0] * count,
        )
    return out


def forecasts_for_request(
    client: OpenMeteoClient,
    coords: list[Coord],
    latest: datetime,
    demo_scenario: str = "",
) -> tuple[dict[Coord, PointForecast], bool]:
    """Fetch live weather, or a calm series for the scripted demo / daily 429s.

    The boolean is True when live Open-Meteo was skipped because the daily
    quota is exhausted. Callers should apply the demo storms and tell the UI.
    """
    demo = demo_scenario == "load_wind"
    if demo and isinstance(client, OpenMeteoClient):
        return calm_forecasts(coords), False
    days = client.forecast_days_for(latest)
    try:
        return client.forecasts(coords, days), False
    except UpstreamError as exc:
        if _is_daily_limit(exc) or exc.status == 429:
            logger.warning("Open-Meteo rate limit; using local demo weather")
            return calm_forecasts(coords), True
        raise


def _dewpoints(temps_f: list[float | None], humidity: list[float | None]) -> list[float | None]:
    """Dew point (°F) from temperature and RH via the Magnus formula.

    Derived locally because a tenth hourly variable makes Open-Meteo bill each
    location as more than one call.
    """
    out: list[float | None] = []
    for temp_f, rh in zip(temps_f, humidity):
        if temp_f is None or rh is None or rh <= 0:
            out.append(None)
            continue
        temp_c = (temp_f - 32) * 5 / 9
        gamma = math.log(rh / 100.0) + 17.62 * temp_c / (243.12 + temp_c)
        out.append(round(243.12 * gamma / (17.62 - gamma) * 9 / 5 + 32, 1))
    return out


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
    wind: list[float | None] = field(default_factory=list)
    gust: list[float | None] = field(default_factory=list)
    rain: list[float | None] = field(default_factory=list)
    snow: list[float | None] = field(default_factory=list)
    temperature: list[float | None] = field(default_factory=list)
    humidity: list[float | None] = field(default_factory=list)
    dewpoint: list[float | None] = field(default_factory=list)
    wind_dir: list[float | None] = field(default_factory=list)
    visibility: list[float | None] = field(default_factory=list)
    code: list[int | None] = field(default_factory=list)

    def _interpolate(self, series: list[float | None], i: int, j: int, frac: float) -> float | None:
        if not series:
            return None
        a = series[i] if i < len(series) else None
        b = series[j] if j < len(series) else None
        if a is None and b is None:
            return None
        if a is None:
            return float(b)
        if b is None:
            return float(a)
        return float(a) + (float(b) - float(a)) * frac

    def _interpolate_angle(self, series: list[float | None], i: int, j: int, frac: float) -> float | None:
        """Interpolate a 0-360° bearing the short way around the circle."""
        if not series:
            return None
        a = series[i] if i < len(series) else None
        b = series[j] if j < len(series) else None
        if a is None and b is None:
            return None
        if a is None:
            return float(b) % 360.0
        if b is None:
            return float(a) % 360.0
        delta = (float(b) - float(a) + 180.0) % 360.0 - 180.0
        return (float(a) + delta * frac) % 360.0

    def covers(self, ts: float) -> bool:
        """True when ``ts`` falls inside the provider's hourly series."""
        if not self.times:
            return False
        return self.times[0] - FORECAST_SLACK_S <= ts <= self.times[-1] + FORECAST_SLACK_S

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
        the nearest hour. Times outside the provider series return an empty
        sample so callers can mark the forecast unavailable instead of using
        weather from the wrong hour.
        """
        if not self.covers(ts):
            return WeatherSample()

        i, j, frac = self._bracket(ts)
        visibility_m = self._interpolate(self.visibility, i, j, frac) if self.visibility else None

        def _round(value: float | None, digits: int) -> float | None:
            return None if value is None else round(value, digits)

        code = None
        if self.code:
            picked = self.code[j if frac >= 0.5 else i]
            code = int(picked) if picked is not None else None

        return WeatherSample(
            wind_mph=_round(self._interpolate(self.wind, i, j, frac), 1),
            wind_gust_mph=_round(self._interpolate(self.gust, i, j, frac), 1),
            wind_dir_deg=_round(self._interpolate_angle(self.wind_dir, i, j, frac), 1),
            rain_in_hr=_round(self._interpolate(self.rain, i, j, frac), 3),
            snow_in_hr=_round(self._interpolate(self.snow, i, j, frac), 3),
            temperature_f=_round(self._interpolate(self.temperature, i, j, frac), 1)
            if self.temperature
            else None,
            visibility_mi=round(visibility_m / 1609.344, 1) if visibility_m else None,
            weather_code=code,
        )

    def hourly_index(self, ts: float) -> int:
        """Nearest hourly index, used to build the heatmap time series."""
        i, j, frac = self._bracket(ts)
        return j if frac >= 0.5 else i


_DEFAULT_FALLBACK = object()
_BLOCKED_KEY = "om:rate-limited"
# After a 429, skip Open-Meteo for a while instead of burning retries on every
# request. A daily-limit reply is re-checked hourly rather than at midnight
# because shared hosts see quotas used by other tenants come and go.
DAILY_LIMIT_BACKOFF_S = 3600
BURST_LIMIT_BACKOFF_S = 120


def _default_fallback():
    # NWS first (U.S., has gusts and snowfall), MET Norway for anything it misses.
    from .cell_client import FallbackChain
    from .met_norway import MetNorwayClient
    from .nws import NwsClient

    return FallbackChain([NwsClient(), MetNorwayClient()])


class OpenMeteoClient:
    name = "open-meteo"

    def __init__(self, base_url: str | None = None, fallback=_DEFAULT_FALLBACK) -> None:
        self.base_url = base_url or settings.OPEN_METEO_BASE_URL
        # Keyless provider used when Open-Meteo answers 429; None disables it.
        self.fallback = _default_fallback() if fallback is _DEFAULT_FALLBACK else fallback
        # Which provider actually served the last ``forecasts`` call.
        self.source = self.name

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

        self.source = self.name
        if not missing:
            return results

        try:
            if cache.get(_BLOCKED_KEY):
                raise UpstreamError(
                    "Open-Meteo rate-limited recently; skipping it for now",
                    provider="Open-Meteo",
                    status=429,
                )
            self._fetch_missing(missing, forecast_days, results)
        except UpstreamError as exc:
            if exc.status != 429:
                raise
            if not cache.get(_BLOCKED_KEY):
                backoff = DAILY_LIMIT_BACKOFF_S if _is_daily_limit(exc) else BURST_LIMIT_BACKOFF_S
                cache.set(_BLOCKED_KEY, True, backoff)
            if self.fallback is None:
                raise
            remaining = [key for key in missing if key not in results]
            try:
                results.update(self.fallback.forecasts(remaining, forecast_days))
            except UpstreamError as fallback_exc:
                logger.warning("Weather fallback %s failed: %s", self.fallback.name, fallback_exc)
                raise exc from fallback_exc
            logger.warning("Open-Meteo rate-limited; served %s points from %s", len(remaining), self.fallback.name)
            self.source = self.fallback.name

        return results

    def _fetch_missing(
        self, missing: list[Coord], forecast_days: int, results: dict[Coord, PointForecast]
    ) -> None:
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
                if exc.status != 429 or _is_daily_limit(exc) or attempt >= _MAX_429_RETRIES:
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
            return list(hourly.get(name) or [])

        rain = series("rain")
        showers = series("showers")
        # Open-Meteo splits stratiform rain from convective showers; the risk
        # table has a single "Rain in/hr" row, so they are summed. A missing
        # slot stays missing instead of collapsing to 0.0 (calm/dry).
        combined_rain = []
        count = max(len(rain), len(showers))
        for i in range(count):
            r = rain[i] if i < len(rain) else None
            s = showers[i] if i < len(showers) else None
            if r is None and s is None:
                combined_rain.append(None)
            else:
                combined_rain.append(float(r or 0.0) + float(s or 0.0))

        def floats(name: str) -> list:
            return [None if v is None else float(v) for v in series(name)]

        def ints(name: str) -> list:
            return [None if v is None else int(v) for v in series(name)]

        return PointForecast(
            lon=coord[0],
            lat=coord[1],
            times=[int(t) for t in (hourly.get("time") or [])],
            wind=floats("wind_speed_10m"),
            gust=floats("wind_gusts_10m"),
            rain=combined_rain,
            snow=floats("snowfall"),
            temperature=floats("temperature_2m"),
            humidity=floats("relative_humidity_2m"),
            dewpoint=_dewpoints(floats("temperature_2m"), floats("relative_humidity_2m")),
            wind_dir=floats("wind_direction_10m"),
            visibility=floats("visibility"),
            code=ints("weather_code"),
        )

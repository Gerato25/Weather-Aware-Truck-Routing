"""U.S. National Weather Service gridpoint client - first fallback for Open-Meteo.

Keyless, official, 2.5 km grid, and - unlike MET Norway outside the Nordics -
it publishes wind gusts and snowfall, which the risk table depends on. It only
covers the United States; elsewhere ``/points`` answers 404 and the cell is
left for the next fallback.

Each layer is a list of ``{"validTime": "<start>/<ISO duration>", "value"}``
intervals of varying length, expanded here onto an hourly series. Interval
totals (precipitation, snowfall) are spread evenly across their hours.
"""

from __future__ import annotations

import re
from datetime import datetime

from django.conf import settings
from django.core.cache import cache

from ..geo import Coord
from ..http import UpstreamError, request_json
from .cell_client import CellForecastClient
from .open_meteo import PointForecast

KMH_TO_MPH = 0.621371
MM_TO_IN = 1 / 25.4
# Snow depth to liquid water, used to keep snow out of the rain total.
SNOW_TO_WATER = 0.1
GRID_URL_CACHE_SECONDS = 7 * 24 * 3600
NOT_COVERED = "outside-nws"
_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$")
_HEADERS = {"Accept": "application/geo+json"}


def _interval(valid_time: str) -> tuple[int, int] | None:
    """Start timestamp and whole hours of an NWS ``validTime``."""
    try:
        start_text, duration = valid_time.split("/")
        start = int(datetime.fromisoformat(start_text).timestamp())
    except (AttributeError, ValueError):
        return None
    match = _DURATION.match(duration)
    if not match:
        return None
    days, hours, minutes = (int(part or 0) for part in match.groups())
    return start, max(1, days * 24 + hours + (1 if minutes >= 30 else 0))


def _hourly(properties: dict, layer: str, *, total: bool = False) -> dict[int, float]:
    out: dict[int, float] = {}
    for entry in (properties.get(layer) or {}).get("values") or []:
        value = entry.get("value")
        span = _interval(entry.get("validTime") or "")
        if value is None or span is None:
            continue
        start, hours = span
        per_hour = float(value) / hours if total else float(value)
        for i in range(hours):
            out[start + i * 3600] = per_hour
    return out


def _weather_codes(properties: dict) -> dict[int, int]:
    out: dict[int, int] = {}
    for entry in (properties.get("weather") or {}).get("values") or []:
        span = _interval(entry.get("validTime") or "")
        if span is None:
            continue
        kinds = {(item or {}).get("weather") for item in entry.get("value") or []}
        if "thunderstorms" in kinds:
            code = 95
        elif kinds & {"snow", "snow_showers", "blowing_snow"}:
            code = 73
        elif kinds & {"rain_showers"}:
            code = 81
        elif kinds & {"rain", "drizzle", "freezing_rain", "freezing_drizzle"}:
            code = 63
        elif kinds & {"fog", "freezing_fog"}:
            code = 45
        else:
            continue
        start, hours = span
        for i in range(hours):
            out[start + i * 3600] = code
    return out


class NwsClient(CellForecastClient):
    name = "nws"

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.NWS_BASE_URL).rstrip("/")

    def _fetch(self, cell: Coord) -> PointForecast:
        payload = request_json("GET", self._grid_url(cell), provider="NWS", headers=_HEADERS)
        return self._parse(cell, payload)

    def _grid_url(self, cell: Coord) -> str:
        """Gridpoint URL for a cell; stable, so cached for a week."""
        key = f"nws-grid:{cell[0]:.4f}:{cell[1]:.4f}"
        cached = cache.get(key)
        if cached == NOT_COVERED:
            raise UpstreamError("Outside NWS coverage", provider="NWS", status=404)
        if cached:
            return cached
        try:
            payload = request_json(
                "GET",
                f"{self.base_url}/points/{cell[1]:.4f},{cell[0]:.4f}",
                provider="NWS",
                headers=_HEADERS,
            )
        except UpstreamError as exc:
            if exc.status == 404:
                cache.set(key, NOT_COVERED, GRID_URL_CACHE_SECONDS)
            raise
        url = ((payload or {}).get("properties") or {}).get("forecastGridData")
        if not url:
            raise UpstreamError("NWS returned no gridpoint for this location", provider="NWS")
        cache.set(key, url, GRID_URL_CACHE_SECONDS)
        return url

    @staticmethod
    def _parse(cell: Coord, payload: dict) -> PointForecast:
        props = (payload or {}).get("properties") or {}
        wind = _hourly(props, "windSpeed")
        gust = _hourly(props, "windGust")
        direction = _hourly(props, "windDirection")
        temperature = _hourly(props, "temperature")
        dewpoint = _hourly(props, "dewpoint")
        humidity = _hourly(props, "relativeHumidity")
        precip = _hourly(props, "quantitativePrecipitation", total=True)
        snow = _hourly(props, "snowfallAmount", total=True)
        codes = _weather_codes(props)

        times = sorted(set(wind) | set(temperature))
        if not times:
            raise UpstreamError("NWS returned no forecast series", provider="NWS")

        def to_f(value: float | None) -> float | None:
            return None if value is None else value * 9 / 5 + 32

        forecast = PointForecast(lon=cell[0], lat=cell[1], times=times)
        for ts in times:
            snow_mm = snow.get(ts)
            precip_mm = precip.get(ts)
            rain_mm = None
            if precip_mm is not None:
                rain_mm = max(0.0, precip_mm - (snow_mm or 0.0) * SNOW_TO_WATER)
            w, g = wind.get(ts), gust.get(ts)
            forecast.wind.append(None if w is None else w * KMH_TO_MPH)
            forecast.gust.append(None if g is None else g * KMH_TO_MPH)
            forecast.wind_dir.append(direction.get(ts))
            forecast.rain.append(None if rain_mm is None else rain_mm * MM_TO_IN)
            forecast.snow.append(None if snow_mm is None else snow_mm * MM_TO_IN)
            forecast.temperature.append(to_f(temperature.get(ts)))
            forecast.dewpoint.append(to_f(dewpoint.get(ts)))
            forecast.humidity.append(humidity.get(ts))
            forecast.code.append(codes.get(ts))
        return forecast

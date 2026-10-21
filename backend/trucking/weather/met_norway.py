"""MET Norway Locationforecast client - global keyless fallback.

Hourly for ~60 hours (6-hourly after that), which covers the 0-48h window.
Used after NWS, so in practice it fills points outside the United States.

Differences the risk code has to live with:
- Gusts are only published inside the Nordic model domain; elsewhere the
  sustained wind alone drives the wind band.
- Precipitation is a single amount, split into rain or snow by the symbol code
  and, failing that, the air temperature.
"""

from __future__ import annotations

from datetime import datetime

from django.conf import settings

from ..geo import Coord
from ..http import UpstreamError, request_json
from .cell_client import CellForecastClient
from .open_meteo import PointForecast

MS_TO_MPH = 2.236936
MM_TO_IN = 1 / 25.4
# Same water-to-snow ratio Open-Meteo uses for its snowfall series (cm per mm).
SNOW_CM_PER_MM = 0.7

# Rough WMO equivalents so the UI weather icons keep working.
_SYMBOL_CODES = (
    ("thunder", 95),
    ("heavysnow", 75),
    ("lightsnow", 71),
    ("snowshowers", 85),
    ("snow", 73),
    ("sleet", 68),
    ("heavyrainshowers", 82),
    ("lightrainshowers", 80),
    ("rainshowers", 81),
    ("heavyrain", 65),
    ("lightrain", 61),
    ("rain", 63),
    ("fog", 45),
    ("cloudy", 3),
    ("partlycloudy", 2),
    ("fair", 1),
    ("clearsky", 0),
)


def _weather_code(symbol: str | None) -> int | None:
    if not symbol:
        return None
    for prefix, code in _SYMBOL_CODES:
        if symbol.startswith(prefix):
            return code
    return None


def _snow_fraction(symbol: str | None, temperature_c: float | None) -> float:
    """Share of the precipitation that falls as snow."""
    if symbol:
        if "sleet" in symbol:
            return 0.5
        if "snow" in symbol:
            return 1.0
        if "rain" in symbol:
            return 0.0
    if temperature_c is not None and temperature_c <= 0.0:
        return 1.0
    return 0.0


class MetNorwayClient(CellForecastClient):
    name = "met-norway"

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or settings.MET_NORWAY_BASE_URL

    def _fetch(self, cell: Coord) -> PointForecast:
        payload = request_json(
            "GET",
            self.base_url,
            provider="MET Norway",
            params={"lat": f"{cell[1]:.4f}", "lon": f"{cell[0]:.4f}"},
        )
        return self._parse(cell, payload)

    @staticmethod
    def _parse(cell: Coord, payload: dict) -> PointForecast:
        forecast = PointForecast(lon=cell[0], lat=cell[1])
        timeseries = ((payload or {}).get("properties") or {}).get("timeseries") or []
        for step in timeseries:
            try:
                ts = int(datetime.fromisoformat(step["time"].replace("Z", "+00:00")).timestamp())
            except (KeyError, TypeError, ValueError):
                continue
            data = step.get("data") or {}
            instant = (data.get("instant") or {}).get("details") or {}

            # Prefer the next-hour amount; the 6-hourly tail only has a 6h total.
            precip_mm = None
            symbol = None
            for block, hours in (("next_1_hours", 1), ("next_6_hours", 6)):
                period = data.get(block) or {}
                amount = (period.get("details") or {}).get("precipitation_amount")
                if amount is not None:
                    precip_mm = float(amount) / hours
                    symbol = (period.get("summary") or {}).get("symbol_code")
                    break

            temperature_c = instant.get("air_temperature")
            dewpoint_c = instant.get("dew_point_temperature")
            wind = instant.get("wind_speed")
            gust = instant.get("wind_speed_of_gust")

            rain_in = snow_in = None
            if precip_mm is not None:
                snow_share = _snow_fraction(symbol, temperature_c)
                rain_in = precip_mm * (1 - snow_share) * MM_TO_IN
                snow_in = precip_mm * snow_share * SNOW_CM_PER_MM / 2.54

            forecast.times.append(ts)
            forecast.wind.append(None if wind is None else float(wind) * MS_TO_MPH)
            forecast.gust.append(None if gust is None else float(gust) * MS_TO_MPH)
            forecast.wind_dir.append(instant.get("wind_from_direction"))
            forecast.rain.append(rain_in)
            forecast.snow.append(snow_in)
            forecast.temperature.append(
                None if temperature_c is None else float(temperature_c) * 9 / 5 + 32
            )
            forecast.humidity.append(instant.get("relative_humidity"))
            forecast.dewpoint.append(None if dewpoint_c is None else float(dewpoint_c) * 9 / 5 + 32)
            forecast.code.append(_weather_code(symbol))

        if not forecast.times:
            raise UpstreamError("MET Norway returned no forecast series", provider="MET Norway")
        return forecast

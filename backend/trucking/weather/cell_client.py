"""Shared plumbing for the keyless one-point-per-request fallback providers.

Open-Meteo takes many coordinates per call; the fallbacks (NWS, MET Norway)
take one. Points are grouped onto a 0.1° cell (about the resolution of the
models behind them), each cell is fetched once in parallel and cached, and the
result is handed back under the Open-Meteo grid keys the callers look up.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.core.cache import cache

from ..geo import Coord
from ..http import UpstreamError
from .open_meteo import PointForecast, snap

logger = logging.getLogger(__name__)

CELL_DEGREES = 0.1


def cell_of(coord: Coord) -> Coord:
    lon, lat = coord
    return (
        round(round(lon / CELL_DEGREES) * CELL_DEGREES, 4),
        round(round(lat / CELL_DEGREES) * CELL_DEGREES, 4),
    )


class CellForecastClient:
    name = ""

    def forecasts(self, coords: list[Coord], forecast_days: int = 3) -> dict[Coord, PointForecast]:
        """Forecasts keyed by ``snap(coord)``; cells that fail are left out."""
        by_cell: dict[Coord, list[Coord]] = {}
        for key in {snap(c) for c in coords}:
            by_cell.setdefault(cell_of(key), []).append(key)

        cells: dict[Coord, PointForecast] = {}
        missing: list[Coord] = []
        for cell in by_cell:
            cached = cache.get(self._cache_key(cell))
            if cached is not None:
                cells[cell] = cached
            else:
                missing.append(cell)

        errors: list[UpstreamError] = []
        if missing:
            workers = max(1, min(settings.FALLBACK_WEATHER_MAX_WORKERS, len(missing)))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for cell, outcome in zip(missing, pool.map(self._fetch_safely, missing)):
                    if isinstance(outcome, UpstreamError):
                        errors.append(outcome)
                        continue
                    cells[cell] = outcome
                    cache.set(self._cache_key(cell), outcome, settings.WEATHER_CACHE_SECONDS)

        if errors and not cells:
            raise errors[0]
        if errors:
            # Missing cells stay missing, so those checkpoints are unscored
            # (or picked up by the next fallback) rather than treated as calm.
            logger.info("%s failed for %s of %s cells", self.name, len(errors), len(by_cell))

        results: dict[Coord, PointForecast] = {}
        for cell, members in by_cell.items():
            forecast = cells.get(cell)
            if forecast is None:
                continue
            for key in members:
                results[key] = forecast
        return results

    def _cache_key(self, cell: Coord) -> str:
        return f"{self.name}:{cell[0]:.4f}:{cell[1]:.4f}"

    def _fetch_safely(self, cell: Coord) -> PointForecast | UpstreamError:
        try:
            return self._fetch(cell)
        except UpstreamError as exc:
            return exc

    def _fetch(self, cell: Coord) -> PointForecast:
        raise NotImplementedError


class FallbackChain:
    """Try each fallback in turn, passing on only the points still missing."""

    def __init__(self, clients: list) -> None:
        self.clients = clients
        self.name = "+".join(client.name for client in clients)

    def forecasts(self, coords: list[Coord], forecast_days: int = 3) -> dict[Coord, PointForecast]:
        remaining = list({snap(c) for c in coords})
        results: dict[Coord, PointForecast] = {}
        used: list[str] = []
        last_error: UpstreamError | None = None
        for client in self.clients:
            if not remaining:
                break
            try:
                fetched = client.forecasts(remaining, forecast_days)
            except UpstreamError as exc:
                last_error = exc
                continue
            if fetched:
                used.append(client.name)
                results.update(fetched)
                remaining = [key for key in remaining if key not in results]
        if not results:
            raise last_error or UpstreamError("No fallback weather available", provider="weather")
        # Reported to the UI as the weather source.
        self.name = "+".join(used)
        return results

"""Deterministic stand-ins for the routing and weather providers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from trucking.geo import Coord, miles_to_meters, profile_from_edge_durations
from trucking.providers.base import RawRoute
from trucking.weather.open_meteo import PointForecast, snap


def line(start: Coord, end: Coord, points: int = 121) -> list[Coord]:
    """Evenly spaced coordinates between two points."""
    return [
        (
            start[0] + (end[0] - start[0]) * i / (points - 1),
            start[1] + (end[1] - start[1]) * i / (points - 1),
        )
        for i in range(points)
    ]


def make_route(
    start: Coord,
    end: Coord,
    distance_miles: float,
    duration_hours: float,
    points: int = 121,
) -> RawRoute:
    coords = line(start, end, points)
    profile = profile_from_edge_durations(
        coords,
        [1.0] * (points - 1),
        total_distance_m=miles_to_meters(distance_miles),
        total_duration_s=duration_hours * 3600,
    )
    return RawRoute(
        profile=profile,
        distance_m=miles_to_meters(distance_miles),
        duration_s=duration_hours * 3600,
        provider="fake",
    )


class FakeRouter:
    """Returns a fixed set of routes, ignoring the requested waypoints."""

    name = "fake-router"
    supports_truck_profile = True

    def __init__(self, routes: list[RawRoute]) -> None:
        self._routes = routes
        self.calls: list[tuple] = []

    def routes(self, waypoints, alternatives, load_lb):
        self.calls.append((tuple(waypoints), alternatives, load_lb))
        # Detour requests (three waypoints) get nothing, so tests can assert on
        # how the planner copes with a router that offers few alternatives.
        if len(waypoints) > 2:
            return []
        return list(self._routes)


class FakeWeather:
    """Synthesises a forecast from a caller-supplied function of position."""

    name = "fake-weather"

    def __init__(self, conditions) -> None:
        # conditions(lon, lat) -> dict(wind=, gust=, rain=, snow=)
        self.conditions = conditions
        self.requested: list[Coord] = []

    def forecast_days_for(self, latest: datetime) -> int:
        return 4

    def forecasts(self, coords: list[Coord], forecast_days: int = 3):
        start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        ) - timedelta(days=1)
        times = [int((start + timedelta(hours=h)).timestamp()) for h in range(24 * 8)]

        out: dict[Coord, PointForecast] = {}
        for coord in coords:
            key = snap(coord)
            if key in out:
                continue
            self.requested.append(key)
            values = self.conditions(key[0], key[1])
            count = len(times)
            out[key] = PointForecast(
                lon=key[0],
                lat=key[1],
                times=times,
                wind=[values.get("wind", 0.0)] * count,
                gust=[values.get("gust", values.get("wind", 0.0))] * count,
                wind_dir=[values.get("wind_dir", 270.0)] * count,
                rain=[values.get("rain", 0.0)] * count,
                snow=[values.get("snow", 0.0)] * count,
                temperature=[40.0] * count,
                visibility=[16000.0] * count,
                code=[0] * count,
            )
        return out

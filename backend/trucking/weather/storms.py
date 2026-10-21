"""Time-varying demo storms that checkpoints, cards and the area all share.

Each storm has a start, a peak window and an end, moves at a fixed speed and
heading, and fades from its centre. ``point_at_mile`` pins a storm onto a real
route so it still hits Route A/B/C when OSRM returns a different geometry.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..geo import (
    Coord,
    RouteProfile,
    cumulative_distances,
    haversine_m,
    initial_bearing_deg,
    meters_to_miles,
    miles_to_meters,
    offset_coord,
)
from ..risk import WeatherSample

CALM_WIND_MPH = 8.0
CALM_WIND_DIR_DEG = 270.0
CALM_TEMP_F = 55.0
# Used only to time a storm so it is sitting on the pin when a truck would be.
TRUCK_MPH = 55.0


def point_at_mile(coords: list[Coord], miles: float) -> Coord:
    """Coordinate that many miles along a polyline, clamped to the ends."""
    if len(coords) < 2:
        return coords[0] if coords else (0.0, 0.0)
    profile = _profile(coords)
    target = min(max(0.0, miles_to_meters(miles)), profile.total_m)
    coord, _ = profile.at_distance(target)
    return coord


def _profile(coords: list[Coord]) -> RouteProfile:
    cum = cumulative_distances(coords)
    return RouteProfile(list(coords), cum, list(cum))


def _route_bearing(coords: list[Coord], miles: float) -> float:
    profile = _profile(coords)
    behind = max(0.0, miles_to_meters(miles) - miles_to_meters(8))
    ahead = min(profile.total_m, miles_to_meters(miles) + miles_to_meters(8))
    a, _ = profile.at_distance(behind)
    b, _ = profile.at_distance(ahead)
    if a == b:
        return 90.0
    return initial_bearing_deg(a, b)


def _envelope(hour: float, start: float, peak_start: float, peak_end: float, end: float) -> float:
    if hour <= start or hour >= end:
        return 0.0
    if peak_start <= hour <= peak_end:
        return 1.0
    if hour < peak_start:
        span = max(1e-6, peak_start - start)
        return max(0.0, (hour - start) / span)
    span = max(1e-6, end - peak_end)
    return max(0.0, (end - hour) / span)


def _anisotropic_weight(
    point: Coord,
    center: Coord,
    along_bearing: float,
    along_miles: float,
    cross_miles: float,
) -> float:
    dist = meters_to_miles(haversine_m(center, point))
    if dist <= 0:
        return 1.0
    bearing = initial_bearing_deg(center, point)
    delta = math.radians(bearing - along_bearing)
    along = abs(dist * math.cos(delta)) / max(along_miles, 1e-3)
    cross = abs(dist * math.sin(delta)) / max(cross_miles, 1e-3)
    u = along * along + cross * cross
    if u >= 1.0:
        return 0.0
    return max(0.0, 1.0 - u) ** 0.65


@dataclass(frozen=True)
class Storm:
    """One moving weather blob. ``kind`` is wind, rain or snow."""

    kind: str
    origin: Coord
    start_h: float
    peak_start_h: float
    peak_end_h: float
    end_h: float
    speed_mph: float
    heading_deg: float
    along_miles: float
    cross_miles: float
    peak_value: float
    wind_dir_deg: float = 135.0
    hit_hour: float = 8.0

    def center_at(self, hour: float) -> Coord:
        travel = self.speed_mph * (hour - self.hit_hour)
        if abs(travel) < 1e-6:
            return self.origin
        bearing = self.heading_deg if travel >= 0 else (self.heading_deg + 180.0) % 360.0
        return offset_coord(self.origin, bearing, miles_to_meters(abs(travel)))

    def weight(self, lat: float, lon: float, hour: float) -> float:
        env = _envelope(hour, self.start_h, self.peak_start_h, self.peak_end_h, self.end_h)
        if env <= 0:
            return 0.0
        spatial = _anisotropic_weight(
            (lon, lat), self.center_at(hour), self.heading_deg, self.along_miles, self.cross_miles
        )
        return env * spatial


@dataclass(frozen=True)
class DemoScenario:
    """The three-storm script used when ``demo_scenario=load_wind``."""

    storms: tuple[Storm, ...]

    def sample(self, lat: float, lon: float, eta_hours: float) -> WeatherSample:
        """Weather at one point and time. Checkpoints and the area must both call this."""
        wind = CALM_WIND_MPH
        rain = 0.0
        snow = 0.0
        wind_dir = CALM_WIND_DIR_DEG
        temp = CALM_TEMP_F
        wind_w = 0.0
        for storm in self.storms:
            weight = storm.weight(lat, lon, eta_hours)
            if weight <= 0:
                continue
            value = storm.peak_value * weight
            if storm.kind == "wind" and value > wind:
                wind = value
                wind_dir = storm.wind_dir_deg
                wind_w = weight
            elif storm.kind == "rain" and value > rain:
                rain = value
            elif storm.kind == "snow" and value > snow:
                snow = value
        if snow > 0.4:
            temp = 22.0
        elif rain > 0.08:
            temp = 46.0
        elif wind_w > 0.25:
            temp = 52.0
        return WeatherSample(
            wind_mph=round(wind, 1),
            wind_gust_mph=round(wind, 1),
            wind_dir_deg=round(wind_dir, 1),
            rain_in_hr=round(rain, 3),
            snow_in_hr=round(snow, 2),
            temperature_f=round(temp, 1),
            visibility_mi=2.0 if snow > 1.0 else 10.0,
            weather_code=71 if snow > 0.5 else 61 if rain > 0.1 else 0,
        )


def build_demo_scenario(route_lines: list[list[Coord]]) -> DemoScenario:
    """Pin wind / rain / snow onto routes A / B / C (whatever geometry we got)."""
    if not route_lines:
        raise ValueError("demo scenario needs at least one route line")
    lines = [line for line in route_lines if len(line) >= 2]
    if not lines:
        raise ValueError("demo scenario needs at least one usable polyline")
    a = lines[0]
    b = lines[1] if len(lines) > 1 else lines[0]
    c = lines[2] if len(lines) > 2 else lines[-1]

    def place(
        line: list[Coord], fraction: float, peak_start: float, peak_end: float
    ) -> tuple[Coord, float, float]:
        profile = _profile(line)
        miles = meters_to_miles(profile.total_m) * fraction
        hit = min(peak_end, max(peak_start, miles / TRUCK_MPH))
        return point_at_mile(line, miles), hit, _route_bearing(line, miles)

    wind_origin, wind_hit, _ = place(a, 0.50, 5.0, 16.0)
    rain_origin, rain_hit, _ = place(b, 0.55, 6.0, 14.0)
    snow_origin, snow_hit, snow_bearing = place(c, 0.48, 6.0, 15.0)

    return DemoScenario(
        storms=(
            Storm(
                kind="wind",
                origin=wind_origin,
                start_h=1.0,
                peak_start_h=5.0,
                peak_end_h=16.0,
                end_h=30.0,
                speed_mph=14.0,
                heading_deg=42.0,  # NE drift off Omaha
                along_miles=38.0,
                cross_miles=16.0,
                peak_value=58.0,  # >= 55 mph core → No Travel at 42k lb
                wind_dir_deg=135.0,
                hit_hour=wind_hit,
            ),
            Storm(
                kind="rain",
                origin=rain_origin,
                start_h=2.0,
                peak_start_h=6.0,
                peak_end_h=10.0,
                end_h=28.0,
                speed_mph=28.0,
                heading_deg=90.0,  # east across Kansas
                along_miles=12.0,  # thin east–west so it clips B instead of riding it
                cross_miles=18.0,
                peak_value=0.78,  # Severe rain band
                hit_hour=rain_hit,
            ),
            Storm(
                kind="snow",
                origin=snow_origin,
                start_h=-1.0,
                peak_start_h=0.0,
                peak_end_h=48.0,
                end_h=49.0,
                speed_mph=0.0,
                heading_deg=snow_bearing,
                along_miles=55.0,
                cross_miles=22.0,
                peak_value=2.55,  # Severe snow band
                hit_hour=snow_hit,
            ),
        )
    )

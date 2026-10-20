"""Geodesic helpers for turning a raw route geometry into timed checkpoints.

The routing providers hand back a polyline plus timing information at different
granularities (OSRM gives per-edge durations, OpenRouteService gives per-step
durations). Both are normalised into a :class:`RouteProfile`, which maps a
distance along the route to a coordinate *and* an elapsed travel time. Every
checkpoint ETA in the app comes from that mapping, so a checkpoint 300 miles in
is timed from the actual road segments leading up to it rather than from a flat
average speed.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from dataclasses import dataclass

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_MILE = 1609.344

# (longitude, latitude) ordering, matching GeoJSON.
Coord = tuple[float, float]


def miles_to_meters(miles: float) -> float:
    return miles * METERS_PER_MILE


def meters_to_miles(meters: float) -> float:
    return meters / METERS_PER_MILE


def compass_from_deg(degrees: float | None) -> str | None:
    """Eight-point compass label for a meteorological wind direction (blows from)."""
    if degrees is None:
        return None
    labels = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return labels[round(degrees / 45.0) % 8]


def haversine_m(a: Coord, b: Coord) -> float:
    """Great-circle distance in meters between two (lon, lat) points."""
    lon1, lat1 = a
    lon2, lat2 = b
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    h = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, h)))


def initial_bearing_deg(a: Coord, b: Coord) -> float:
    """Forward azimuth from ``a`` to ``b`` in degrees clockwise from north."""
    lon1, lat1 = a
    lon2, lat2 = b
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def offset_coord(origin: Coord, bearing_deg: float, distance_m: float) -> Coord:
    """Point reached by travelling ``distance_m`` from ``origin`` on a bearing."""
    lon, lat = origin
    delta = distance_m / EARTH_RADIUS_M
    theta = math.radians(bearing_deg)
    phi1 = math.radians(lat)
    lambda1 = math.radians(lon)
    phi2 = math.asin(
        math.sin(phi1) * math.cos(delta) + math.cos(phi1) * math.sin(delta) * math.cos(theta)
    )
    lambda2 = lambda1 + math.atan2(
        math.sin(theta) * math.sin(delta) * math.cos(phi1),
        math.cos(delta) - math.sin(phi1) * math.sin(phi2),
    )
    return (round(math.degrees(lambda2), 6), round(math.degrees(phi2), 6))


def lerp_coord(a: Coord, b: Coord, t: float) -> Coord:
    """Linear interpolation between two nearby coordinates."""
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def cumulative_distances(coords: list[Coord]) -> list[float]:
    """Running great-circle distance at each vertex, starting at 0."""
    cum = [0.0]
    for prev, cur in zip(coords, coords[1:]):
        cum.append(cum[-1] + haversine_m(prev, cur))
    return cum


@dataclass(frozen=True)
class Checkpoint:
    """A sampling point along the route with the truck's ETA at that point."""

    index: int
    lon: float
    lat: float
    distance_m: float
    elapsed_s: float
    # Length of route this checkpoint is responsible for, used to attribute
    # "severe miles" / "high miles" to the risk observed here.
    segment_m: float

    @property
    def coord(self) -> Coord:
        return (self.lon, self.lat)


class RouteProfile:
    """Distance-and-time indexed view of a route polyline."""

    def __init__(self, coords: list[Coord], cum_m: list[float], cum_s: list[float]) -> None:
        if len(coords) < 2:
            raise ValueError("A route needs at least two coordinates")
        if not (len(coords) == len(cum_m) == len(cum_s)):
            raise ValueError("Coordinate, distance and time arrays must be the same length")
        self.coords = coords
        self.cum_m = cum_m
        self.cum_s = cum_s

    @property
    def total_m(self) -> float:
        return self.cum_m[-1]

    @property
    def total_s(self) -> float:
        return self.cum_s[-1]

    def at_distance(self, distance_m: float) -> tuple[Coord, float]:
        """Interpolate the coordinate and elapsed seconds at a route distance."""
        distance_m = min(max(distance_m, 0.0), self.total_m)
        # bisect_right - 1 gives the vertex at or before the target distance.
        i = max(0, bisect_right(self.cum_m, distance_m) - 1)
        if i >= len(self.coords) - 1:
            return self.coords[-1], self.cum_s[-1]

        span = self.cum_m[i + 1] - self.cum_m[i]
        t = 0.0 if span <= 0 else (distance_m - self.cum_m[i]) / span
        coord = lerp_coord(self.coords[i], self.coords[i + 1], t)
        elapsed = self.cum_s[i] + (self.cum_s[i + 1] - self.cum_s[i]) * t
        return coord, elapsed

    def sample(self, interval_m: float, max_points: int | None = None) -> list[Checkpoint]:
        """Checkpoints every ``interval_m``, always including origin and destination.

        If honouring the requested interval would blow past ``max_points`` (and so
        hammer the weather API), the interval is widened just enough to fit.
        """
        if interval_m <= 0:
            raise ValueError("interval_m must be positive")

        if max_points is not None and max_points >= 2:
            needed = int(self.total_m // interval_m) + 2
            if needed > max_points:
                interval_m = self.total_m / (max_points - 1)

        distances: list[float] = []
        d = 0.0
        while d < self.total_m:
            distances.append(d)
            d += interval_m
        # Always finish at the destination. Only collapse a true near-duplicate
        # (within 0.5 miles) so a 1,005 mi / 25 mi sample still includes Denver.
        leftover = self.total_m - distances[-1] if distances else self.total_m
        if distances and leftover < miles_to_meters(0.5):
            distances[-1] = self.total_m
        elif leftover > 1.0:
            distances.append(self.total_m)

        checkpoints: list[Checkpoint] = []
        for idx, dist in enumerate(distances):
            coord, elapsed = self.at_distance(dist)
            # Each checkpoint owns the route between the midpoints to its
            # neighbours, so the per-level mileages sum to the route length.
            lower = (distances[idx - 1] + dist) / 2 if idx > 0 else 0.0
            upper = (
                (dist + distances[idx + 1]) / 2 if idx < len(distances) - 1 else self.total_m
            )
            checkpoints.append(
                Checkpoint(
                    index=idx,
                    lon=round(coord[0], 6),
                    lat=round(coord[1], 6),
                    distance_m=dist,
                    elapsed_s=elapsed,
                    segment_m=max(0.0, upper - lower),
                )
            )
        return checkpoints


def _rescale(values: list[float], target_total: float | None) -> list[float]:
    """Scale a cumulative array so its last entry equals ``target_total``."""
    if not target_total or values[-1] <= 0:
        return values
    factor = target_total / values[-1]
    return [v * factor for v in values]


def profile_from_edge_durations(
    coords: list[Coord],
    edge_durations: list[float],
    total_distance_m: float | None = None,
    total_duration_s: float | None = None,
) -> RouteProfile:
    """Build a profile from per-edge durations (OSRM ``annotation.duration``).

    ``edge_durations`` has one entry per segment between consecutive vertices,
    which is the most precise timing any of our providers expose.
    """
    cum_m = cumulative_distances(coords)
    cum_s = [0.0]
    for i in range(len(coords) - 1):
        step = edge_durations[i] if i < len(edge_durations) else 0.0
        cum_s.append(cum_s[-1] + max(0.0, float(step)))
    return RouteProfile(
        coords,
        _rescale(cum_m, total_distance_m),
        _rescale(cum_s, total_duration_s),
    )


def profile_from_steps(
    coords: list[Coord],
    steps: list[tuple[int, int, float]],
    total_distance_m: float | None = None,
    total_duration_s: float | None = None,
) -> RouteProfile:
    """Build a profile from step spans ``(start_index, end_index, duration_s)``.

    OpenRouteService reports duration per manoeuvre step along with the geometry
    indices it covers. Within a step we spread the duration across vertices in
    proportion to their distance, which assumes constant speed between
    manoeuvres - a good approximation for highway driving.
    """
    cum_m = cumulative_distances(coords)
    cum_s = [0.0] * len(coords)

    for start, end, duration in steps:
        start = max(0, min(start, len(coords) - 1))
        end = max(start, min(end, len(coords) - 1))
        step_distance = cum_m[end] - cum_m[start]
        for i in range(start, end):
            if step_distance > 0:
                share = (cum_m[i + 1] - cum_m[i]) / step_distance
            else:
                share = 1.0 / max(1, end - start)
            cum_s[i + 1] = cum_s[i] + duration * share
        # Steps are contiguous; carry the running total into the next one.
        if end + 1 < len(coords) and cum_s[end + 1] == 0.0:
            cum_s[end + 1] = cum_s[end]

    # Guard against any gaps left by providers with sparse step coverage.
    for i in range(1, len(cum_s)):
        if cum_s[i] < cum_s[i - 1]:
            cum_s[i] = cum_s[i - 1]

    return RouteProfile(
        coords,
        _rescale(cum_m, total_distance_m),
        _rescale(cum_s, total_duration_s),
    )


def simplify(coords: list[Coord], tolerance_m: float = 150.0) -> list[Coord]:
    """Ramer-Douglas-Peucker simplification for display geometry.

    A 700-mile OSRM route carries ~12k vertices; three of those make a payload
    the browser has to parse and the GPU has to draw on every frame. Dropping
    vertices that sit within ~150 m of the line is visually lossless at the zoom
    levels we render and cuts the geometry by roughly an order of magnitude.
    """
    if len(coords) <= 2:
        return list(coords)

    lat0 = math.radians(coords[len(coords) // 2][1])
    mx = EARTH_RADIUS_M * math.cos(lat0) * math.pi / 180.0
    my = EARTH_RADIUS_M * math.pi / 180.0

    def project(c: Coord) -> tuple[float, float]:
        return (c[0] * mx, c[1] * my)

    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]

    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay = project(coords[first])
        bx, by = project(coords[last])
        dx, dy = bx - ax, by - ay
        seg_len_sq = dx * dx + dy * dy

        max_dist = -1.0
        max_index = first
        for i in range(first + 1, last):
            px, py = project(coords[i])
            if seg_len_sq == 0:
                dist = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))
                dist = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if dist > max_dist:
                max_dist = dist
                max_index = i

        if max_dist > tolerance_m:
            keep[max_index] = True
            stack.append((first, max_index))
            stack.append((max_index, last))

    return [c for c, k in zip(coords, keep) if k]

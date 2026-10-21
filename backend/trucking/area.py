"""Filled weather bands over the trip, not a point heatmap.

A regular lon/lat grid covers every route plus a ~90 mile margin. Each cell is
classified into the same Wind / Rain / Snow / risk bands the legend uses, then
merged into nested, smoothed blobs keyed by ``hour`` so the slider can
``setFilter``. Demo storms call the same ``scenario.sample(lat, lon, hour)`` as
the checkpoints.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime

from django.conf import settings

from .corridor import CorridorRequest
from .geo import Coord, haversine_m, initial_bearing_deg, meters_to_miles, miles_to_meters, offset_coord
from .risk import RiskLevel, assess
from .weather.open_meteo import OpenMeteoClient, forecasts_for_request, snap
from .weather.storms import build_demo_scenario

GRID_STEP_DEG = 0.22
MARGIN_MILES = 48.0
CORRIDOR_DIM_MILES = 42.0
MAX_GRID_POINTS = 420
ARROW_STRIDE = 1
BUFFER_VERTICES = 48

WIND_BREAKS = (25.0, 35.0, 45.0, 55.0)
RAIN_BREAKS = (0.10, 0.25, 0.50, 1.00)
SNOW_BREAKS = (0.5, 1.0, 2.0, 3.0)

EMPTY_FC = {"type": "FeatureCollection", "features": []}


def _bbox_with_margin(seeds: list[Coord], margin_miles: float = MARGIN_MILES) -> tuple[float, float, float, float]:
    lons = [lon for lon, _ in seeds]
    lats = [lat for _, lat in seeds]
    west, east = min(lons), max(lons)
    south, north = min(lats), max(lats)
    mid_lat = (south + north) / 2.0
    dlat = margin_miles / 69.0
    cos_lat = max(0.2, math.cos(math.radians(mid_lat)))
    dlon = margin_miles / (69.0 * cos_lat)
    return west - dlon, south - dlat, east + dlon, north + dlat


def regular_grid(
    west: float,
    south: float,
    east: float,
    north: float,
    step: float = GRID_STEP_DEG,
    max_points: int = MAX_GRID_POINTS,
) -> tuple[list[float], list[float]]:
    """Lon/lat axes for a regular grid, coarsened if the cap would be exceeded."""
    west, east = sorted((west, east))
    south, north = sorted((south, north))
    if east - west < step:
        east = west + step
    if north - south < step:
        north = south + step
    cols = max(3, int(round((east - west) / step)) + 1)
    rows = max(3, int(round((north - south) / step)) + 1)
    while cols * rows > max_points and (cols > 3 or rows > 3):
        if cols >= rows and cols > 3:
            cols -= 1
        elif rows > 3:
            rows -= 1
        else:
            break
    xs = [west + (east - west) * c / max(cols - 1, 1) for c in range(cols)]
    ys = [south + (north - south) * r / max(rows - 1, 1) for r in range(rows)]
    return xs, ys


def _band(value: float | None, breaks: tuple[float, ...]) -> int:
    if value is None or not math.isfinite(value) or value < breaks[0]:
        return 0
    for index, top in enumerate(breaks[1:], start=1):
        if value < top:
            return index
    return len(breaks)


BLOB_PAD = 1.0
BLOB_SMOOTH_ROUNDS = 4


def _q(x: float, y: float) -> tuple[float, float]:
    return (round(x, 6), round(y, 6))


def _chaikin(ring: list[list[float]], rounds: int = BLOB_SMOOTH_ROUNDS) -> list[list[float]]:
    pts = ring[:-1] if ring and ring[0] == ring[-1] else [list(p) for p in ring]
    if len(pts) < 3:
        return ring
    for _ in range(rounds):
        nxt: list[list[float]] = []
        count = len(pts)
        for i in range(count):
            p = pts[i]
            q = pts[(i + 1) % count]
            nxt.append([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]])
            nxt.append([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]])
        pts = nxt
    pts.append(pts[0])
    return pts


def _stitch_rings(
    edges: list[tuple[tuple[float, float], tuple[float, float]]],
) -> list[list[list[float]]]:
    outgoing: dict[tuple[float, float], list[tuple[float, float]]] = defaultdict(list)
    for start, end in edges:
        if start != end:
            outgoing[start].append(end)
    used: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    rings: list[list[list[float]]] = []
    for origin, dests in outgoing.items():
        for dest in dests:
            if (origin, dest) in used:
                continue
            ring = [origin]
            cur, nxt = origin, dest
            for _ in range(10_000):
                used.add((cur, nxt))
                ring.append(nxt)
                if nxt == origin:
                    break
                found = None
                for cand in outgoing.get(nxt, []):
                    if (nxt, cand) not in used:
                        found = cand
                        break
                if found is None:
                    break
                cur, nxt = nxt, found
            if len(ring) >= 4 and ring[0] == ring[-1]:
                rings.append([[x, y] for x, y in ring])
    return rings


def _region_rings(
    cells: list[tuple[int, int]],
    xs: list[float],
    ys: list[float],
    dx: float,
    dy: float,
) -> list[list[list[float]]]:
    """Smoothed outline of the cell union so weather follows the corridor, not a convex blob."""
    if not cells:
        return []
    occupied = set(cells)
    pad_x, pad_y = dx * BLOB_PAD, dy * BLOB_PAD
    edges: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for r, c in cells:
        x, y = xs[c], ys[r]
        bl, br = _q(x - pad_x, y - pad_y), _q(x + pad_x, y - pad_y)
        tr, tl = _q(x + pad_x, y + pad_y), _q(x - pad_x, y + pad_y)
        if (r - 1, c) not in occupied:
            edges.append((bl, br))
        if (r, c + 1) not in occupied:
            edges.append((br, tr))
        if (r + 1, c) not in occupied:
            edges.append((tr, tl))
        if (r, c - 1) not in occupied:
            edges.append((tl, bl))
    return [_chaikin(ring) for ring in _stitch_rings(edges)]


def _connected_components(mask: list[list[bool]]) -> list[list[tuple[int, int]]]:
    rows = len(mask)
    cols = len(mask[0]) if mask else 0
    seen = [[False] * cols for _ in range(rows)]
    components: list[list[tuple[int, int]]] = []
    for r in range(rows):
        for c in range(cols):
            if not mask[r][c] or seen[r][c]:
                continue
            stack = [(r, c)]
            seen[r][c] = True
            cells: list[tuple[int, int]] = []
            while stack:
                cr, cc = stack.pop()
                cells.append((cr, cc))
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nr, nc = cr + dr, cc + dc
                    if 0 <= nr < rows and 0 <= nc < cols and mask[nr][nc] and not seen[nr][nc]:
                        seen[nr][nc] = True
                        stack.append((nr, nc))
            components.append(cells)
    return components


def _near_route(point: Coord, seeds: list[Coord]) -> int:
    for seed in seeds:
        if meters_to_miles(haversine_m(point, seed)) <= CORRIDOR_DIM_MILES:
            return 1
    return 0


def _thin_line(coords: list[Coord], max_points: int = BUFFER_VERTICES) -> list[Coord]:
    if len(coords) <= max_points:
        return list(coords)
    step = (len(coords) - 1) / (max_points - 1)
    return [coords[int(round(i * step))] for i in range(max_points)]


def _buffer_ring(coords: list[Coord], miles: float) -> list[list[float]]:
    """Closed polygon around a polyline at ``miles`` left and right."""
    line = _thin_line(coords)
    dist = miles_to_meters(miles)
    left: list[Coord] = []
    right: list[Coord] = []
    last = len(line) - 1
    for i, point in enumerate(line):
        nxt = line[min(i + 1, last)]
        prv = line[max(i - 1, 0)]
        heading = initial_bearing_deg(prv, nxt) if prv != nxt else 90.0
        left.append(offset_coord(point, heading - 90.0, dist))
        right.append(offset_coord(point, heading + 90.0, dist))
    ring = [[lon, lat] for lon, lat in left + right[::-1]]
    ring.append(ring[0])
    return ring


def corridor_mask(lines: list[list[Coord]], miles: float = CORRIDOR_DIM_MILES) -> dict:
    """Low-risk sausage around each route. Elevated weather is painted on top."""
    features = []
    for line in lines:
        if len(line) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [_buffer_ring(line, miles)]},
                "properties": {},
            }
        )
    return {"type": "FeatureCollection", "features": features} if features else EMPTY_FC


def _multipolygon_features(
    buckets: dict[tuple[int, str, int, int], list[list[list[float]]]],
) -> list[dict]:
    features = []
    for (hour, metric, band, near), rings in sorted(
        buckets.items(), key=lambda item: (item[0][0], item[0][1], item[0][2])
    ):
        if not rings:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "MultiPolygon", "coordinates": [[ring] for ring in rings]},
                "properties": {"hour": hour, "metric": metric, "band": band, "near": near},
            }
        )
    return features


def build_area_overlay(
    request: CorridorRequest,
    timestamps: list[datetime],
    weather_client: OpenMeteoClient,
) -> dict:
    """Return ``fill`` and ``arrows`` FeatureCollections covering the trip bbox."""
    if len(request.seeds) < 2:
        return {"fill": EMPTY_FC, "arrows": EMPTY_FC}

    lines = [list(line) for line in request.route_lines if len(line) >= 2] or [request.seeds]
    west, south, east, north = _bbox_with_margin(request.seeds, MARGIN_MILES)
    xs, ys = regular_grid(west, south, east, north)
    cols, rows = len(xs), len(ys)
    points: list[Coord] = [(xs[c], ys[r]) for r in range(rows) for c in range(cols)]
    near = [_near_route(point, request.seeds) for point in points]

    scenario = None
    if request.demo_scenario == "load_wind":
        scenario = build_demo_scenario(lines)

    sampled_points = [point for point, is_near in zip(points, near) if is_near]
    forecasts = {}
    if scenario is None:
        forecasts, weather_fallback = forecasts_for_request(
            weather_client, sampled_points, timestamps[-1], request.demo_scenario
        )
        if weather_fallback:
            scenario = build_demo_scenario(lines)
    wind_metric = settings.WIND_RISK_METRIC
    hours = len(timestamps)

    wind: list[list[float | None]] = []
    wind_dir: list[list[float | None]] = []
    rain: list[list[float | None]] = []
    snow: list[list[float | None]] = []
    risk: list[list[int]] = []

    for point, is_near in zip(points, near):
        if not is_near:
            empty = [None] * hours
            wind.append(list(empty))
            wind_dir.append(list(empty))
            rain.append(list(empty))
            snow.append(list(empty))
            risk.append([-1] * hours)
            continue
        forecast = None if scenario else forecasts.get(snap(point))
        wind_row: list[float | None] = []
        dir_row: list[float | None] = []
        rain_row: list[float | None] = []
        snow_row: list[float | None] = []
        risk_row: list[int] = []
        for hour, ts in enumerate(timestamps):
            if scenario is not None:
                sample = scenario.sample(point[1], point[0], float(hour))
            elif forecast is None or not forecast.times:
                wind_row.append(None)
                dir_row.append(None)
                rain_row.append(None)
                snow_row.append(None)
                risk_row.append(-1)
                continue
            else:
                sample = forecast.sample_at(ts.timestamp())
            result = assess(sample, request.load_lb, wind_metric)
            used = sample.effective_wind(wind_metric)
            wind_row.append(None if used is None else round(used, 1))
            dir_row.append(None if sample.wind_dir_deg is None else round(sample.wind_dir_deg, 1))
            rain_row.append(sample.rain_in_hr)
            snow_row.append(sample.snow_in_hr)
            risk_row.append(result.score if result.available else -1)
        wind.append(wind_row)
        wind_dir.append(dir_row)
        rain.append(rain_row)
        snow.append(snow_row)
        risk.append(risk_row)

    arrows: list[dict] = []

    for hour in range(hours):
        for r, y in enumerate(ys):
            for c, x in enumerate(xs):
                index = r * cols + c
                if not near[index] or r % ARROW_STRIDE or c % ARROW_STRIDE:
                    continue
                mph = wind[index][hour]
                direction = wind_dir[index][hour]
                if mph is None or direction is None:
                    continue
                arrows.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [round(x, 4), round(y, 4)]},
                        "properties": {
                            "hour": hour,
                            "windDir": round(direction, 1),
                            "wind": round(mph, 1),
                            "near": 1,
                        },
                    }
                )

    return {
        "mask": EMPTY_FC,
        "fill": EMPTY_FC,
        "arrows": {"type": "FeatureCollection", "features": arrows},
    }

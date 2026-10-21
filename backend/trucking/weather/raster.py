"""Smooth corridor weather as one PNG per forecast hour.

Risk is a continuous field, coloured with a single green → yellow → orange →
red → dark-red ramp. The value is contrast-stretched before colouring so
in-between scores stay vivid instead of muddy. The corridor edge uses a
smoothstep fade, then a light blur knocks off remaining pixel steps.

Rows are spaced in Web Mercator so the image sits on MapLibre without
stretching. The grid is computed once per trip and cached; PNG bytes are
rendered for Risk up front and for other metrics on demand.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
from dataclasses import dataclass, field
from datetime import datetime
from threading import Lock

from django.conf import settings
from PIL import Image, ImageFilter

from ..corridor import CorridorRequest
from ..geo import Coord, haversine_m, meters_to_miles
from ..risk import assess
from .open_meteo import OpenMeteoClient, PointForecast, forecasts_for_request, snap
from .storms import build_demo_scenario

CORRIDOR_MILES = 42.0
FADE_INNER_MILES = 30.0
SAMPLE_COLS = 72
SAMPLE_ROWS = 44
ENLARGE = 4
BLUR_RADIUS = 1.35
MAX_CACHE = 8

# Green → yellow → orange → red → dark red (risk 0 .. 4).
RAMP = (
    (0.0, (34, 197, 94)),
    (1.0, (250, 204, 21)),
    (2.0, (251, 146, 60)),
    (3.0, (239, 68, 68)),
    (4.0, (127, 29, 29)),
)

WIND_SCALE = (0.0, 25.0, 35.0, 45.0, 55.0)
RAIN_SCALE = (0.0, 0.10, 0.25, 0.50, 1.00)
SNOW_SCALE = (0.0, 0.5, 1.0, 2.0, 3.0)


def mercator_y(lat: float) -> float:
    lat = max(-85.051128, min(85.051128, lat))
    return math.log(math.tan(math.pi / 4.0 + math.radians(lat) / 2.0))


def inv_mercator(y: float) -> float:
    return math.degrees(2.0 * math.atan(math.exp(y)) - math.pi / 2.0)


def _bbox(seeds: list[Coord], miles: float = CORRIDOR_MILES + 8.0) -> tuple[float, float, float, float]:
    lons = [lon for lon, _ in seeds]
    lats = [lat for _, lat in seeds]
    west, east = min(lons), max(lons)
    south, north = min(lats), max(lats)
    mid_lat = (south + north) / 2.0
    dlat = miles / 69.0
    cos_lat = max(0.2, math.cos(math.radians(mid_lat)))
    dlon = miles / (69.0 * cos_lat)
    return west - dlon, south - dlat, east + dlon, north + dlat


def _thin(line: list[Coord], max_points: int = 56) -> list[Coord]:
    if len(line) <= max_points:
        return list(line)
    step = (len(line) - 1) / (max_points - 1)
    return [line[int(round(i * step))] for i in range(max_points)]


def _min_miles(point: Coord, lines: list[list[Coord]]) -> float:
    best = 1e9
    for line in lines:
        for coord in line:
            dist = meters_to_miles(haversine_m(point, coord))
            if dist < best:
                best = dist
    return best


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _sample(grid: list[list[float]], u: float, v: float) -> float:
    rows = len(grid)
    cols = len(grid[0]) if grid else 0
    if rows == 0 or cols == 0:
        return 0.0
    u = max(0.0, min(cols - 1.0, u))
    v = max(0.0, min(rows - 1.0, v))
    c0 = int(math.floor(u))
    r0 = int(math.floor(v))
    c1 = min(cols - 1, c0 + 1)
    r1 = min(rows - 1, r0 + 1)
    fu, fv = u - c0, v - r0
    top = _lerp(grid[r0][c0], grid[r0][c1], fu)
    bot = _lerp(grid[r1][c0], grid[r1][c1], fu)
    return _lerp(top, bot, fv)


def _enlarge(value: float) -> float:
    """Stretch each band toward its integer centre so mid-colours stay vivid."""
    if value <= 0:
        return 0.0
    if value >= 4:
        return 4.0
    whole = math.floor(value)
    frac = value - whole
    pushed = max(0.0, min(1.0, 0.5 + (frac - 0.5) * 1.7))
    return whole + pushed


def _ramp_rgb(value: float) -> tuple[int, int, int]:
    value = _enlarge(max(0.0, min(4.0, value)))
    for i in range(len(RAMP) - 1):
        left, a = RAMP[i]
        right, b = RAMP[i + 1]
        if value <= right:
            t = 0.0 if right == left else (value - left) / (right - left)
            return (
                int(round(_lerp(a[0], b[0], t))),
                int(round(_lerp(a[1], b[1], t))),
                int(round(_lerp(a[2], b[2], t))),
            )
    return RAMP[-1][1]


def _to_score(raw: float | None, scale: tuple[float, ...]) -> float:
    if raw is None or not math.isfinite(raw) or raw <= scale[0]:
        return 0.0
    if raw >= scale[-1]:
        return float(len(scale) - 1)
    for i in range(len(scale) - 1):
        lo, hi = scale[i], scale[i + 1]
        if raw <= hi:
            span = hi - lo or 1.0
            return i + (raw - lo) / span
    return float(len(scale) - 1)


def _fade(dist: float) -> float:
    if dist <= FADE_INNER_MILES:
        return 1.0
    if dist >= CORRIDOR_MILES:
        return 0.0
    t = (dist - FADE_INNER_MILES) / (CORRIDOR_MILES - FADE_INNER_MILES)
    t = t * t * (3.0 - 2.0 * t)
    return 1.0 - t


def _alpha(score: float, fade: float, storms_only: bool = False) -> int:
    if fade <= 0:
        return 0
    # Wind / rain / snow skip the Low (green) band — only Risk paints calm corridor.
    if storms_only and score < 1.0:
        return 0
    coverage = 0.16 + 0.58 * max(0.0, min(1.0, score / 4.0))
    return max(0, min(255, int(round(255 * fade * coverage))))


def _metric_grid(
    hour: int,
    metric: str,
    risk: list[list[list[float]]],
    wind: list[list[list[float]]],
    rain: list[list[list[float]]],
    snow: list[list[list[float]]],
) -> list[list[float]]:
    if metric == "wind":
        return [[_to_score(value, WIND_SCALE) for value in row] for row in wind[hour]]
    if metric == "rain":
        return [[_to_score(value, RAIN_SCALE) for value in row] for row in rain[hour]]
    if metric == "snow":
        return [[_to_score(value, SNOW_SCALE) for value in row] for row in snow[hour]]
    return risk[hour]


def render_png(
    score: list[list[float]],
    fade: list[list[float]],
    storms_only: bool = False,
) -> bytes:
    src_rows = len(score)
    src_cols = len(score[0]) if score else 0
    width = max(2, src_cols * ENLARGE)
    height = max(2, src_rows * ENLARGE)
    img = Image.new("RGBA", (width, height))
    pixels = img.load()
    col_scale = (src_cols - 1) / max(width - 1, 1)
    row_scale = (src_rows - 1) / max(height - 1, 1)
    for y in range(height):
        v = y * row_scale
        for x in range(width):
            u = x * col_scale
            value = _sample(score, u, v)
            edge = _sample(fade, u, v)
            alpha = _alpha(value, edge, storms_only=storms_only)
            if alpha <= 0:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            r, g, b = _ramp_rgb(value)
            pixels[x, y] = (r, g, b, alpha)
    img = img.filter(ImageFilter.GaussianBlur(radius=BLUR_RADIUS))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


@dataclass
class RasterSet:
    cache_id: str
    hours: int
    coordinates: list[list[float]]
    fade: list[list[float]]
    risk: list[list[list[float]]]
    wind: list[list[list[float]]]
    rain: list[list[list[float]]]
    snow: list[list[list[float]]]
    pngs: dict[tuple[int, str], bytes] = field(default_factory=dict)

    def png(self, hour: int, metric: str = "risk") -> bytes:
        hour = max(0, min(self.hours - 1, int(hour)))
        metric = metric if metric in ("risk", "wind", "rain", "snow") else "risk"
        key = (hour, metric)
        cached = self.pngs.get(key)
        if cached is not None:
            return cached
        grid = _metric_grid(hour, metric, self.risk, self.wind, self.rain, self.snow)
        png = render_png(grid, self.fade, storms_only=metric != "risk")
        self.pngs[key] = png
        return png

    def as_dict(self) -> dict:
        return {
            "id": self.cache_id,
            "hours": self.hours,
            "coordinates": self.coordinates,
            "url": f"/api/area-weather/{self.cache_id}/{{hour}}.png",
        }


_LOCK = Lock()
_CACHE: dict[str, RasterSet] = {}


def _cache_id(request: CorridorRequest, hours: int) -> str:
    payload = {
        "seeds": [[round(lon, 4), round(lat, 4)] for lon, lat in request.seeds[:80]],
        "load": round(request.load_lb, 1),
        "hours": hours,
        "demo": request.demo_scenario,
        "anchor": request.anchor.astimezone().replace(minute=0, second=0, microsecond=0).isoformat(),
        "lines": len(request.route_lines),
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def get_cached(cache_id: str) -> RasterSet | None:
    with _LOCK:
        return _CACHE.get(cache_id)


def _nearest_forecast(point: Coord, forecasts: dict[Coord, PointForecast]) -> PointForecast | None:
    if not forecasts:
        return None
    hit = forecasts.get(snap(point))
    if hit is not None:
        return hit
    lon, lat = point
    best: PointForecast | None = None
    best_d = 1e18
    for coord, forecast in forecasts.items():
        dlon = coord[0] - lon
        dlat = coord[1] - lat
        dist = dlon * dlon + dlat * dlat
        if dist < best_d:
            best_d = dist
            best = forecast
    return best


def build_and_cache_rasters(
    request: CorridorRequest,
    timestamps: list[datetime],
    weather_client: OpenMeteoClient,
    forecasts: dict[Coord, PointForecast] | None = None,
) -> RasterSet:
    hours = len(timestamps)
    cache_id = _cache_id(request, hours)
    with _LOCK:
        existing = _CACHE.get(cache_id)
        if existing is not None:
            return existing

    lines = [list(line) for line in request.route_lines if len(line) >= 2] or [list(request.seeds)]
    thinned = [_thin(line) for line in lines]
    west, south, east, north = _bbox(request.seeds)
    y0, y1 = mercator_y(south), mercator_y(north)
    cols, rows = SAMPLE_COLS, SAMPLE_ROWS
    xs = [west + (east - west) * c / max(cols - 1, 1) for c in range(cols)]
    # Row 0 is north so PNG y=0 matches MapLibre's top-left (NW) corner.
    ys = [inv_mercator(y1 - (y1 - y0) * r / max(rows - 1, 1)) for r in range(rows)]

    scenario = None
    if request.demo_scenario == "load_wind":
        scenario = build_demo_scenario(lines)

    points: list[Coord] = [(xs[c], ys[r]) for r in range(rows) for c in range(cols)]
    fade_flat = [_fade(_min_miles(point, thinned)) for point in points]
    live = {} if scenario else dict(forecasts or {})
    if scenario is None and not live:
        # Never sample the 72×44 raster live — that burns the daily Open-Meteo cap.
        thin = [point for point, fade in zip(points, fade_flat) if fade > 0.45]
        if len(thin) > 64:
            step = max(1, len(thin) // 64)
            thin = thin[::step]
        live, weather_fallback = forecasts_for_request(
            weather_client, thin or list(request.seeds), timestamps[-1], request.demo_scenario
        )
        if weather_fallback:
            scenario = None
            live = live or {}
    wind_metric = settings.WIND_RISK_METRIC

    fade = [[0.0] * cols for _ in range(rows)]
    risk = [[[0.0] * cols for _ in range(rows)] for _ in range(hours)]
    wind = [[[0.0] * cols for _ in range(rows)] for _ in range(hours)]
    rain = [[[0.0] * cols for _ in range(rows)] for _ in range(hours)]
    snow = [[[0.0] * cols for _ in range(rows)] for _ in range(hours)]

    for r, y in enumerate(ys):
        for c, x in enumerate(xs):
            index = r * cols + c
            edge = fade_flat[index]
            fade[r][c] = edge
            if edge <= 0:
                continue
            point = points[index]
            forecast = None if scenario else _nearest_forecast(point, live)
            for hour, ts in enumerate(timestamps):
                if scenario is not None:
                    sample = scenario.sample(y, x, float(hour))
                elif forecast is None or not forecast.times:
                    continue
                else:
                    sample = forecast.sample_at(ts.timestamp())
                result = assess(sample, request.load_lb, wind_metric)
                risk[hour][r][c] = float(result.score) if result.available else 0.0
                used = sample.effective_wind(wind_metric)
                wind[hour][r][c] = 0.0 if used is None else float(used)
                rain[hour][r][c] = 0.0 if sample.rain_in_hr is None else float(sample.rain_in_hr)
                snow[hour][r][c] = 0.0 if sample.snow_in_hr is None else float(sample.snow_in_hr)

    bundle = RasterSet(
        cache_id=cache_id,
        hours=hours,
        coordinates=[[west, north], [east, north], [east, south], [west, south]],
        fade=fade,
        risk=risk,
        wind=wind,
        rain=rain,
        snow=snow,
    )

    with _LOCK:
        _CACHE[cache_id] = bundle
        while len(_CACHE) > MAX_CACHE:
            _CACHE.pop(next(iter(_CACHE)))
    return bundle

"""Trip planning: routes in, risk-scored and ranked routes out.

Pipeline
--------
1. Ask the router for alternatives between origin and destination.
2. Backfill with forced detours until we have three genuinely distinct options.
3. Sample checkpoints along each route at the requested interval.
4. Fetch the forecast for every checkpoint in one batched, deduplicated pass.
5. Score each checkpoint at its own ETA and roll the scores up per route.
6. Rank the routes by the assignment's preference order.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from django.conf import settings

from .geo import (
    Checkpoint,
    Coord,
    haversine_m,
    initial_bearing_deg,
    meters_to_miles,
    miles_to_meters,
    offset_coord,
    simplify,
)
from .http import UpstreamError
from .providers.base import Place, RawRoute
from .providers.registry import get_fallback_router, get_router
from .risk import RiskLevel, RiskAssessment, WeatherSample, assess
from .weather.open_meteo import OpenMeteoClient, PointForecast, snap

logger = logging.getLogger(__name__)

TARGET_ROUTE_COUNT = 3
# Two routes are "the same" if they share more than this fraction of their cells.
MAX_SHARED_FRACTION = 0.72
# Reject forced detours that balloon the trip beyond this multiple of the best route.
MAX_DETOUR_RATIO = 1.75
# Lateral offsets (as a fraction of the straight-line distance) tried when
# forcing an alternative corridor.
DETOUR_OFFSETS = (0.18, -0.18, 0.30, -0.30, 0.45, -0.45)
# Ceiling on checkpoints per route, protecting the weather API on long trips.
MAX_CHECKPOINTS_PER_ROUTE = 180


@dataclass(frozen=True)
class TripRequest:
    origin: Place
    destination: Place
    departure: datetime
    load_lb: float
    interval_miles: float


@dataclass
class EvaluatedCheckpoint:
    checkpoint: Checkpoint
    eta: datetime
    sample: WeatherSample
    assessment: RiskAssessment

    def as_dict(self) -> dict:
        cp = self.checkpoint
        return {
            "index": cp.index,
            "lat": cp.lat,
            "lon": cp.lon,
            "mile": round(meters_to_miles(cp.distance_m), 1),
            "segment_miles": round(meters_to_miles(cp.segment_m), 2),
            "eta": self.eta.isoformat(),
            "elapsed_minutes": round(cp.elapsed_s / 60),
            "weather": {
                "wind_mph": self.sample.wind_mph,
                "wind_gust_mph": self.sample.wind_gust_mph,
                "rain_in_hr": self.sample.rain_in_hr,
                "snow_in_hr": self.sample.snow_in_hr,
                "temperature_f": self.sample.temperature_f,
                "visibility_mi": self.sample.visibility_mi,
                "weather_code": self.sample.weather_code,
            },
            "risk": {
                "level": self.assessment.level.slug,
                "label": self.assessment.level.label,
                "score": self.assessment.score,
                "driver": self.assessment.driver,
                "wind_used_mph": self.assessment.wind_used_mph,
                "components": {
                    "wind": self.assessment.wind.slug,
                    "rain": self.assessment.rain.slug,
                    "snow": self.assessment.snow.slug,
                },
                "reasons": self.assessment.reasons,
            },
        }


@dataclass
class EvaluatedRoute:
    id: str
    label: str
    raw: RawRoute
    checkpoints: list[EvaluatedCheckpoint]
    miles_by_level: dict[RiskLevel, float] = field(default_factory=dict)
    average_risk: float = 0.0
    max_level: RiskLevel = RiskLevel.LOW
    arrival: datetime | None = None

    @property
    def distance_miles(self) -> float:
        return meters_to_miles(self.raw.distance_m)

    @property
    def duration_hours(self) -> float:
        return self.raw.duration_s / 3600

    @property
    def blocked(self) -> bool:
        """True when any part of the route is in No Travel conditions."""
        return self.miles_by_level.get(RiskLevel.NO_TRAVEL, 0.0) > 0

    def miles(self, level: RiskLevel) -> float:
        return self.miles_by_level.get(level, 0.0)

    def ranking_key(self) -> tuple:
        """The assignment's preference order, most significant first.

        No Travel mileage is checked ahead of Severe: a route the rules forbid
        outright should never outrank a legal one, however fast it is. Mileages
        are rounded to a tenth so floating-point noise does not decide a tie.
        """
        return (
            round(self.miles(RiskLevel.NO_TRAVEL), 1),
            round(self.miles(RiskLevel.SEVERE), 1),
            round(self.miles(RiskLevel.HIGH), 1),
            round(self.average_risk, 3),
            self.raw.duration_s,
        )

    def as_dict(self, include_geometry: bool = True) -> dict:
        payload: dict = {
            "id": self.id,
            "label": self.label,
            "provider": self.raw.provider,
            "origin_kind": self.raw.origin_kind,
            "summary": {
                "distance_miles": round(self.distance_miles, 1),
                "duration_seconds": round(self.raw.duration_s),
                "duration_hours": round(self.duration_hours, 2),
                "arrival": self.arrival.isoformat() if self.arrival else None,
                "checkpoint_count": len(self.checkpoints),
                "average_risk": round(self.average_risk, 3),
                "max_level": self.max_level.slug,
                "max_level_label": self.max_level.label,
                "blocked": self.blocked,
                "miles_by_level": {
                    level.slug: round(self.miles(level), 1) for level in RiskLevel
                },
            },
            "checkpoints": [cp.as_dict() for cp in self.checkpoints],
        }
        if include_geometry:
            payload["geometry"] = {
                "type": "LineString",
                "coordinates": [
                    [round(lon, 5), round(lat, 5)] for lon, lat in simplify(self.raw.coords)
                ],
            }
            payload["corridor_seeds"] = [
                [cp.checkpoint.lon, cp.checkpoint.lat] for cp in self._corridor_seeds()
            ]
        return payload

    def _corridor_seeds(self, spacing_miles: float = 25.0) -> list[EvaluatedCheckpoint]:
        """Thinned checkpoints the client can post back for the heatmap."""
        if not self.checkpoints:
            return []
        spacing_m = miles_to_meters(spacing_miles)
        seeds = [self.checkpoints[0]]
        for cp in self.checkpoints[1:]:
            if cp.checkpoint.distance_m - seeds[-1].checkpoint.distance_m >= spacing_m:
                seeds.append(cp)
        if seeds[-1] is not self.checkpoints[-1]:
            seeds.append(self.checkpoints[-1])
        return seeds


# --- route collection ------------------------------------------------------


def _cells(coords: list[Coord], size: float = 0.03) -> set[tuple[int, int]]:
    """Coarse spatial fingerprint (~3 km cells) used to compare routes cheaply."""
    return {(int(lon / size), int(lat / size)) for lon, lat in coords}


def shared_fraction(a: list[Coord], b: list[Coord]) -> float:
    """Fraction of route ``a`` that overlaps route ``b``."""
    cells_a = _cells(a)
    if not cells_a:
        return 1.0
    return len(cells_a & _cells(b)) / len(cells_a)


def _is_distinct(candidate: RawRoute, existing: list[RawRoute]) -> bool:
    return all(
        shared_fraction(candidate.coords, route.coords) <= MAX_SHARED_FRACTION
        for route in existing
    )


def collect_routes(router, request: TripRequest) -> list[RawRoute]:
    """Gather up to three distinct routes, forcing detours if the router is stingy."""
    origin, destination = request.origin.coord, request.destination.coord

    primary = router.routes([origin, destination], TARGET_ROUTE_COUNT, request.load_lb)
    routes: list[RawRoute] = []
    for route in primary:
        if _is_distinct(route, routes):
            routes.append(route)

    if len(routes) >= TARGET_ROUTE_COUNT or not routes:
        return routes[:TARGET_ROUTE_COUNT]

    # The router gave us fewer than three usable options (the public OSRM server
    # typically returns two). Force extra corridors by routing through a point
    # offset perpendicular to the direct line.
    best = min(routes, key=lambda r: r.duration_s)
    midpoint, _ = best.profile.at_distance(best.profile.total_m / 2)
    bearing = initial_bearing_deg(origin, destination)
    straight_m = haversine_m(origin, destination)

    for fraction in DETOUR_OFFSETS:
        if len(routes) >= TARGET_ROUTE_COUNT:
            break
        side = 90 if fraction > 0 else -90
        via = offset_coord(midpoint, bearing + side, abs(fraction) * straight_m)
        try:
            detours = router.routes([origin, via, destination], 1, request.load_lb)
        except UpstreamError as exc:
            logger.info("Detour via %s failed: %s", via, exc)
            continue

        for detour in detours:
            if detour.distance_m > best.distance_m * MAX_DETOUR_RATIO:
                continue
            if not _is_distinct(detour, routes):
                continue
            detour.origin_kind = "detour"
            detour.via = via
            routes.append(detour)
            break

    return routes[:TARGET_ROUTE_COUNT]


def _label_routes(routes: list[EvaluatedRoute]) -> None:
    """Name routes by what makes each one worth considering."""
    if not routes:
        return
    fastest = min(routes, key=lambda r: r.raw.duration_s)
    shortest = min(routes, key=lambda r: r.raw.distance_m)

    alternate = 1
    for route in routes:
        if route is fastest:
            route.label = "Fastest"
        elif route is shortest:
            route.label = "Shortest"
        else:
            route.label = f"Alternate {alternate}"
            alternate += 1


# --- scoring ---------------------------------------------------------------


def _aggregate(route: EvaluatedRoute) -> None:
    """Roll checkpoint risk up into per-level mileage and an average score."""
    miles_by_level: dict[RiskLevel, float] = {level: 0.0 for level in RiskLevel}
    weighted_score = 0.0
    total_miles = 0.0

    for cp in route.checkpoints:
        segment_miles = meters_to_miles(cp.checkpoint.segment_m)
        miles_by_level[cp.assessment.level] += segment_miles
        weighted_score += cp.assessment.score * segment_miles
        total_miles += segment_miles

    route.miles_by_level = miles_by_level
    # Distance-weighted so a long stretch of bad weather counts for more than a
    # single rough checkpoint, regardless of how densely we sampled.
    route.average_risk = weighted_score / total_miles if total_miles else 0.0
    route.max_level = max(
        (cp.assessment.level for cp in route.checkpoints), default=RiskLevel.LOW
    )


def _recommendation_reasons(best: EvaluatedRoute, others: list[EvaluatedRoute]) -> list[str]:
    reasons: list[str] = []
    if best.blocked:
        reasons.append(
            "Every option crosses No Travel conditions - consider delaying departure."
        )

    runner_up = min(others, key=lambda r: r.ranking_key()) if others else None
    if runner_up is None:
        reasons.append("Only one viable route was found.")
        return reasons

    severe_delta = runner_up.miles(RiskLevel.SEVERE) - best.miles(RiskLevel.SEVERE)
    high_delta = runner_up.miles(RiskLevel.HIGH) - best.miles(RiskLevel.HIGH)
    hours_delta = (best.raw.duration_s - runner_up.raw.duration_s) / 3600

    if severe_delta > 0.1:
        reasons.append(
            f"{severe_delta:.0f} fewer Severe miles than {runner_up.label} "
            f"({best.miles(RiskLevel.SEVERE):.0f} vs {runner_up.miles(RiskLevel.SEVERE):.0f})."
        )
    if high_delta > 0.1:
        reasons.append(
            f"{high_delta:.0f} fewer High-risk miles than {runner_up.label} "
            f"({best.miles(RiskLevel.HIGH):.0f} vs {runner_up.miles(RiskLevel.HIGH):.0f})."
        )
    if abs(severe_delta) <= 0.1 and abs(high_delta) <= 0.1:
        if best.average_risk < runner_up.average_risk - 0.01:
            reasons.append(
                f"Same Severe and High mileage as {runner_up.label}, but a lower average "
                f"risk ({best.average_risk:.2f} vs {runner_up.average_risk:.2f})."
            )
        else:
            reasons.append(
                f"Risk is effectively tied with {runner_up.label}, so the faster route wins."
            )
    if hours_delta > 0.05:
        reasons.append(
            f"Costs {hours_delta:.1f} h more driving than {runner_up.label}, "
            f"which the lower weather risk justifies."
        )
    elif hours_delta < -0.05:
        reasons.append(f"Also arrives {abs(hours_delta):.1f} h sooner than {runner_up.label}.")

    if best.max_level <= RiskLevel.LOW:
        reasons.append("No checkpoint on this route exceeds Low risk.")
    return reasons


def plan_trip(
    request: TripRequest,
    weather_client: OpenMeteoClient | None = None,
    router=None,
) -> dict:
    """Run the full pipeline and return the API payload."""
    router = router or get_router()
    try:
        raw_routes = collect_routes(router, request)
    except UpstreamError as exc:
        fallback = get_fallback_router()
        if fallback is None:
            raise
        logger.warning("Primary router failed (%s); retrying with %s", exc, fallback.name)
        router = fallback
        raw_routes = collect_routes(router, request)

    if not raw_routes:
        raise UpstreamError("No route could be found between those locations", provider=router.name)

    interval_m = miles_to_meters(request.interval_miles)
    routes: list[EvaluatedRoute] = []
    for index, raw in enumerate(raw_routes):
        checkpoints = raw.profile.sample(interval_m, MAX_CHECKPOINTS_PER_ROUTE)
        routes.append(
            EvaluatedRoute(
                id=f"route-{index + 1}",
                label=f"Route {index + 1}",
                raw=raw,
                checkpoints=[
                    EvaluatedCheckpoint(
                        checkpoint=cp,
                        eta=request.departure + timedelta(seconds=cp.elapsed_s),
                        sample=WeatherSample(),
                        assessment=assess(WeatherSample(), request.load_lb),
                    )
                    for cp in checkpoints
                ],
            )
        )

    # One weather round trip for every checkpoint on every route.
    latest_eta = max(cp.eta for route in routes for cp in route.checkpoints)
    client = weather_client or OpenMeteoClient()
    forecast_days = client.forecast_days_for(latest_eta)
    all_coords = [cp.checkpoint.coord for route in routes for cp in route.checkpoints]
    forecasts: dict[Coord, PointForecast] = client.forecasts(all_coords, forecast_days)

    wind_metric = settings.WIND_RISK_METRIC
    for route in routes:
        for cp in route.checkpoints:
            forecast = forecasts.get(snap(cp.checkpoint.coord))
            if forecast is None:
                continue
            cp.sample = forecast.sample_at(cp.eta.timestamp())
            cp.assessment = assess(cp.sample, request.load_lb, wind_metric)
        route.arrival = request.departure + timedelta(seconds=route.raw.duration_s)
        _aggregate(route)

    _label_routes(routes)
    ranked = sorted(routes, key=lambda r: r.ranking_key())
    best = ranked[0]

    return {
        "generated_at": datetime.now(tz=request.departure.tzinfo).isoformat(),
        "request": {
            "origin": request.origin.as_dict(),
            "destination": request.destination.as_dict(),
            "departure": request.departure.isoformat(),
            "load_lb": request.load_lb,
            "interval_miles": request.interval_miles,
        },
        "provider": {
            "routing": router.name,
            "truck_profile": getattr(router, "supports_truck_profile", False),
            "weather": client.name,
            "wind_metric": wind_metric,
        },
        "routes": [route.as_dict() for route in routes],
        "recommendation": {
            "route_id": best.id,
            "label": best.label,
            "reasons": _recommendation_reasons(best, [r for r in ranked[1:]]),
            "ranking": [
                {
                    "route_id": route.id,
                    "label": route.label,
                    "no_travel_miles": round(route.miles(RiskLevel.NO_TRAVEL), 1),
                    "severe_miles": round(route.miles(RiskLevel.SEVERE), 1),
                    "high_miles": round(route.miles(RiskLevel.HIGH), 1),
                    "average_risk": round(route.average_risk, 3),
                    "duration_hours": round(route.duration_hours, 2),
                }
                for route in ranked
            ],
        },
    }

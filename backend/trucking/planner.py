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
    compass_from_deg,
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
from .weather.open_meteo import OpenMeteoClient, PointForecast, forecasts_for_request, snap
from .weather.storms import DemoScenario, build_demo_scenario

TIMELINE_STEP_S = 15 * 60

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
    demo_scenario: str = ""


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
                "wind_dir_deg": None
                if self.sample.wind_dir_deg is None
                else round(self.sample.wind_dir_deg, 1),
                "wind_dir": compass_from_deg(self.sample.wind_dir_deg),
                "rain_in_hr": self.sample.rain_in_hr,
                "snow_in_hr": self.sample.snow_in_hr,
                "temperature_f": self.sample.temperature_f,
                "visibility_mi": self.sample.visibility_mi,
                "weather_code": self.sample.weather_code,
                "forecast_at": self.eta.isoformat() if self.sample.has_observation() else None,
            },
            "risk": {
                "available": self.assessment.available,
                "level": self.assessment.level.slug if self.assessment.available else "UNKNOWN",
                "label": self.assessment.level.label if self.assessment.available else "Unknown",
                "score": self.assessment.score,
                "driver": self.assessment.driver,
                "wind_used_mph": self.assessment.wind_used_mph,
                "components": {
                    "wind": _risk_slug(self.assessment.wind),
                    "rain": _risk_slug(self.assessment.rain),
                    "snow": _risk_slug(self.assessment.snow),
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
    scored_miles: float = 0.0
    unscored_miles: float = 0.0
    weather_path: list[dict] = field(default_factory=list)

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

        Unscored weather is a last-resort penalty so a missing forecast cannot
        beat a scored route by looking like zero risk. After that: No Travel,
        Severe, High, average risk, then travel time. Mileages are rounded to a
        tenth so floating-point noise does not decide a tie.
        """
        coverage_penalty = 1 if self.scored_miles <= 0 else 0
        average = self.average_risk if self.scored_miles > 0 else 9.0
        return (
            coverage_penalty,
            round(self.miles(RiskLevel.NO_TRAVEL), 1),
            round(self.miles(RiskLevel.SEVERE), 1),
            round(self.miles(RiskLevel.HIGH), 1),
            round(average, 3),
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
                "average_risk": round(self.average_risk, 3) if self.scored_miles > 0 else None,
                "max_level": self.max_level.slug if self.scored_miles > 0 else "UNKNOWN",
                "max_level_label": self.max_level.label if self.scored_miles > 0 else "Unknown",
                "blocked": self.blocked,
                "weather_coverage": round(
                    self.scored_miles / (self.scored_miles + self.unscored_miles), 3
                )
                if (self.scored_miles + self.unscored_miles) > 0
                else 0.0,
                "miles_by_level": {
                    level.slug: round(self.miles(level), 1) for level in RiskLevel
                },
            },
            "checkpoints": [cp.as_dict() for cp in self.checkpoints],
            "weather_path": self.weather_path,
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


def _risk_slug(level: RiskLevel | None) -> str:
    """LOW is 0, so a truthiness check would serialize it as Unknown."""
    return level.slug if level is not None else "UNKNOWN"


def _label_routes(routes: list[EvaluatedRoute]) -> None:
    """Keep the same Route A/B/C names the UI uses, in planner order."""
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    for index, route in enumerate(routes):
        route.label = f"Route {letters[index]}" if index < len(letters) else f"Route {index + 1}"


def _apply_demo_scenario(
    routes: list[EvaluatedRoute],
    departure: datetime,
    load_lb: float,
    wind_metric: str,
) -> DemoScenario | None:
    """Score every checkpoint from the moving storms so dots match the area."""
    if not routes:
        return None
    scenario = build_demo_scenario([list(route.raw.coords) for route in routes])
    for route in routes:
        for evaluated in route.checkpoints:
            eta_hours = (evaluated.eta - departure).total_seconds() / 3600.0
            evaluated.sample = scenario.sample(
                evaluated.checkpoint.lat, evaluated.checkpoint.lon, eta_hours
            )
            evaluated.assessment = assess(evaluated.sample, load_lb, wind_metric)
        _aggregate(route)
    return scenario


def _forecast_near(
    coord: Coord,
    checkpoints: list[EvaluatedCheckpoint],
    forecasts: dict[Coord, PointForecast],
) -> PointForecast | None:
    direct = forecasts.get(snap(coord))
    if direct is not None:
        return direct
    nearest: PointForecast | None = None
    nearest_m = float("inf")
    for evaluated in checkpoints:
        distance = haversine_m(coord, evaluated.checkpoint.coord)
        if distance < nearest_m:
            nearest_m = distance
            nearest = forecasts.get(snap(evaluated.checkpoint.coord))
    return nearest


def _weather_path(
    route: EvaluatedRoute,
    departure: datetime,
    load_lb: float,
    wind_metric: str,
    scenario: DemoScenario | None,
    forecasts: dict[Coord, PointForecast],
) -> list[dict]:
    """Risk at the truck every 15 minutes, same source as the checkpoint dots."""
    profile = route.raw.profile
    duration_s = max(0.0, profile.total_s)
    samples: list[dict] = []
    t = 0.0
    while t < duration_s - 1.0:
        coord, distance_m = profile.at_time(t)
        hour = t / 3600.0
        eta = departure + timedelta(seconds=t)
        if scenario is not None:
            sample = scenario.sample(coord[1], coord[0], hour)
        else:
            forecast = _forecast_near(coord, route.checkpoints, forecasts)
            sample = forecast.sample_at(eta.timestamp()) if forecast else WeatherSample()
        result = assess(sample, load_lb, wind_metric)
        samples.append(
            {
                "t": round(hour, 2),
                "mile": round(meters_to_miles(distance_m), 1),
                "lat": round(coord[1], 5),
                "lon": round(coord[0], 5),
                "level": result.level.slug if result.available else "UNKNOWN",
                "score": result.score if result.available else -1,
                "driver": result.driver if result.available else "none",
                "wind": None if sample.wind_mph is None else round(sample.wind_mph, 1),
                "rain": None if sample.rain_in_hr is None else round(sample.rain_in_hr, 3),
                "snow": None if sample.snow_in_hr is None else round(sample.snow_in_hr, 2),
            }
        )
        t += TIMELINE_STEP_S
    coord, distance_m = profile.at_time(duration_s)
    hour = duration_s / 3600.0
    eta = departure + timedelta(seconds=duration_s)
    if scenario is not None:
        sample = scenario.sample(coord[1], coord[0], hour)
    else:
        forecast = _forecast_near(coord, route.checkpoints, forecasts)
        sample = forecast.sample_at(eta.timestamp()) if forecast else WeatherSample()
    result = assess(sample, load_lb, wind_metric)
    samples.append(
        {
            "t": round(hour, 2),
            "mile": round(meters_to_miles(distance_m), 1),
            "lat": round(coord[1], 5),
            "lon": round(coord[0], 5),
            "level": result.level.slug if result.available else "UNKNOWN",
            "score": result.score if result.available else -1,
            "driver": result.driver if result.available else "none",
            "wind": None if sample.wind_mph is None else round(sample.wind_mph, 1),
            "rain": None if sample.rain_in_hr is None else round(sample.rain_in_hr, 3),
            "snow": None if sample.snow_in_hr is None else round(sample.snow_in_hr, 2),
        }
    )
    return samples


# --- scoring ---------------------------------------------------------------


def _aggregate(route: EvaluatedRoute) -> None:
    """Roll checkpoint risk up into per-level mileage and an average score."""
    miles_by_level: dict[RiskLevel, float] = {level: 0.0 for level in RiskLevel}
    weighted_score = 0.0
    scored_miles = 0.0
    unscored_miles = 0.0

    for cp in route.checkpoints:
        segment_miles = meters_to_miles(cp.checkpoint.segment_m)
        if not cp.assessment.available:
            unscored_miles += segment_miles
            continue
        miles_by_level[cp.assessment.level] += segment_miles
        weighted_score += cp.assessment.score * segment_miles
        scored_miles += segment_miles

    route.miles_by_level = miles_by_level
    route.scored_miles = scored_miles
    route.unscored_miles = unscored_miles
    # Distance-weighted so a long stretch of bad weather counts for more than a
    # single rough checkpoint, regardless of how densely we sampled. Unscored
    # miles are excluded so missing weather cannot look like Low risk.
    route.average_risk = weighted_score / scored_miles if scored_miles else 0.0
    scored_levels = [cp.assessment.level for cp in route.checkpoints if cp.assessment.available]
    route.max_level = max(scored_levels, default=RiskLevel.LOW)


def _severe_plus_miles(route: EvaluatedRoute) -> float:
    return route.miles(RiskLevel.NO_TRAVEL) + route.miles(RiskLevel.SEVERE)


def _recommendation_reasons(best: EvaluatedRoute, others: list[EvaluatedRoute]) -> list[str]:
    reasons: list[str] = []
    if best.blocked:
        reasons.append(
            "Every option crosses No Travel conditions - consider delaying departure."
        )

    runner_up = min(others, key=lambda r: r.ranking_key()) if others else None
    elevated_plus = [route for route in others if _severe_plus_miles(route) > 0.5]
    if _severe_plus_miles(best) <= 0.5 and elevated_plus and len(elevated_plus) == len(others):
        reasons.append("Only route with no Severe or No Travel miles.")
    elif _severe_plus_miles(best) <= 0.5 and elevated_plus:
        names = ", ".join(route.label for route in elevated_plus)
        reasons.append(f"Avoids Severe and No Travel conditions on {names}.")
    else:
        blocked_others = [route for route in others if route.miles(RiskLevel.NO_TRAVEL) > 0]
        severe_others = [
            route
            for route in others
            if route.miles(RiskLevel.NO_TRAVEL) <= 0 and route.miles(RiskLevel.SEVERE) > 0.5
        ]
        parts: list[str] = []
        if best.miles(RiskLevel.NO_TRAVEL) == 0 and blocked_others:
            parts.append(f"No Travel on {', '.join(route.label for route in blocked_others)}")
        if severe_others:
            parts.append(f"Severe weather on {', '.join(route.label for route in severe_others)}")
        if parts:
            reasons.append("Avoids " + " and ".join(parts) + ".")
    if runner_up is None:
        if not reasons:
            reasons.append("Only one viable route was found.")
        return reasons

    severe_best = round(best.miles(RiskLevel.SEVERE), 1)
    severe_up = round(runner_up.miles(RiskLevel.SEVERE), 1)
    high_best = round(best.miles(RiskLevel.HIGH), 1)
    high_up = round(runner_up.miles(RiskLevel.HIGH), 1)
    avg_best = round(best.average_risk, 2)
    avg_up = round(runner_up.average_risk, 2)
    hours_delta = (best.raw.duration_s - runner_up.raw.duration_s) / 3600

    if severe_best < severe_up:
        reasons.append(
            f"{severe_up - severe_best:.0f} fewer Severe miles than {runner_up.label} "
            f"({severe_best:.0f} vs {severe_up:.0f})."
        )
    if high_best < high_up:
        reasons.append(
            f"{high_up - high_best:.0f} fewer High-risk miles than {runner_up.label} "
            f"({high_best:.0f} vs {high_up:.0f})."
        )
    if severe_best == severe_up and high_best == high_up:
        if avg_best < avg_up:
            reasons.append(
                f"Tied on Severe and High miles with {runner_up.label}, lower average "
                f"risk ({avg_best:.2f} vs {avg_up:.2f})."
            )
        elif avg_best == avg_up:
            reasons.append(
                "Tied on Severe miles, High miles and avg risk → shortest time wins."
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
    all_coords = [cp.checkpoint.coord for route in routes for cp in route.checkpoints]
    forecasts, weather_fallback = forecasts_for_request(
        client, all_coords, latest_eta, request.demo_scenario
    )
    demo_scenario = request.demo_scenario
    if weather_fallback:
        demo_scenario = "load_wind"

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

    scenario = None
    if demo_scenario == "load_wind":
        scenario = _apply_demo_scenario(routes, request.departure, request.load_lb, wind_metric)

    for route in routes:
        route.weather_path = _weather_path(
            route, request.departure, request.load_lb, wind_metric, scenario, forecasts
        )

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
            "demo_scenario": demo_scenario,
        },
        "provider": {
            "routing": router.name,
            "truck_profile": getattr(router, "supports_truck_profile", False),
            "weather": "demo-fallback" if weather_fallback else client.name,
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
                    "average_risk": round(route.average_risk, 3) if route.scored_miles > 0 else None,
                    "duration_hours": round(route.duration_hours, 2),
                }
                for route in ranked
            ],
        },
    }

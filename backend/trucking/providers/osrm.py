"""Public OSRM demo server - the zero-API-key routing fallback.

OSRM only knows a car profile, so it cannot honour truck weight restrictions.
It does, however, return per-edge duration annotations, which give us exact
travel time at every vertex of the geometry and therefore precise checkpoint
ETAs.
"""

from __future__ import annotations

import logging

from django.conf import settings

from ..geo import Coord, profile_from_edge_durations
from ..http import UpstreamError, request_json
from .base import RawRoute

logger = logging.getLogger(__name__)


class OSRMProvider:
    name = "osrm"
    supports_truck_profile = False

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.OSRM_BASE_URL).rstrip("/")

    def routes(self, waypoints: list[Coord], alternatives: int, load_lb: float) -> list[RawRoute]:
        path = ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in waypoints)
        payload = request_json(
            "GET",
            f"{self.base_url}/route/v1/driving/{path}",
            provider="OSRM",
            params={
                # OSRM caps alternatives internally; ask for a few extra and the
                # planner backfills with via-point detours if it returns fewer.
                "alternatives": str(max(1, alternatives)) if len(waypoints) == 2 else "false",
                "overview": "full",
                "geometries": "geojson",
                "annotations": "duration,distance",
                "steps": "false",
            },
        )

        if payload.get("code") != "Ok" or not payload.get("routes"):
            raise UpstreamError(
                payload.get("message") or "OSRM could not find a route between those points",
                provider="OSRM",
            )

        routes: list[RawRoute] = []
        for raw in payload["routes"]:
            coords = [(float(x), float(y)) for x, y in raw["geometry"]["coordinates"]]
            if len(coords) < 2:
                continue

            # Concatenate per-edge durations across legs (one leg per waypoint pair).
            edge_durations: list[float] = []
            for leg in raw.get("legs", []):
                annotation = leg.get("annotation") or {}
                edge_durations.extend(annotation.get("duration") or [])

            distance_m = float(raw.get("distance") or 0.0)
            duration_s = float(raw.get("duration") or 0.0)

            if len(edge_durations) >= len(coords) - 1:
                profile = profile_from_edge_durations(
                    coords, edge_durations, distance_m, duration_s
                )
            else:
                # No usable annotations: fall back to a constant-speed profile.
                logger.warning("OSRM returned sparse annotations; using uniform speed profile")
                profile = profile_from_edge_durations(
                    coords, [], distance_m, duration_s
                )
                span = len(coords) - 1
                profile.cum_s = [duration_s * i / span for i in range(len(coords))]

            routes.append(
                RawRoute(
                    profile=profile,
                    distance_m=distance_m,
                    duration_s=duration_s,
                    provider=self.name,
                )
            )

        if not routes:
            raise UpstreamError("OSRM returned no usable geometry", provider="OSRM")
        return routes

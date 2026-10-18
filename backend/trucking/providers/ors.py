"""OpenRouteService - preferred router because it has a real truck profile.

The ``driving-hgv`` profile routes around weight-restricted bridges and
truck-prohibited roads, and we pass the actual load through as a restriction so
the geometry reflects the vehicle we are planning for.
"""

from __future__ import annotations

from django.conf import settings

from ..geo import Coord, profile_from_steps
from ..http import UpstreamError, request_json
from .base import RawRoute

# Tractor + empty trailer is roughly 35,000 lb; the form captures freight weight.
TRACTOR_TARE_LB = 35_000.0
LB_PER_METRIC_TON = 2204.62


class OpenRouteServiceProvider:
    name = "openrouteservice"
    supports_truck_profile = True

    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self.api_key = (api_key if api_key is not None else settings.OPENROUTESERVICE_API_KEY) or ""
        self.base_url = (base_url or settings.OPENROUTESERVICE_BASE_URL).rstrip("/")
        if not self.api_key:
            raise UpstreamError(
                "OpenRouteService API key is not configured", provider="OpenRouteService"
            )

    def routes(self, waypoints: list[Coord], alternatives: int, load_lb: float) -> list[RawRoute]:
        gross_tons = (load_lb + TRACTOR_TARE_LB) / LB_PER_METRIC_TON
        body: dict = {
            "coordinates": [[round(lon, 6), round(lat, 6)] for lon, lat in waypoints],
            "instructions": True,
            "units": "m",
            "options": {
                "vehicle_type": "hgv",
                "profile_params": {"restrictions": {"weight": round(gross_tons, 1)}},
            },
        }

        # ORS only offers alternatives for a plain origin/destination pair.
        if alternatives > 1 and len(waypoints) == 2:
            body["alternative_routes"] = {
                "target_count": min(3, alternatives),
                "share_factor": 0.6,   # max fraction of road shared with the main route
                "weight_factor": 1.6,  # allow detours up to 1.6x the optimal weight
            }

        payload = request_json(
            "POST",
            f"{self.base_url}/v2/directions/driving-hgv/geojson",
            provider="OpenRouteService",
            json_body=body,
            headers={"Authorization": self.api_key, "Content-Type": "application/json"},
        )

        features = payload.get("features") or []
        if not features:
            raise UpstreamError(
                "OpenRouteService could not find a truck-legal route between those points",
                provider="OpenRouteService",
            )

        routes: list[RawRoute] = []
        for feature in features:
            geometry = feature.get("geometry") or {}
            coords = [(float(x), float(y)) for x, y in (geometry.get("coordinates") or [])]
            if len(coords) < 2:
                continue

            properties = feature.get("properties") or {}
            summary = properties.get("summary") or {}
            distance_m = float(summary.get("distance") or 0.0)
            duration_s = float(summary.get("duration") or 0.0)

            steps: list[tuple[int, int, float]] = []
            for segment in properties.get("segments") or []:
                for step in segment.get("steps") or []:
                    way_points = step.get("way_points") or []
                    if len(way_points) == 2:
                        steps.append(
                            (int(way_points[0]), int(way_points[1]), float(step.get("duration") or 0.0))
                        )

            profile = profile_from_steps(coords, steps, distance_m, duration_s)
            routes.append(
                RawRoute(
                    profile=profile,
                    distance_m=distance_m,
                    duration_s=duration_s,
                    provider=self.name,
                )
            )

        if not routes:
            raise UpstreamError("OpenRouteService returned no usable geometry", provider="OpenRouteService")
        return routes

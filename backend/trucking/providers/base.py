"""Provider-agnostic types for routing and geocoding."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..geo import Coord, RouteProfile


@dataclass(frozen=True)
class Place:
    """A resolved origin or destination."""

    label: str
    lat: float
    lon: float

    @property
    def coord(self) -> Coord:
        return (self.lon, self.lat)

    def as_dict(self) -> dict:
        return {"label": self.label, "lat": self.lat, "lon": self.lon}


@dataclass
class RawRoute:
    """A single route option, normalised across providers."""

    profile: RouteProfile
    distance_m: float
    duration_s: float
    provider: str
    # How this option was obtained: the provider's own alternative, or a detour
    # we forced through an offset waypoint to get a genuinely different corridor.
    origin_kind: str = "alternative"
    via: Coord | None = None

    @property
    def coords(self) -> list[Coord]:
        return self.profile.coords


class RoutingProvider(Protocol):
    name: str
    supports_truck_profile: bool

    def routes(self, waypoints: list[Coord], alternatives: int, load_lb: float) -> list[RawRoute]:
        """Return one or more routes visiting ``waypoints`` in order."""


class GeocodingProvider(Protocol):
    name: str

    def search(self, query: str, limit: int) -> list[Place]:
        """Resolve free-text input to candidate places."""

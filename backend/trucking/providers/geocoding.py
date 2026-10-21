"""Forward geocoding: free text (or raw coordinates) to a Place."""

from __future__ import annotations

import hashlib
import re

from django.conf import settings
from django.core.cache import cache

from ..http import UpstreamError, request_json
from .base import Place

# Accepts "41.8781, -87.6298" so users can paste coordinates directly.
_COORD_RE = re.compile(
    r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,/ ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$"
)


def parse_coordinates(query: str) -> Place | None:
    """Interpret ``lat, lon`` text as a Place without hitting a geocoder."""
    match = _COORD_RE.match(query or "")
    if not match:
        return None
    lat, lon = float(match.group(1)), float(match.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return Place(label=f"{lat:.4f}, {lon:.4f}", lat=lat, lon=lon)


class NominatimGeocoder:
    """OpenStreetMap's geocoder: no key required, but rate limited to ~1 req/s."""

    name = "nominatim"

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.NOMINATIM_BASE_URL).rstrip("/")

    def search(self, query: str, limit: int = 5) -> list[Place]:
        payload = request_json(
            "GET",
            f"{self.base_url}/search",
            provider="Nominatim",
            params={
                "q": query,
                "format": "jsonv2",
                "limit": str(limit),
                "addressdetails": "0",
            },
        )
        places = []
        for item in payload or []:
            try:
                places.append(
                    Place(
                        label=item["display_name"],
                        lat=float(item["lat"]),
                        lon=float(item["lon"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        return places


class PhotonGeocoder:
    """Komoot's hosted Photon: keyless OSM search built for type-ahead.

    Nominatim's policy forbids autocomplete and throttles shared cloud IPs such
    as Render's, so Photon is the keyless default and Nominatim the fallback.
    """

    name = "photon"

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.PHOTON_BASE_URL).rstrip("/")

    def search(self, query: str, limit: int = 5) -> list[Place]:
        payload = request_json(
            "GET",
            f"{self.base_url}/api/",
            provider="Photon",
            params={"q": query, "limit": str(limit), "lang": "en"},
        )
        places = []
        for feature in (payload or {}).get("features") or []:
            coords = (feature.get("geometry") or {}).get("coordinates") or []
            if len(coords) != 2:
                continue
            places.append(
                Place(
                    label=_photon_label(feature.get("properties") or {}, query),
                    lat=float(coords[1]),
                    lon=float(coords[0]),
                )
            )
        return places


def _photon_label(properties: dict, query: str) -> str:
    """Build "Name, City, State, Country" without repeating a part."""
    street = " ".join(
        str(part) for part in (properties.get("housenumber"), properties.get("street")) if part
    )
    parts: list[str] = []
    for part in (
        properties.get("name") or street,
        properties.get("city"),
        properties.get("county"),
        properties.get("state"),
        properties.get("country"),
    ):
        if part and part not in parts:
            parts.append(str(part))
    return ", ".join(parts) or query


class PeliasGeocoder:
    """OpenRouteService's hosted Pelias - better autocomplete, needs the key."""

    name = "openrouteservice"

    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self.api_key = (api_key if api_key is not None else settings.OPENROUTESERVICE_API_KEY) or ""
        self.base_url = (base_url or settings.OPENROUTESERVICE_BASE_URL).rstrip("/")
        if not self.api_key:
            raise UpstreamError("OpenRouteService API key is not configured", provider="Pelias")

    def search(self, query: str, limit: int = 5) -> list[Place]:
        payload = request_json(
            "GET",
            f"{self.base_url}/geocode/search",
            provider="OpenRouteService geocoding",
            params={"api_key": self.api_key, "text": query, "size": str(limit)},
        )
        places = []
        for feature in (payload or {}).get("features") or []:
            geometry = feature.get("geometry") or {}
            coords = geometry.get("coordinates") or []
            properties = feature.get("properties") or {}
            if len(coords) != 2:
                continue
            places.append(
                Place(
                    label=properties.get("label") or properties.get("name") or query,
                    lat=float(coords[1]),
                    lon=float(coords[0]),
                )
            )
        return places


class ChainedGeocoder:
    """Try each geocoder in order so a key outage degrades instead of failing."""

    def __init__(self, geocoders: list) -> None:
        self.geocoders = geocoders
        self.name = "+".join(g.name for g in geocoders)

    def search(self, query: str, limit: int = 5) -> list[Place]:
        direct = parse_coordinates(query)
        if direct:
            return [direct]

        # Autocomplete repeats the same prefixes, so cache hits spare the
        # rate-limited upstreams.
        normalized = " ".join(query.lower().split())
        digest = hashlib.sha1(normalized.encode()).hexdigest()
        cache_key = f"geo:{self.name}:{limit}:{digest}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        last_error: UpstreamError | None = None
        for geocoder in self.geocoders:
            try:
                results = geocoder.search(query, limit)
            except UpstreamError as exc:
                last_error = exc
                continue
            if results:
                cache.set(cache_key, results, settings.GEOCODE_CACHE_SECONDS)
                return results
        if last_error:
            raise last_error
        return []

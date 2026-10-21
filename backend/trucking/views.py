"""HTTP endpoints for geocoding, trip planning and the corridor heatmap."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .corridor import CorridorRequest, DemoStormPoint, build_heatmap
from .http import UpstreamError
from .planner import TripRequest, plan_trip
from .providers.base import Place
from .providers.registry import get_geocoder, get_router
from .risk import describe_rules
from .serializers import (
    CorridorRequestSerializer,
    GeocodeQuerySerializer,
    PlanRequestSerializer,
    WeatherMapRequestSerializer,
    WeatherPointQuerySerializer,
)
from .weather.open_meteo import OpenMeteoClient
from .weather_map import WeatherMapRequest, build_weather_map, inspect_point

logger = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    """Turn upstream provider failures into a 502 the UI can display."""
    if isinstance(exc, UpstreamError):
        logger.warning("Upstream failure from %s: %s", exc.provider or "?", exc)
        detail = str(exc)
        rate_limited = exc.status == 429 or (
            "limit" in detail.lower() and "exceeded" in detail.lower()
        )
        if rate_limited and exc.provider == "Open-Meteo":
            detail = (
                "Open-Meteo daily limit exceeded. Check Demo weather and Analyze — "
                "local storms will run until the quota resets."
            )
        elif rate_limited:
            detail = f"{exc.provider or 'An upstream service'} is rate-limiting requests. Try again shortly."
        return Response(
            {"detail": detail, "provider": exc.provider},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return exception_handler(exc, context)


def _weather_client(data: dict) -> OpenMeteoClient:
    """Open-Meteo client seeded with any series the browser fetched itself."""
    prefetch = data.get("open_meteo")
    if not prefetch:
        return OpenMeteoClient()
    return OpenMeteoClient(
        prefetched=OpenMeteoClient.parse_prefetched(prefetch["points"], prefetch["entries"])
    )


def _with_weather_request(payload: dict, client: OpenMeteoClient, demo_scenario: str) -> dict:
    """Tell the browser which Open-Meteo series to fetch when the server could not."""
    payload["weather_request"] = None if demo_scenario else client.browser_request()
    return payload


def _resolve(location: dict, geocoder, field: str) -> Place:
    """Turn a validated location block into a concrete Place."""
    if location.get("lat") is not None and location.get("lon") is not None:
        return Place(
            label=location.get("label") or location.get("query") or
            f"{location['lat']:.4f}, {location['lon']:.4f}",
            lat=location["lat"],
            lon=location["lon"],
        )

    query = (location.get("query") or "").strip()
    matches = geocoder.search(query, limit=1)
    if not matches:
        raise UpstreamError(f"Could not find a location matching '{query}' for {field}")
    return matches[0]


@api_view(["GET"])
def health(request):
    router = get_router()
    return Response(
        {
            "status": "ok",
            "routing_provider": router.name,
            "truck_profile": getattr(router, "supports_truck_profile", False),
        }
    )


@api_view(["GET"])
def rules(request):
    """The risk table and load rules, so the UI legend cannot drift from the engine."""
    return Response(describe_rules())


@api_view(["GET"])
def geocode(request):
    query = GeocodeQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    data = query.validated_data

    matches = get_geocoder().search(data["q"], limit=data["limit"])
    return Response({"results": [place.as_dict() for place in matches]})


@api_view(["POST"])
def plan(request):
    serializer = PlanRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    geocoder = get_geocoder()
    origin = _resolve(data["origin"], geocoder, "origin")
    destination = _resolve(data["destination"], geocoder, "destination")
    if abs(origin.lat - destination.lat) < 1e-4 and abs(origin.lon - destination.lon) < 1e-4:
        raise ValidationError("Origin and destination must be different locations.")
    trip = TripRequest(
        origin=origin,
        destination=destination,
        departure=data["departure"],
        load_lb=data["load_lb"],
        interval_miles=float(data["interval_miles"]),
        demo_scenario=data.get("demo_scenario") or "",
    )
    client = _weather_client(data)
    return Response(
        _with_weather_request(plan_trip(trip, weather_client=client), client, trip.demo_scenario)
    )


@api_view(["POST"])
def corridor(request):
    serializer = CorridorRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    client = _weather_client(data)
    heatmap = build_heatmap(
        CorridorRequest(
            seeds=data["seeds"],
            load_lb=data["load_lb"],
            anchor=data.get("anchor") or datetime.now(timezone.utc),
            hours=data["hours"],
            demo_scenario=data.get("demo_scenario") or "",
            demo_storm=tuple(
                DemoStormPoint(
                    lon=cell["lon"],
                    lat=cell["lat"],
                    wind_mph=cell["wind_mph"],
                    wind_dir_deg=cell.get("wind_dir_deg"),
                )
                for cell in data.get("demo_storm") or ()
            ),
            route_lines=tuple(tuple(line) for line in data.get("route_lines") or ()),
        ),
        weather_client=client,
    )
    return Response(_with_weather_request(heatmap, client, data.get("demo_scenario") or ""))


@api_view(["POST"])
def weather_map(request):
    """Regional forecast grid for the dedicated weather map (independent of a route)."""
    serializer = WeatherMapRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    payload = build_weather_map(
        WeatherMapRequest(
            west=data["west"],
            south=data["south"],
            east=data["east"],
            north=data["north"],
            load_lb=data["load_lb"],
            hours=data["hours"],
            anchor=data.get("anchor") or datetime.now(timezone.utc),
        )
    )
    return Response(payload)


@api_view(["GET"])
def weather_point(request):
    """Hourly forecast at one clicked or searched coordinate."""
    query = WeatherPointQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    data = query.validated_data
    return Response(
        inspect_point(
            lon=data["lon"],
            lat=data["lat"],
            hours=data["hours"],
            load_lb=data["load_lb"],
        )
    )

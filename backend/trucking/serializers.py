"""Request validation for the planning API."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from rest_framework import serializers

SAMPLING_INTERVALS_MILES = (10, 25, 50)
MAX_LOAD_LB = 200_000
# Forecast skill falls off quickly; refuse departures we cannot forecast for.
MAX_DEPARTURE_DAYS_AHEAD = 14
MAX_DEPARTURE_HOURS_BEHIND = 12
# A heatmap needs roughly 300 points; leave headroom for long trips.
MAX_PREFETCH_POINTS = 1000


class LocationSerializer(serializers.Serializer):
    """Either free text to geocode, or explicit coordinates."""

    query = serializers.CharField(required=False, allow_blank=True, max_length=250)
    label = serializers.CharField(required=False, allow_blank=True, max_length=250)
    lat = serializers.FloatField(required=False, min_value=-90, max_value=90)
    lon = serializers.FloatField(required=False, min_value=-180, max_value=180)

    def validate(self, attrs: dict) -> dict:
        has_coords = attrs.get("lat") is not None and attrs.get("lon") is not None
        has_query = bool((attrs.get("query") or "").strip())
        if not has_coords and not has_query:
            raise serializers.ValidationError(
                "Provide either a search string or both lat and lon."
            )
        return attrs

    def to_internal_value(self, data):
        # Allow the shorthand {"origin": "Chicago, IL"}.
        if isinstance(data, str):
            data = {"query": data}
        return super().to_internal_value(data)


class CoordinateField(serializers.ListField):
    child = serializers.FloatField()

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if len(value) != 2:
            raise serializers.ValidationError("Expected [longitude, latitude].")
        lon, lat = value
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise serializers.ValidationError("Coordinate out of range.")
        return (lon, lat)


class OpenMeteoPrefetchSerializer(serializers.Serializer):
    """Open-Meteo series the browser fetched with its own quota.

    Sent back when a response carried ``weather_request`` because the server's
    shared IP was rate-limited. ``entries[i]`` is Open-Meteo's response for
    ``points[i]``; only its ``hourly`` block is used.
    """

    points = serializers.ListField(child=CoordinateField(), max_length=MAX_PREFETCH_POINTS)
    entries = serializers.ListField(child=serializers.DictField(), max_length=MAX_PREFETCH_POINTS)

    def validate(self, attrs: dict) -> dict:
        if len(attrs["points"]) != len(attrs["entries"]):
            raise serializers.ValidationError("Expected one forecast entry per point.")
        return attrs


class PlanRequestSerializer(serializers.Serializer):
    open_meteo = OpenMeteoPrefetchSerializer(required=False)
    origin = LocationSerializer()
    destination = LocationSerializer()
    departure = serializers.DateTimeField()
    load_lb = serializers.FloatField(min_value=0, max_value=MAX_LOAD_LB)
    interval_miles = serializers.ChoiceField(
        choices=SAMPLING_INTERVALS_MILES, default=25
    )
    demo_scenario = serializers.ChoiceField(
        choices=("", "load_wind"),
        required=False,
        default="",
    )

    def validate_departure(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if value < now - timedelta(hours=MAX_DEPARTURE_HOURS_BEHIND):
            raise serializers.ValidationError(
                "Departure is too far in the past for a forecast to be available."
            )
        if value > now + timedelta(days=MAX_DEPARTURE_DAYS_AHEAD):
            raise serializers.ValidationError(
                f"Departure must be within {MAX_DEPARTURE_DAYS_AHEAD} days; "
                "forecasts are not reliable beyond that."
            )
        return value

    def validate(self, attrs: dict) -> dict:
        origin, destination = attrs["origin"], attrs["destination"]
        same_coords = (
            origin.get("lat") is not None
            and origin.get("lat") == destination.get("lat")
            and origin.get("lon") == destination.get("lon")
        )
        if same_coords:
            raise serializers.ValidationError(
                "Origin and destination must be different locations."
            )
        return attrs


class DemoStormPointSerializer(serializers.Serializer):
    lon = serializers.FloatField(min_value=-180, max_value=180)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    wind_mph = serializers.FloatField(min_value=0, max_value=200)
    wind_dir_deg = serializers.FloatField(required=False, allow_null=True, min_value=0, max_value=360)


class CorridorRequestSerializer(serializers.Serializer):
    open_meteo = OpenMeteoPrefetchSerializer(required=False)
    seeds = serializers.ListField(child=CoordinateField(), min_length=2, max_length=400)
    load_lb = serializers.FloatField(min_value=0, max_value=MAX_LOAD_LB)
    anchor = serializers.DateTimeField(required=False)
    hours = serializers.IntegerField(required=False, min_value=1, max_value=72, default=48)
    demo_scenario = serializers.ChoiceField(
        choices=("", "load_wind"),
        required=False,
        default="",
    )
    demo_storm = serializers.ListField(
        child=DemoStormPointSerializer(),
        required=False,
        default=list,
        max_length=80,
    )
    route_lines = serializers.ListField(
        child=serializers.ListField(child=CoordinateField(), min_length=2, max_length=4000),
        required=False,
        default=list,
        max_length=6,
    )

    def validate_anchor(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=250)
    limit = serializers.IntegerField(required=False, min_value=1, max_value=10, default=5)


class WeatherMapRequestSerializer(serializers.Serializer):
    west = serializers.FloatField(min_value=-180, max_value=180)
    south = serializers.FloatField(min_value=-90, max_value=90)
    east = serializers.FloatField(min_value=-180, max_value=180)
    north = serializers.FloatField(min_value=-90, max_value=90)
    load_lb = serializers.FloatField(required=False, min_value=0, max_value=MAX_LOAD_LB, default=42_000)
    hours = serializers.IntegerField(required=False, min_value=1, max_value=72, default=48)
    anchor = serializers.DateTimeField(required=False)

    def validate_anchor(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class WeatherPointQuerySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    load_lb = serializers.FloatField(required=False, min_value=0, max_value=MAX_LOAD_LB, default=42_000)
    hours = serializers.IntegerField(required=False, min_value=1, max_value=72, default=48)

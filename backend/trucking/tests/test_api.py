"""Endpoint contract and validation tests (no network access)."""

from datetime import datetime, timedelta, timezone
from unittest import mock

from django.test import SimpleTestCase

from trucking.http import UpstreamError
from trucking.providers.base import Place
from trucking.providers.geocoding import parse_coordinates


def iso_in(hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def valid_payload(**overrides) -> dict:
    payload = {
        "origin": {"lat": 41.8781, "lon": -87.6298, "label": "Chicago, IL"},
        "destination": {"lat": 39.9526, "lon": -75.1652, "label": "Philadelphia, PA"},
        "departure": iso_in(3),
        "load_lb": 42000,
        "interval_miles": 25,
    }
    payload.update(overrides)
    return payload


class MetaEndpointTests(SimpleTestCase):
    def test_health_reports_the_active_router(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertIn("routing_provider", response.json())

    def test_spa_fallback_does_not_swallow_api_routes(self):
        # A catch-all serves the Vite app, but /api/* must stay JSON.
        response = self.client.get("/api/health/")
        self.assertEqual(response["Content-Type"].split(";")[0], "application/json")

    def test_rules_endpoint_exposes_the_full_table(self):
        response = self.client.get("/api/rules/")
        self.assertEqual(response.status_code, 200)

        body = response.json()
        self.assertEqual(len(body["levels"]), 5)
        self.assertEqual(len(body["load_rules"]), 3)
        for metric, unit in (("wind", "mph"), ("rain", "in/hr"), ("snow", "in/hr")):
            with self.subTest(metric=metric):
                self.assertEqual(len(body[metric]), 5)
                self.assertEqual(body[metric][0]["unit"], unit)


class PlanValidationTests(SimpleTestCase):
    def post(self, payload):
        return self.client.post("/api/plan/", payload, content_type="application/json")

    def test_missing_fields_are_rejected(self):
        response = self.post({"origin": "Chicago, IL"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("destination", response.json())

    def test_departure_too_far_ahead_is_rejected(self):
        response = self.post(valid_payload(departure=iso_in(24 * 30)))
        self.assertEqual(response.status_code, 400)
        self.assertIn("departure", response.json())

    def test_departure_far_in_the_past_is_rejected(self):
        response = self.post(valid_payload(departure=iso_in(-48)))
        self.assertEqual(response.status_code, 400)

    def test_interval_must_be_one_of_the_supported_values(self):
        response = self.post(valid_payload(interval_miles=37))
        self.assertEqual(response.status_code, 400)
        self.assertIn("interval_miles", response.json())

    def test_negative_load_is_rejected(self):
        self.assertEqual(self.post(valid_payload(load_lb=-1)).status_code, 400)

    def test_identical_origin_and_destination_is_rejected(self):
        same = {"lat": 41.8781, "lon": -87.6298}
        response = self.post(valid_payload(origin=same, destination=same))
        self.assertEqual(response.status_code, 400)

    def test_upstream_failure_becomes_a_502(self):
        with mock.patch(
            "trucking.views.plan_trip", side_effect=UpstreamError("router down", provider="OSRM")
        ):
            response = self.post(valid_payload())
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["provider"], "OSRM")

    def test_coordinates_skip_the_geocoder(self):
        with mock.patch("trucking.views.plan_trip", return_value={"routes": []}) as planner:
            with mock.patch("trucking.views.get_geocoder") as geocoder:
                response = self.post(valid_payload())

        self.assertEqual(response.status_code, 200)
        geocoder.return_value.search.assert_not_called()
        trip = planner.call_args.args[0]
        self.assertEqual(trip.origin.label, "Chicago, IL")
        self.assertEqual(trip.load_lb, 42000)

    def test_string_locations_are_geocoded(self):
        with mock.patch("trucking.views.plan_trip", return_value={"routes": []}) as planner:
            with mock.patch("trucking.views.get_geocoder") as geocoder:
                geocoder.return_value.search.side_effect = [
                    [Place(label="Chicago, IL", lat=41.88, lon=-87.63)],
                    [Place(label="Denver, CO", lat=39.74, lon=-104.99)],
                ]
                response = self.post(
                    valid_payload(origin="Chicago, IL", destination="Denver, CO")
                )

        self.assertEqual(response.status_code, 200)
        trip = planner.call_args.args[0]
        self.assertEqual(trip.destination.label, "Denver, CO")
        self.assertAlmostEqual(trip.destination.lat, 39.74)

    def test_unresolvable_location_returns_502_with_context(self):
        with mock.patch("trucking.views.get_geocoder") as geocoder:
            geocoder.return_value.search.return_value = []
            response = self.post(valid_payload(origin="asdkjhasd"))

        self.assertEqual(response.status_code, 502)
        self.assertIn("origin", response.json()["detail"])

    def test_geocoded_origin_matching_destination_is_rejected(self):
        same = Place(label="Chicago, IL", lat=41.88, lon=-87.63)
        with mock.patch("trucking.views.get_geocoder") as geocoder:
            geocoder.return_value.search.return_value = [same]
            response = self.post(valid_payload(origin="Chicago", destination="CHI"))

        self.assertEqual(response.status_code, 400)


class GeocodeEndpointTests(SimpleTestCase):
    def test_short_queries_are_rejected(self):
        self.assertEqual(self.client.get("/api/geocode/?q=a").status_code, 400)

    def test_results_are_returned(self):
        with mock.patch("trucking.views.get_geocoder") as geocoder:
            geocoder.return_value.search.return_value = [
                Place(label="Chicago, IL", lat=41.88, lon=-87.63)
            ]
            response = self.client.get("/api/geocode/?q=Chicago")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["label"], "Chicago, IL")

    def test_raw_coordinates_are_parsed_without_a_lookup(self):
        place = parse_coordinates("41.8781, -87.6298")
        self.assertIsNotNone(place)
        self.assertAlmostEqual(place.lat, 41.8781)
        self.assertAlmostEqual(place.lon, -87.6298)

    def test_out_of_range_coordinates_are_not_accepted(self):
        self.assertIsNone(parse_coordinates("200, 300"))
        self.assertIsNone(parse_coordinates("Chicago"))


class CorridorValidationTests(SimpleTestCase):
    def post(self, payload):
        return self.client.post("/api/corridor/", payload, content_type="application/json")

    def test_requires_at_least_two_seeds(self):
        response = self.post({"seeds": [[-87.6, 41.9]], "load_lb": 40000})
        self.assertEqual(response.status_code, 400)

    def test_rejects_malformed_coordinates(self):
        response = self.post({"seeds": [[-87.6], [-75.2, 39.9]], "load_lb": 40000})
        self.assertEqual(response.status_code, 400)

    def test_rejects_out_of_range_coordinates(self):
        response = self.post({"seeds": [[-987.6, 41.9], [-75.2, 39.9]], "load_lb": 40000})
        self.assertEqual(response.status_code, 400)

    def test_hours_are_capped(self):
        response = self.post(
            {"seeds": [[-87.6, 41.9], [-75.2, 39.9]], "load_lb": 40000, "hours": 500}
        )
        self.assertEqual(response.status_code, 400)


class WeatherMapEndpointTests(SimpleTestCase):
    def test_bbox_is_required(self):
        response = self.client.post("/api/weather-map/", {"load_lb": 42000}, content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_point_requires_coordinates(self):
        response = self.client.get("/api/weather/point/")
        self.assertEqual(response.status_code, 400)

    def test_point_rejects_out_of_range(self):
        response = self.client.get("/api/weather/point/?lat=200&lon=-87")
        self.assertEqual(response.status_code, 400)

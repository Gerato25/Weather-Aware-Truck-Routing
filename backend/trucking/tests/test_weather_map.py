from datetime import datetime, timezone
from unittest import mock

from django.test import SimpleTestCase

from trucking.tests.fakes import FakeWeather
from trucking.weather_map import (
    MAX_GRID_POINTS,
    WeatherMapRequest,
    build_weather_map,
    grid_points,
    inspect_point,
)


def calm(_lon, _lat):
    return {"wind": 8.0, "gust": 10.0, "rain": 0.0, "snow": 0.0}


class GridTests(SimpleTestCase):
    def test_grid_stays_under_the_cap(self):
        points = grid_points(-125, 24, -66, 50)
        self.assertGreater(len(points), 8)
        self.assertLessEqual(len(points), MAX_GRID_POINTS)

    def test_tiny_bbox_still_returns_points(self):
        points = grid_points(-87.7, 41.8, -87.6, 41.9)
        self.assertGreaterEqual(len(points), 1)


class WeatherMapBuildTests(SimpleTestCase):
    def test_heatmap_has_matching_series(self):
        payload = build_weather_map(
            WeatherMapRequest(
                west=-90,
                south=38,
                east=-86,
                north=42,
                load_lb=42000,
                hours=6,
                anchor=datetime(2026, 10, 18, 12, tzinfo=timezone.utc),
            ),
            weather_client=FakeWeather(calm),
        )
        self.assertEqual(len(payload["hours"]), 7)
        self.assertEqual(len(payload["points"]), len(payload["risk"]))
        self.assertEqual(len(payload["risk"][0]), 7)
        self.assertIn("temperature", payload)

    def test_inspect_returns_hourly_current(self):
        body = inspect_point(
            lon=-87.63,
            lat=41.88,
            hours=4,
            load_lb=42000,
            weather_client=FakeWeather(calm),
        )
        self.assertEqual(body["lat"], 41.88)
        self.assertEqual(len(body["series"]), 5)
        self.assertIsNotNone(body["current"])
        self.assertIn("wind_mph", body["current"])
        self.assertEqual(body["current"]["risk"], 0)


class WeatherMapViewTests(SimpleTestCase):
    def test_map_endpoint_uses_the_weather_client(self):
        fake = FakeWeather(calm)
        with mock.patch("trucking.views.build_weather_map") as builder:
            builder.return_value = {"points": [], "hours": [], "risk": []}
            response = self.client.post(
                "/api/weather-map/",
                {"west": -90, "south": 38, "east": -86, "north": 42, "hours": 6},
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        builder.assert_called_once()
        self.assertIsNotNone(fake)

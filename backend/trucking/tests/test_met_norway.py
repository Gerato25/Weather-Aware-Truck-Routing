"""MET Norway fallback: parsing, cell sharing, and Open-Meteo hand-off (no network)."""

from datetime import datetime, timezone
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase

from trucking.http import UpstreamError
from trucking.weather.met_norway import MetNorwayClient
from trucking.weather.open_meteo import OpenMeteoClient, forecasts_for_request, snap

DAILY_LIMIT = UpstreamError(
    "Open-Meteo returned 429: Daily API request limit exceeded. Please try again tomorrow.",
    provider="Open-Meteo",
    status=429,
)


def _step(time: str, *, wind=10.0, gust=None, precip=0.0, symbol="cloudy", temp=10.0, block="next_1_hours"):
    details = {"air_temperature": temp, "wind_speed": wind, "wind_from_direction": 200.0}
    if gust is not None:
        details["wind_speed_of_gust"] = gust
    return {
        "time": time,
        "data": {
            "instant": {"details": details},
            block: {"summary": {"symbol_code": symbol}, "details": {"precipitation_amount": precip}},
        },
    }


def _payload(*steps) -> dict:
    return {"properties": {"timeseries": list(steps)}}


class MetNorwayParseTests(SimpleTestCase):
    def test_units_are_converted_to_the_risk_table(self):
        forecast = MetNorwayClient._parse(
            (-118.2, 34.1),
            _payload(_step("2026-10-21T18:00:00Z", wind=10.0, gust=20.0, precip=25.4, symbol="heavyrain")),
        )
        sample = forecast.sample_at(forecast.times[0])
        self.assertAlmostEqual(sample.wind_mph, 22.4, places=1)
        self.assertAlmostEqual(sample.wind_gust_mph, 44.7, places=1)
        self.assertAlmostEqual(sample.rain_in_hr, 1.0, places=3)
        self.assertEqual(sample.snow_in_hr, 0.0)
        self.assertEqual(sample.weather_code, 65)

    def test_snow_symbol_turns_precipitation_into_snowfall(self):
        forecast = MetNorwayClient._parse(
            (-105.0, 39.7), _payload(_step("2026-10-21T18:00:00Z", precip=10.0, symbol="snow", temp=-3.0))
        )
        sample = forecast.sample_at(forecast.times[0])
        self.assertEqual(sample.rain_in_hr, 0.0)
        self.assertAlmostEqual(sample.snow_in_hr, 10.0 * 0.7 / 2.54, places=3)

    def test_six_hour_tail_is_spread_per_hour(self):
        forecast = MetNorwayClient._parse(
            (-118.2, 34.1),
            _payload(_step("2026-10-24T06:00:00Z", precip=6 * 25.4, symbol="rain", block="next_6_hours")),
        )
        self.assertAlmostEqual(forecast.rain[0], 1.0, places=3)

    def test_empty_series_is_an_upstream_error(self):
        with self.assertRaises(UpstreamError):
            MetNorwayClient._parse((-118.2, 34.1), _payload())


class MetNorwayFetchTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_nearby_points_share_one_request(self):
        payload = _payload(_step("2026-10-21T18:00:00Z"))
        with mock.patch("trucking.weather.met_norway.request_json", return_value=payload) as request:
            result = MetNorwayClient().forecasts([(-118.24, 34.02), (-118.22, 34.03)])
        self.assertEqual(request.call_count, 1)
        self.assertIn(snap((-118.24, 34.02)), result)
        self.assertIn(snap((-118.22, 34.03)), result)

    def test_all_cells_failing_raises(self):
        boom = UpstreamError("forbidden", provider="MET Norway", status=403)
        with mock.patch("trucking.weather.met_norway.request_json", side_effect=boom):
            with self.assertRaises(UpstreamError):
                MetNorwayClient().forecasts([(-118.24, 34.05)])


class OpenMeteoFallbackTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_daily_limit_hands_off_to_met_norway(self):
        payload = _payload(_step("2026-10-21T18:00:00Z", wind=20.0))
        client = OpenMeteoClient()
        with mock.patch("trucking.weather.open_meteo.request_json", side_effect=DAILY_LIMIT):
            with mock.patch("trucking.weather.met_norway.request_json", return_value=payload):
                result, placeholder = forecasts_for_request(
                    client, [(-118.24, 34.05)], latest=datetime.now(timezone.utc)
                )
        self.assertFalse(placeholder)
        self.assertEqual(client.source, "met-norway")
        self.assertAlmostEqual(next(iter(result.values())).wind[0], 44.7, places=1)

    def test_open_meteo_is_skipped_after_a_429(self):
        payload = _payload(_step("2026-10-21T18:00:00Z"))
        with mock.patch("trucking.weather.met_norway.request_json", return_value=payload):
            with mock.patch(
                "trucking.weather.open_meteo.request_json", side_effect=DAILY_LIMIT
            ) as open_meteo:
                OpenMeteoClient().forecasts([(-118.24, 34.05)], 2)
                OpenMeteoClient().forecasts([(-100.0, 40.0)], 2)
        self.assertEqual(open_meteo.call_count, 1)

    def test_both_providers_down_falls_back_to_placeholder(self):
        boom = UpstreamError("forbidden", provider="MET Norway", status=403)
        with mock.patch("trucking.weather.open_meteo.request_json", side_effect=DAILY_LIMIT):
            with mock.patch("trucking.weather.met_norway.request_json", side_effect=boom):
                _, placeholder = forecasts_for_request(
                    OpenMeteoClient(), [(-118.24, 34.05)], latest=datetime.now(timezone.utc)
                )
        self.assertTrue(placeholder)

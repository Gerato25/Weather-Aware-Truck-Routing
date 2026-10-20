"""Open-Meteo client retries 429s instead of failing the plan immediately."""

from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase

from trucking.http import UpstreamError
from trucking.weather.open_meteo import OpenMeteoClient


def _series(count: int = 4) -> dict:
    return {
        "hourly": {
            "time": [1_700_000_000 + 3600 * i for i in range(count)],
            "wind_speed_10m": [10.0] * count,
            "wind_gusts_10m": [12.0] * count,
            "rain": [0.0] * count,
            "showers": [0.0] * count,
            "snowfall": [0.0] * count,
            "temperature_2m": [40.0] * count,
            "visibility": [16000.0] * count,
            "weather_code": [0] * count,
        }
    }


class OpenMeteoRetryTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_retries_429_then_succeeds(self):
        client = OpenMeteoClient()
        busy = UpstreamError("too many", provider="Open-Meteo", status=429, retry_after=0.01)
        with mock.patch(
            "trucking.weather.open_meteo.request_json",
            side_effect=[busy, busy, _series()],
        ) as request:
            with mock.patch("trucking.weather.open_meteo.time.sleep"):
                result = client.forecasts([(-87.63, 41.88)], forecast_days=2)

        self.assertEqual(request.call_count, 3)
        self.assertEqual(len(result), 1)

    def test_gives_up_after_repeated_429s(self):
        client = OpenMeteoClient()
        busy = UpstreamError("too many", provider="Open-Meteo", status=429)
        with mock.patch(
            "trucking.weather.open_meteo.request_json",
            side_effect=[busy] * 8,
        ):
            with mock.patch("trucking.weather.open_meteo.time.sleep"):
                with self.assertRaises(UpstreamError) as raised:
                    client.forecasts([(-87.63, 41.88)], forecast_days=2)
        self.assertEqual(raised.exception.status, 429)

    def test_non_429_errors_are_not_retried(self):
        client = OpenMeteoClient()
        boom = UpstreamError("down", provider="Open-Meteo", status=502)
        with mock.patch(
            "trucking.weather.open_meteo.request_json",
            side_effect=boom,
        ) as request:
            with self.assertRaises(UpstreamError):
                client.forecasts([(-87.63, 41.88)], forecast_days=2)
        self.assertEqual(request.call_count, 1)


class OpenMeteoParseTests(SimpleTestCase):
    def test_null_hourly_values_stay_missing_instead_of_becoming_zero(self):
        forecast = OpenMeteoClient._parse(
            (-87.63, 41.88),
            {
                "hourly": {
                    "time": [1_700_000_000, 1_700_003_600],
                    "wind_speed_10m": [None, None],
                    "wind_gusts_10m": [None, None],
                    "rain": [None, None],
                    "showers": [None, None],
                    "snowfall": [None, None],
                    "temperature_2m": [None, None],
                    "visibility": [None, None],
                    "weather_code": [None, None],
                }
            },
        )
        sample = forecast.sample_at(1_700_000_000)
        self.assertFalse(sample.has_observation())
        self.assertIsNone(sample.wind_mph)
        self.assertIsNone(sample.rain_in_hr)

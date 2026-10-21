"""Open-Meteo client retries 429s instead of failing the plan immediately."""

from datetime import datetime, timezone
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase

from trucking.http import UpstreamError
from trucking.weather.open_meteo import OpenMeteoClient, PointForecast, calm_forecasts, forecasts_for_request


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

    def test_daily_limit_429_is_not_retried(self):
        client = OpenMeteoClient()
        busy = UpstreamError(
            "Open-Meteo returned 429: Daily API request limit exceeded. Please try again tomorrow.",
            provider="Open-Meteo",
            status=429,
        )
        with mock.patch(
            "trucking.weather.open_meteo.request_json",
            side_effect=busy,
        ) as request:
            with self.assertRaises(UpstreamError) as raised:
                client.forecasts([(-87.63, 41.88)], forecast_days=2)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(raised.exception.status, 429)

    def test_demo_mode_does_not_call_open_meteo(self):
        client = OpenMeteoClient()
        with mock.patch("trucking.weather.open_meteo.request_json") as request:
            result, fallback = forecasts_for_request(
                client,
                [(-87.63, 41.88)],
                latest=datetime.now(timezone.utc),
                demo_scenario="load_wind",
            )
        request.assert_not_called()
        self.assertFalse(fallback)
        sample = next(iter(result.values())).sample_at(datetime.now(timezone.utc).timestamp())
        self.assertAlmostEqual(sample.wind_mph, 8.0, places=1)
        self.assertTrue(calm_forecasts([(-87.63, 41.88)]))

    def test_daily_limit_falls_back_to_local_weather(self):
        client = OpenMeteoClient()
        busy = UpstreamError(
            "Open-Meteo returned 429: Daily API request limit exceeded. Please try again tomorrow.",
            provider="Open-Meteo",
            status=429,
        )
        with mock.patch("trucking.weather.open_meteo.request_json", side_effect=busy):
            result, fallback = forecasts_for_request(
                client,
                [(-87.63, 41.88)],
                latest=datetime.now(timezone.utc),
            )
        self.assertTrue(fallback)
        sample = next(iter(result.values())).sample_at(datetime.now(timezone.utc).timestamp())
        self.assertAlmostEqual(sample.wind_mph, 8.0, places=1)

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

    def test_sample_at_interpolates_between_hourly_steps(self):
        forecast = PointForecast(
            lon=-87.63,
            lat=41.88,
            times=[1_700_000_000, 1_700_003_600],
            wind=[10.0, 20.0],
            gust=[12.0, 22.0],
            wind_dir=[350.0, 10.0],
            rain=[0.0, 0.20],
            snow=[0.0, 1.0],
            temperature=[40.0, 50.0],
            visibility=[16093.44, 16093.44],
            code=[0, 1],
        )
        sample = forecast.sample_at(1_700_001_800)
        self.assertAlmostEqual(sample.wind_mph, 15.0, places=1)
        self.assertAlmostEqual(sample.wind_gust_mph, 17.0, places=1)
        self.assertAlmostEqual(sample.wind_dir_deg, 0.0, places=1)
        self.assertAlmostEqual(sample.rain_in_hr, 0.1, places=3)
        self.assertAlmostEqual(sample.snow_in_hr, 0.5, places=3)
        self.assertAlmostEqual(sample.temperature_f, 45.0, places=1)

    def test_sample_at_outside_the_series_is_unavailable(self):
        forecast = PointForecast(
            lon=-87.63,
            lat=41.88,
            times=[1_700_000_000, 1_700_003_600],
            wind=[40.0, 40.0],
            gust=[40.0, 40.0],
            rain=[0.0, 0.0],
            snow=[0.0, 0.0],
            temperature=[40.0, 40.0],
            visibility=[16000.0, 16000.0],
            code=[0, 0],
        )
        early = forecast.sample_at(1_700_000_000 - 3 * 3600)
        late = forecast.sample_at(1_700_003_600 + 3 * 3600)
        self.assertFalse(early.has_observation())
        self.assertFalse(late.has_observation())
        self.assertIsNone(early.wind_mph)
        self.assertIsNone(late.temperature_f)
        # Inside the series the same wind must still be returned.
        inside = forecast.sample_at(1_700_000_000)
        self.assertTrue(inside.has_observation())
        self.assertAlmostEqual(inside.wind_mph, 40.0, places=1)

"""Weather fallbacks: MET Norway, NWS, the chain, and the Open-Meteo hand-off (no network)."""

from datetime import datetime, timezone
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase

from trucking.http import UpstreamError
from trucking.weather.cell_client import FallbackChain
from trucking.weather.met_norway import MetNorwayClient
from trucking.weather.nws import NwsClient
from trucking.weather.open_meteo import OpenMeteoClient, _dewpoints, forecasts_for_request, snap

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
        client = OpenMeteoClient(fallback=MetNorwayClient())
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
                OpenMeteoClient(fallback=MetNorwayClient()).forecasts([(-118.24, 34.05)], 2)
                OpenMeteoClient(fallback=MetNorwayClient()).forecasts([(-100.0, 40.0)], 2)
        self.assertEqual(open_meteo.call_count, 1)

    def test_both_providers_down_falls_back_to_placeholder(self):
        boom = UpstreamError("forbidden", provider="MET Norway", status=403)
        with mock.patch("trucking.weather.open_meteo.request_json", side_effect=DAILY_LIMIT):
            with mock.patch("trucking.weather.met_norway.request_json", side_effect=boom):
                _, placeholder = forecasts_for_request(
                    OpenMeteoClient(fallback=MetNorwayClient()), [(-118.24, 34.05)], latest=datetime.now(timezone.utc)
                )
        self.assertTrue(placeholder)


def _nws_grid(**layers) -> dict:
    return {"properties": {name: {"values": values} for name, values in layers.items()}}


class NwsParseTests(SimpleTestCase):
    def test_intervals_expand_hourly_with_gusts_and_snow(self):
        forecast = NwsClient._parse(
            (-105.0, 39.7),
            _nws_grid(
                windSpeed=[{"validTime": "2026-10-22T12:00:00+00:00/PT2H", "value": 40.0}],
                windGust=[{"validTime": "2026-10-22T12:00:00+00:00/PT2H", "value": 80.0}],
                temperature=[{"validTime": "2026-10-22T12:00:00+00:00/PT2H", "value": -2.0}],
                quantitativePrecipitation=[{"validTime": "2026-10-22T12:00:00+00:00/PT2H", "value": 10.0}],
                snowfallAmount=[{"validTime": "2026-10-22T12:00:00+00:00/PT2H", "value": 50.8}],
            ),
        )
        self.assertEqual(len(forecast.times), 2)
        sample = forecast.sample_at(forecast.times[1])
        self.assertAlmostEqual(sample.wind_mph, 24.9, places=1)
        self.assertAlmostEqual(sample.wind_gust_mph, 49.7, places=1)
        # 50.8 mm of snow over two hours is 1 in/hr; its 2.54 mm of water
        # per hour comes out of the rain total.
        self.assertAlmostEqual(sample.snow_in_hr, 1.0, places=3)
        self.assertAlmostEqual(sample.rain_in_hr, (5.0 - 2.54) / 25.4, places=3)
        self.assertAlmostEqual(sample.temperature_f, 28.4, places=1)

    def test_day_durations_are_understood(self):
        forecast = NwsClient._parse(
            (-105.0, 39.7),
            _nws_grid(windSpeed=[{"validTime": "2026-10-22T00:00:00+00:00/P1DT2H", "value": 10.0}]),
        )
        self.assertEqual(len(forecast.times), 26)

    def test_points_outside_the_us_are_remembered(self):
        missing = UpstreamError("NWS returned 404", provider="NWS", status=404)
        with mock.patch("trucking.weather.nws.request_json", side_effect=missing) as request:
            for _ in range(2):
                with self.assertRaises(UpstreamError):
                    NwsClient().forecasts([(2.35, 48.85)])
        self.assertEqual(request.call_count, 1)


class FallbackChainTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_met_norway_fills_what_nws_cannot_cover(self):
        us, abroad = (-118.24, 34.02), (2.35, 48.85)
        nws_grid = _nws_grid(windSpeed=[{"validTime": "2026-10-22T12:00:00+00:00/PT1H", "value": 10.0}])

        def nws(method, url, **kwargs):
            if "/points/" in url and "48.8" in url:
                raise UpstreamError("NWS returned 404", provider="NWS", status=404)
            if "/points/" in url:
                return {"properties": {"forecastGridData": "https://nws.test/gridpoints/LOX/1,1"}}
            return nws_grid

        chain = FallbackChain([NwsClient(), MetNorwayClient()])
        with mock.patch("trucking.weather.nws.request_json", side_effect=nws):
            with mock.patch(
                "trucking.weather.met_norway.request_json",
                return_value=_payload(_step("2026-10-22T12:00:00Z")),
            ) as met:
                result = chain.forecasts([us, abroad])
        self.assertEqual(set(result), {snap(us), snap(abroad)})
        self.assertEqual(met.call_count, 1)
        self.assertEqual(chain.name, "nws+met-norway")


class DewpointTests(SimpleTestCase):
    def test_magnus_matches_a_known_value(self):
        # 77 F at 50% RH has a dew point of about 57 F.
        self.assertAlmostEqual(_dewpoints([77.0], [50.0])[0], 57.0, delta=0.5)
        self.assertEqual(_dewpoints([None], [50.0]), [None])

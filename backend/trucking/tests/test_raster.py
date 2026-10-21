import io
from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase
from PIL import Image

from trucking.corridor import CorridorRequest, build_heatmap
from trucking.tests.fakes import FakeWeather, line
from trucking.weather.raster import build_and_cache_rasters, get_cached, mercator_y


class RasterOverlayTests(SimpleTestCase):
    def setUp(self):
        self.seeds = line((-100.0, 40.0), (-90.0, 40.0), 11)
        self.anchor = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    def test_png_is_rgba_and_cached_per_trip(self):
        timestamps = [self.anchor + timedelta(hours=h) for h in range(3)]
        request = CorridorRequest(
            seeds=self.seeds,
            load_lb=42_000.0,
            anchor=self.anchor,
            hours=2,
            demo_scenario="load_wind",
            route_lines=(tuple(self.seeds),),
        )
        bundle = build_and_cache_rasters(
            request,
            timestamps,
            FakeWeather(lambda lon, lat: {"wind": 5.0, "gust": 5.0}),
        )
        png = bundle.png(0, "risk")
        image = Image.open(io.BytesIO(png))
        self.assertEqual(image.mode, "RGBA")
        self.assertGreater(image.size[0], 20)
        self.assertGreater(image.size[1], 20)
        self.assertIs(get_cached(bundle.cache_id), bundle)
        again = build_and_cache_rasters(
            request,
            timestamps,
            FakeWeather(lambda lon, lat: {"wind": 5.0, "gust": 5.0}),
        )
        self.assertEqual(again.cache_id, bundle.cache_id)

    def test_mercator_rows_are_not_equal_lat_steps(self):
        south, north = 30.0, 50.0
        y0, y1 = mercator_y(south), mercator_y(north)
        self.assertGreater(y1 - y0, 0)
        mid_y = (y0 + y1) / 2.0
        # Equal mercator spacing is stretched toward the pole vs equal latitude.
        self.assertNotAlmostEqual((south + north) / 2.0, __import__("math").degrees(
            2 * __import__("math").atan(__import__("math").exp(mid_y)) - __import__("math").pi / 2
        ), places=2)

    def test_heatmap_payload_includes_raster_metadata(self):
        payload = build_heatmap(
            CorridorRequest(
                seeds=self.seeds,
                load_lb=42_000.0,
                anchor=self.anchor,
                hours=2,
                demo_scenario="load_wind",
                route_lines=(tuple(self.seeds),),
            ),
            weather_client=FakeWeather(lambda lon, lat: {"wind": 5.0, "gust": 5.0}),
        )
        raster = payload["raster"]
        self.assertIn("id", raster)
        self.assertEqual(len(raster["coordinates"]), 4)
        self.assertIn("{hour}", raster["url"])
        cached = get_cached(raster["id"])
        self.assertIsNotNone(cached)
        self.assertGreater(len(cached.png(0)), 80)

    def test_demo_storm_later_hour_is_hotter_than_departure(self):
        timestamps = [self.anchor + timedelta(hours=h) for h in range(10)]
        request = CorridorRequest(
            seeds=self.seeds,
            load_lb=42_000.0,
            anchor=self.anchor,
            hours=9,
            demo_scenario="load_wind",
            route_lines=(tuple(self.seeds),),
        )
        bundle = build_and_cache_rasters(
            request,
            timestamps,
            FakeWeather(lambda lon, lat: {"wind": 5.0, "gust": 5.0}),
        )

        def max_red(hour: int, metric: str = "wind") -> int:
            image = Image.open(io.BytesIO(bundle.png(hour, metric)))
            pixels = [pixel[0] for pixel in image.getdata() if pixel[3] > 40]
            return max(pixels) if pixels else 0

        self.assertGreater(max_red(8), max_red(0))

    def test_snow_metric_skips_the_low_green_band(self):
        timestamps = [self.anchor + timedelta(hours=h) for h in range(10)]
        request = CorridorRequest(
            seeds=self.seeds,
            load_lb=42_000.0,
            anchor=self.anchor,
            hours=9,
            demo_scenario="load_wind",
            route_lines=(tuple(self.seeds),),
        )
        bundle = build_and_cache_rasters(
            request,
            timestamps,
            FakeWeather(lambda lon, lat: {"wind": 5.0, "gust": 5.0}),
        )

        def opaque(hour: int, metric: str) -> int:
            image = Image.open(io.BytesIO(bundle.png(hour, metric)))
            return sum(1 for pixel in image.getdata() if pixel[3] > 20)

        self.assertGreater(opaque(0, "snow"), 0)
        self.assertGreater(opaque(8, "snow"), 0)
        self.assertGreater(opaque(0, "risk"), opaque(0, "snow"))

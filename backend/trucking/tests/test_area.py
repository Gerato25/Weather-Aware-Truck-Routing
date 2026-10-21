from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase

from trucking.area import (
    CORRIDOR_DIM_MILES,
    MAX_GRID_POINTS,
    WIND_BREAKS,
    _band,
    build_area_overlay,
    regular_grid,
)
from trucking.corridor import CorridorRequest
from trucking.tests.fakes import FakeWeather, line


class GridShapeTests(SimpleTestCase):
    def test_grid_stays_under_the_cap(self):
        xs, ys = regular_grid(-110.0, 38.0, -85.0, 45.0)
        self.assertGreaterEqual(len(xs) * len(ys), 40)
        self.assertLessEqual(len(xs) * len(ys), MAX_GRID_POINTS)

    def test_wind_breaks_match_the_legend(self):
        self.assertEqual(_band(10.0, WIND_BREAKS), 0)
        self.assertEqual(_band(25.0, WIND_BREAKS), 1)
        self.assertEqual(_band(34.9, WIND_BREAKS), 1)
        self.assertEqual(_band(35.0, WIND_BREAKS), 2)
        self.assertEqual(_band(45.0, WIND_BREAKS), 3)
        self.assertEqual(_band(55.0, WIND_BREAKS), 4)


class AreaOverlayTests(SimpleTestCase):
    def setUp(self):
        self.seeds = line((-100.0, 40.0), (-90.0, 40.0), 11)
        self.anchor = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        self.request = CorridorRequest(
            seeds=self.seeds,
            load_lb=42_000.0,
            anchor=self.anchor,
            hours=6,
        )

    def test_calm_air_keeps_arrows_without_fill_bands(self):
        payload = build_area_overlay(
            self.request,
            timestamps=[self.anchor],
            weather_client=FakeWeather(lambda lon, lat: {"wind": 5.0, "gust": 5.0, "wind_dir": 270.0}),
        )
        self.assertEqual(payload["fill"]["features"], [])
        self.assertTrue(payload["arrows"]["features"])
        self.assertTrue(all(item["properties"]["wind"] < 25 for item in payload["arrows"]["features"]))

    def test_demo_storm_still_drives_arrows(self):
        hours = 12
        timestamps = [self.anchor + timedelta(hours=h) for h in range(hours)]
        request = CorridorRequest(
            seeds=self.seeds,
            load_lb=42_000.0,
            anchor=self.anchor,
            hours=hours - 1,
            demo_scenario="load_wind",
            route_lines=(tuple(self.seeds),),
        )
        payload = build_area_overlay(
            request,
            timestamps=timestamps,
            weather_client=FakeWeather(lambda lon, lat: {"wind": 5.0, "gust": 5.0}),
        )
        self.assertEqual(payload["fill"]["features"], [])
        arrows = payload["arrows"]["features"]
        self.assertTrue(arrows)
        self.assertTrue(any(item["properties"]["hour"] == 0 for item in arrows))
        self.assertTrue(
            any(item["properties"]["wind"] >= 25 and item["properties"]["hour"] >= 5 for item in arrows)
        )
        self.assertEqual(CORRIDOR_DIM_MILES, 42.0)

    def test_cells_far_from_the_route_are_omitted(self):
        payload = build_area_overlay(
            self.request,
            timestamps=[self.anchor],
            weather_client=FakeWeather(lambda lon, lat: {"wind": 40.0, "gust": 40.0, "wind_dir": 135.0}),
        )
        self.assertTrue(all(item["properties"]["near"] == 1 for item in payload["arrows"]["features"]))
        self.assertGreater(CORRIDOR_DIM_MILES, 0)

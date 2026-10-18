"""Tests for corridor expansion and the 0-48 hour heatmap grid."""

from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase

from trucking.corridor import (
    LATERAL_OFFSETS_MILES,
    MAX_CORRIDOR_POINTS,
    CorridorRequest,
    build_heatmap,
    expand,
)
from trucking.geo import haversine_m, meters_to_miles
from trucking.risk import RiskLevel

from .fakes import FakeWeather, line


class ExpansionTests(SimpleTestCase):
    def test_centreline_is_widened_on_both_sides(self):
        seeds = line((-100.0, 40.0), (-90.0, 40.0), 11)
        points = expand(seeds)

        self.assertGreater(len(points), len(seeds))
        latitudes = [lat for _, lat in points]
        # The route runs due east, so offsets land north and south of it.
        self.assertLess(min(latitudes), 40.0)
        self.assertGreater(max(latitudes), 40.0)

    def test_offsets_sit_at_the_configured_distance(self):
        seeds = line((-100.0, 40.0), (-90.0, 40.0), 3)
        points = expand(seeds)
        widest = max(
            meters_to_miles(haversine_m((lon, 40.0), (lon, lat))) for lon, lat in points
        )
        self.assertAlmostEqual(widest, max(LATERAL_OFFSETS_MILES), delta=1.0)

    def test_point_count_is_capped_for_long_routes(self):
        seeds = line((-125.0, 40.0), (-70.0, 40.0), 400)
        self.assertLessEqual(len(expand(seeds)), MAX_CORRIDOR_POINTS)

    def test_duplicate_grid_cells_are_dropped(self):
        # Seeds closer together than the weather grid collapse to one point.
        seeds = line((-100.0, 40.0), (-99.999, 40.0), 10)
        self.assertLessEqual(len(expand(seeds)), len(LATERAL_OFFSETS_MILES))


class HeatmapTests(SimpleTestCase):
    def setUp(self):
        self.seeds = line((-100.0, 40.0), (-90.0, 40.0), 11)
        self.anchor = datetime.now(timezone.utc).replace(minute=30, second=0, microsecond=0)

    def build(self, conditions, hours=48, load_lb=20_000.0):
        return build_heatmap(
            CorridorRequest(
                seeds=self.seeds, load_lb=load_lb, anchor=self.anchor, hours=hours
            ),
            weather_client=FakeWeather(conditions),
        )

    def test_grid_shape_matches_points_and_hours(self):
        grid = self.build(lambda lon, lat: {"wind": 10.0})

        self.assertEqual(len(grid["hours"]), 49)  # hour 0 through 48 inclusive
        for key in ("risk", "wind", "rain", "snow"):
            with self.subTest(key=key):
                self.assertEqual(len(grid[key]), len(grid["points"]))
                self.assertTrue(all(len(row) == 49 for row in grid[key]))

    def test_anchor_is_aligned_to_the_hour(self):
        grid = self.build(lambda lon, lat: {"wind": 10.0})
        anchor = datetime.fromisoformat(grid["anchor"])
        self.assertEqual((anchor.minute, anchor.second), (0, 0))
        # Consecutive entries are exactly one hour apart.
        hours = [datetime.fromisoformat(h) for h in grid["hours"]]
        self.assertTrue(
            all(b - a == timedelta(hours=1) for a, b in zip(hours, hours[1:]))
        )

    def test_risk_scores_track_the_weather(self):
        calm = self.build(lambda lon, lat: {"wind": 5.0, "gust": 5.0})
        self.assertTrue(all(score == RiskLevel.LOW for row in calm["risk"] for score in row))

        gale = self.build(lambda lon, lat: {"wind": 70.0, "gust": 70.0})
        self.assertTrue(
            all(score == RiskLevel.NO_TRAVEL for row in gale["risk"] for score in row)
        )

    def test_load_rules_apply_to_the_heatmap(self):
        conditions = lambda lon, lat: {"wind": 50.0, "gust": 50.0}  # noqa: E731
        light = self.build(conditions, load_lb=10_000.0)
        heavy = self.build(conditions, load_lb=40_000.0)

        self.assertEqual(light["risk"][0][0], int(RiskLevel.SEVERE))
        self.assertEqual(heavy["risk"][0][0], int(RiskLevel.NO_TRAVEL))

    def test_snow_is_reported_alongside_risk(self):
        grid = self.build(lambda lon, lat: {"wind": 5.0, "snow": 2.5})
        self.assertEqual(grid["risk"][0][0], int(RiskLevel.SEVERE))
        self.assertAlmostEqual(grid["snow"][0][0], 2.5, places=2)

    def test_empty_seed_list_returns_an_empty_grid(self):
        grid = build_heatmap(
            CorridorRequest(seeds=[], load_lb=1000.0, anchor=self.anchor),
            weather_client=FakeWeather(lambda lon, lat: {}),
        )
        self.assertEqual(grid["points"], [])

"""Time-varying demo storms shared by checkpoints, cards and the area overlay."""

from django.test import SimpleTestCase

from trucking.tests.fakes import line
from trucking.weather.storms import build_demo_scenario, point_at_mile


class PointAtMileTests(SimpleTestCase):
    def test_clamps_to_the_ends(self):
        coords = line((-100.0, 40.0), (-90.0, 40.0), 11)
        start = point_at_mile(coords, 0)
        end = point_at_mile(coords, 10_000)
        self.assertAlmostEqual(start[0], -100.0, places=4)
        self.assertAlmostEqual(end[0], -90.0, places=4)

    def test_midpoint_is_halfway_along_a_straight_line(self):
        coords = line((-100.0, 40.0), (-90.0, 40.0), 21)
        mid = point_at_mile(coords, 269.0)  # ~half of ~538 miles
        self.assertAlmostEqual(mid[1], 40.0, places=4)
        self.assertGreater(mid[0], -97.0)
        self.assertLess(mid[0], -93.0)


class DemoScenarioTests(SimpleTestCase):
    def setUp(self):
        self.a = line((-100.0, 40.0), (-90.0, 40.0), 41)
        self.b = line((-100.0, 39.35), (-90.0, 39.35), 41)
        self.c = line((-100.0, 38.65), (-90.0, 38.65), 41)
        self.scenario = build_demo_scenario([self.a, self.b, self.c])
        self.wind = self.scenario.storms[0]
        lon, lat = self.wind.origin
        self.wind_lat = lat
        self.wind_lon = lon

    def test_hour_zero_is_calm(self):
        sample = self.scenario.sample(self.wind_lat, self.wind_lon, 0.0)
        self.assertLess(sample.wind_mph, 25)
        self.assertEqual(sample.rain_in_hr, 0.0)
        self.assertEqual(sample.snow_in_hr, 0.0)

    def test_wind_core_is_no_travel_at_the_hit_hour(self):
        sample = self.scenario.sample(self.wind_lat, self.wind_lon, self.wind.hit_hour)
        self.assertGreaterEqual(sample.wind_mph, 55)

    def test_storm_has_faded_by_hour_36(self):
        sample = self.scenario.sample(self.wind_lat, self.wind_lon, 36.0)
        self.assertLess(sample.wind_mph, 15)
        self.assertLess(sample.rain_in_hr, 0.05)
        self.assertLess(sample.snow_in_hr, 0.2)

    def test_snow_stays_over_its_area_for_the_full_window(self):
        snow = self.scenario.storms[2]
        lat, lon = snow.origin[1], snow.origin[0]
        for hour in (0.0, 12.0, 24.0, 36.0, 48.0):
            sample = self.scenario.sample(lat, lon, hour)
            self.assertGreaterEqual(sample.snow_in_hr, 0.5, msg=f"+{hour:.0f}h")

    def test_each_route_gets_a_different_hazard(self):
        rain = self.scenario.storms[1]
        snow = self.scenario.storms[2]
        wind_s = self.scenario.sample(self.wind.origin[1], self.wind.origin[0], self.wind.hit_hour)
        rain_s = self.scenario.sample(rain.origin[1], rain.origin[0], rain.hit_hour)
        snow_s = self.scenario.sample(snow.origin[1], snow.origin[0], snow.hit_hour)
        self.assertGreaterEqual(wind_s.wind_mph, 55)
        self.assertGreaterEqual(rain_s.rain_in_hr, 0.5)
        self.assertGreaterEqual(snow_s.snow_in_hr, 2.0)
        self.assertLess(wind_s.rain_in_hr, 0.1)
        self.assertLess(rain_s.snow_in_hr, 0.5)
        self.assertLess(snow_s.wind_mph, 25)

    def test_build_is_deterministic(self):
        other = build_demo_scenario([self.a, self.b, self.c])
        self.assertEqual(other.storms[0].origin, self.wind.origin)
        self.assertEqual(other.storms[0].hit_hour, self.wind.hit_hour)

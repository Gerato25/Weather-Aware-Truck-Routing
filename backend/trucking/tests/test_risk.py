"""Tests for the risk table and load rules.

These pin down the band edges, which is where a misreading of the spec would
show up first.
"""

from django.test import SimpleTestCase

from trucking.risk import (
    RiskLevel,
    WeatherSample,
    assess,
    classify_rain,
    classify_snow,
    classify_wind,
)

LIGHT_LOAD = 10_000.0
HEAVY_LOAD = 35_000.0   # over the 30,000 lb rule, under the 40,000 lb rule
MAX_LOAD = 45_000.0     # over both load thresholds


class WindBandTests(SimpleTestCase):
    def test_band_edges(self):
        cases = [
            (0.0, RiskLevel.LOW),
            (24.9, RiskLevel.LOW),
            (25.0, RiskLevel.MODERATE),
            (34.0, RiskLevel.MODERATE),
            (34.9, RiskLevel.MODERATE),
            (35.0, RiskLevel.HIGH),
            (44.9, RiskLevel.HIGH),
            (45.0, RiskLevel.SEVERE),
            (54.9, RiskLevel.SEVERE),
            (55.0, RiskLevel.NO_TRAVEL),
            (120.0, RiskLevel.NO_TRAVEL),
        ]
        for mph, expected in cases:
            with self.subTest(mph=mph):
                self.assertEqual(classify_wind(mph), expected)


class RainBandTests(SimpleTestCase):
    def test_band_edges(self):
        cases = [
            (0.0, RiskLevel.LOW),
            (0.099, RiskLevel.LOW),
            (0.10, RiskLevel.MODERATE),
            # Shared endpoints resolve to the lower band, as the table prints them.
            (0.25, RiskLevel.MODERATE),
            (0.26, RiskLevel.HIGH),
            (0.50, RiskLevel.HIGH),
            (0.51, RiskLevel.SEVERE),
            (1.00, RiskLevel.SEVERE),
            (1.01, RiskLevel.NO_TRAVEL),
        ]
        for inches, expected in cases:
            with self.subTest(inches=inches):
                self.assertEqual(classify_rain(inches), expected)


class SnowBandTests(SimpleTestCase):
    def test_band_edges(self):
        cases = [
            (0.0, RiskLevel.LOW),
            (0.49, RiskLevel.LOW),
            (0.5, RiskLevel.MODERATE),
            (1.0, RiskLevel.MODERATE),
            (1.01, RiskLevel.HIGH),
            (2.0, RiskLevel.HIGH),
            (2.01, RiskLevel.SEVERE),
            (3.0, RiskLevel.SEVERE),
            (3.01, RiskLevel.NO_TRAVEL),
        ]
        for inches, expected in cases:
            with self.subTest(inches=inches):
                self.assertEqual(classify_snow(inches), expected)


class LoadRuleTests(SimpleTestCase):
    """The three load overrides from the spec."""

    def assess_wind(self, mph: float, load_lb: float):
        return assess(WeatherSample(wind_mph=mph), load_lb, wind_metric="sustained")

    def test_55_mph_is_no_travel_for_any_load(self):
        for load in (0.0, LIGHT_LOAD, MAX_LOAD):
            with self.subTest(load=load):
                self.assertEqual(self.assess_wind(60.0, load).level, RiskLevel.NO_TRAVEL)

    def test_45_to_54_escalates_to_no_travel_above_30000_lb(self):
        self.assertEqual(self.assess_wind(50.0, 30_000.0).level, RiskLevel.SEVERE)
        self.assertEqual(self.assess_wind(50.0, 30_001.0).level, RiskLevel.NO_TRAVEL)
        self.assertEqual(self.assess_wind(50.0, HEAVY_LOAD).level, RiskLevel.NO_TRAVEL)

    def test_35_to_44_escalates_to_severe_above_40000_lb(self):
        self.assertEqual(self.assess_wind(40.0, 40_000.0).level, RiskLevel.HIGH)
        self.assertEqual(self.assess_wind(40.0, 40_001.0).level, RiskLevel.SEVERE)
        self.assertEqual(self.assess_wind(40.0, MAX_LOAD).level, RiskLevel.SEVERE)

    def test_heavy_load_does_not_escalate_moderate_wind(self):
        # A heavy load only matters from 35 mph up.
        self.assertEqual(self.assess_wind(30.0, MAX_LOAD).level, RiskLevel.MODERATE)
        self.assertEqual(self.assess_wind(10.0, MAX_LOAD).level, RiskLevel.LOW)

    def test_escalation_is_explained(self):
        result = self.assess_wind(50.0, HEAVY_LOAD)
        self.assertTrue(any("30,000" in reason for reason in result.reasons))


class CombinedConditionTests(SimpleTestCase):
    def test_overall_level_is_the_worst_condition(self):
        sample = WeatherSample(wind_mph=10.0, rain_in_hr=0.0, snow_in_hr=2.5)
        result = assess(sample, LIGHT_LOAD, wind_metric="sustained")
        self.assertEqual(result.level, RiskLevel.SEVERE)
        self.assertEqual(result.snow, RiskLevel.SEVERE)
        self.assertEqual(result.wind, RiskLevel.LOW)
        self.assertEqual(result.driver, "snow")

    def test_calm_clear_weather_is_low(self):
        result = assess(WeatherSample(wind_mph=5.0), MAX_LOAD, wind_metric="sustained")
        self.assertEqual(result.level, RiskLevel.LOW)
        self.assertEqual(result.reasons, [])

    def test_gusts_drive_the_default_metric(self):
        # Sustained wind is Low but gusts reach the High band.
        sample = WeatherSample(wind_mph=20.0, wind_gust_mph=40.0)
        self.assertEqual(assess(sample, LIGHT_LOAD, "max").level, RiskLevel.HIGH)
        self.assertEqual(assess(sample, LIGHT_LOAD, "sustained").level, RiskLevel.LOW)
        self.assertEqual(assess(sample, LIGHT_LOAD, "gust").level, RiskLevel.HIGH)

    def test_secondary_conditions_are_reported(self):
        sample = WeatherSample(wind_mph=40.0, rain_in_hr=0.30)
        result = assess(sample, LIGHT_LOAD, wind_metric="sustained")
        self.assertEqual(result.level, RiskLevel.HIGH)
        self.assertTrue(any("Rain" in reason for reason in result.reasons))

    def test_score_matches_level_ordering(self):
        self.assertEqual(int(RiskLevel.LOW), 0)
        self.assertEqual(int(RiskLevel.NO_TRAVEL), 4)
        self.assertLess(RiskLevel.HIGH, RiskLevel.SEVERE)

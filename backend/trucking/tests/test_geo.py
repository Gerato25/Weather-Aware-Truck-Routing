"""Tests for distance/time profiles and checkpoint sampling."""

import math

from django.test import SimpleTestCase

from trucking.geo import (
    METERS_PER_MILE,
    cumulative_distances,
    haversine_m,
    initial_bearing_deg,
    meters_to_miles,
    miles_to_meters,
    offset_coord,
    profile_from_edge_durations,
    profile_from_steps,
    simplify,
)


def straight_line(points: int = 101, degrees: float = 10.0):
    """An east-west line along the equator, where 1 degree is a known distance."""
    return [(degrees * i / (points - 1), 0.0) for i in range(points)]


class DistanceTests(SimpleTestCase):
    def test_haversine_matches_known_distance(self):
        # Chicago -> Philadelphia is ~666 miles great-circle.
        distance = haversine_m((-87.6298, 41.8781), (-75.1652, 39.9526))
        self.assertAlmostEqual(meters_to_miles(distance), 666, delta=8)

    def test_zero_distance(self):
        self.assertEqual(haversine_m((10.0, 20.0), (10.0, 20.0)), 0.0)

    def test_mile_conversions_round_trip(self):
        self.assertAlmostEqual(meters_to_miles(miles_to_meters(123.4)), 123.4, places=6)

    def test_cumulative_distances_are_monotonic(self):
        cum = cumulative_distances(straight_line())
        self.assertEqual(cum[0], 0.0)
        self.assertEqual(len(cum), 101)
        self.assertTrue(all(b >= a for a, b in zip(cum, cum[1:])))

    def test_bearing_and_offset_are_inverse(self):
        start = (-87.6298, 41.8781)
        moved = offset_coord(start, 90.0, 50_000)
        self.assertAlmostEqual(haversine_m(start, moved), 50_000, delta=50)
        self.assertAlmostEqual(initial_bearing_deg(start, moved), 90.0, delta=0.5)


class ProfileTests(SimpleTestCase):
    def test_edge_durations_build_a_cumulative_clock(self):
        coords = straight_line(5)
        profile = profile_from_edge_durations(coords, [100.0, 200.0, 300.0, 400.0])
        self.assertEqual(profile.cum_s, [0.0, 100.0, 300.0, 600.0, 1000.0])
        self.assertEqual(profile.total_s, 1000.0)

    def test_totals_are_rescaled_to_provider_values(self):
        coords = straight_line(5)
        profile = profile_from_edge_durations(
            coords, [1.0, 1.0, 1.0, 1.0], total_distance_m=400_000, total_duration_s=3600
        )
        self.assertAlmostEqual(profile.total_m, 400_000, places=3)
        self.assertAlmostEqual(profile.total_s, 3600, places=3)

    def test_at_distance_interpolates_time_linearly(self):
        coords = straight_line(5)
        profile = profile_from_edge_durations(
            coords, [100.0, 100.0, 100.0, 100.0], total_distance_m=4000.0
        )
        _, elapsed = profile.at_distance(2000.0)
        self.assertAlmostEqual(elapsed, 200.0, places=3)

        # Halfway through the second edge.
        _, elapsed = profile.at_distance(1500.0)
        self.assertAlmostEqual(elapsed, 150.0, places=3)

    def test_at_distance_clamps_to_route_ends(self):
        profile = profile_from_edge_durations(straight_line(5), [10.0] * 4)
        self.assertEqual(profile.at_distance(-500.0)[1], 0.0)
        self.assertEqual(profile.at_distance(1e12)[1], profile.total_s)

    def test_steps_distribute_duration_across_vertices(self):
        coords = straight_line(5)
        # One step covering the whole line, 400 seconds over 4 equal edges.
        profile = profile_from_steps(coords, [(0, 4, 400.0)])
        for i, expected in enumerate([0.0, 100.0, 200.0, 300.0, 400.0]):
            self.assertAlmostEqual(profile.cum_s[i], expected, places=3)

    def test_step_profile_never_goes_backwards(self):
        coords = straight_line(9)
        profile = profile_from_steps(coords, [(0, 4, 300.0), (4, 8, 100.0)])
        self.assertTrue(all(b >= a for a, b in zip(profile.cum_s, profile.cum_s[1:])))
        self.assertAlmostEqual(profile.total_s, 400.0, places=3)

    def test_rejects_degenerate_geometry(self):
        with self.assertRaises(ValueError):
            profile_from_edge_durations([(0.0, 0.0)], [])


class SamplingTests(SimpleTestCase):
    def build(self, total_miles: float, total_hours: float):
        coords = straight_line(201)
        return profile_from_edge_durations(
            coords,
            [1.0] * 200,
            total_distance_m=miles_to_meters(total_miles),
            total_duration_s=total_hours * 3600,
        )

    def test_sampling_interval_and_endpoints(self):
        profile = self.build(100.0, 2.0)
        checkpoints = profile.sample(miles_to_meters(25.0))

        self.assertEqual(len(checkpoints), 5)  # 0, 25, 50, 75, 100
        miles = [round(meters_to_miles(cp.distance_m), 2) for cp in checkpoints]
        self.assertEqual(miles, [0.0, 25.0, 50.0, 75.0, 100.0])

    def test_segment_miles_sum_to_route_length(self):
        profile = self.build(100.0, 2.0)
        for interval in (10.0, 25.0, 50.0):
            with self.subTest(interval=interval):
                checkpoints = profile.sample(miles_to_meters(interval))
                total = sum(meters_to_miles(cp.segment_m) for cp in checkpoints)
                self.assertAlmostEqual(total, 100.0, places=4)

    def test_etas_increase_and_match_total_duration(self):
        profile = self.build(100.0, 2.0)
        checkpoints = profile.sample(miles_to_meters(10.0))
        elapsed = [cp.elapsed_s for cp in checkpoints]
        self.assertTrue(all(b > a for a, b in zip(elapsed, elapsed[1:])))
        self.assertAlmostEqual(elapsed[-1], 7200.0, places=2)
        # At constant speed the halfway checkpoint is reached at half the time.
        self.assertAlmostEqual(elapsed[5], 3600.0, delta=1.0)

    def test_max_points_widens_the_interval(self):
        profile = self.build(2000.0, 36.0)
        checkpoints = profile.sample(miles_to_meters(10.0), max_points=50)
        self.assertLessEqual(len(checkpoints), 50)
        # The destination is still the final checkpoint.
        self.assertAlmostEqual(meters_to_miles(checkpoints[-1].distance_m), 2000.0, places=2)

    def test_near_duplicate_final_checkpoint_is_collapsed(self):
        # Only collapse when the leftover is under 0.5 miles.
        profile = self.build(100.2, 2.0)
        checkpoints = profile.sample(miles_to_meters(50.0))
        miles = [round(meters_to_miles(cp.distance_m), 2) for cp in checkpoints]
        self.assertEqual(miles[-1], 100.2)
        self.assertEqual(miles[-2], 50.0)

    def test_destination_is_kept_when_leftover_is_a_real_stretch(self):
        profile = self.build(1005.0, 18.0)
        checkpoints = profile.sample(miles_to_meters(25.0))
        miles = [round(meters_to_miles(cp.distance_m), 1) for cp in checkpoints]
        self.assertEqual(miles[-1], 1005.0)
        self.assertEqual(miles[-2], 1000.0)
        self.assertEqual(len(checkpoints), 42)

    def test_rejects_non_positive_interval(self):
        with self.assertRaises(ValueError):
            self.build(100.0, 2.0).sample(0)

    def test_checkpoints_follow_the_polyline_not_the_chord(self):
        # L-shaped route: east then north. The halfway point is the corner,
        # not the straight-line midpoint between origin and destination.
        coords = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]
        profile = profile_from_edge_durations(coords, [1.0, 1.0])
        checkpoints = profile.sample(profile.total_m / 2)

        self.assertEqual(len(checkpoints), 3)
        self.assertAlmostEqual(checkpoints[0].lon, 0.0, places=5)
        self.assertAlmostEqual(checkpoints[0].lat, 0.0, places=5)
        self.assertAlmostEqual(checkpoints[1].lon, 1.0, places=4)
        self.assertAlmostEqual(checkpoints[1].lat, 0.0, places=3)
        self.assertAlmostEqual(checkpoints[-1].lon, 1.0, places=5)
        self.assertAlmostEqual(checkpoints[-1].lat, 1.0, places=5)
        chord_mid = (0.5, 0.5)
        self.assertGreater(haversine_m(checkpoints[1].coord, chord_mid), 40_000)

    def test_sampled_points_stay_on_the_geometry(self):
        profile = self.build(100.0, 2.0)
        for cp in profile.sample(miles_to_meters(25.0)):
            expected, _ = profile.at_distance(cp.distance_m)
            self.assertLess(haversine_m(expected, cp.coord), 5.0)


class SimplifyTests(SimpleTestCase):
    def test_collinear_points_collapse_to_endpoints(self):
        self.assertEqual(len(simplify(straight_line(50), tolerance_m=50.0)), 2)

    def test_detours_are_preserved(self):
        coords = [(0.0, 0.0), (1.0, 0.0), (2.0, 1.0), (3.0, 0.0), (4.0, 0.0)]
        simplified = simplify(coords, tolerance_m=1000.0)
        self.assertIn((2.0, 1.0), simplified)

    def test_endpoints_always_survive(self):
        coords = straight_line(30)
        simplified = simplify(coords, tolerance_m=10_000.0)
        self.assertEqual(simplified[0], coords[0])
        self.assertEqual(simplified[-1], coords[-1])

    def test_short_input_is_returned_unchanged(self):
        coords = [(0.0, 0.0), (1.0, 1.0)]
        self.assertEqual(simplify(coords), coords)

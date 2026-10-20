"""Tests for route aggregation and the recommendation ranking."""

from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase

from trucking.planner import (
    EvaluatedRoute,
    TripRequest,
    collect_routes,
    plan_trip,
    shared_fraction,
)
from trucking.providers.base import Place
from trucking.risk import RiskLevel
from trucking.weather.open_meteo import PointForecast, snap

from .fakes import FakeRouter, FakeWeather, line, make_route

ORIGIN = Place(label="Origin", lat=40.0, lon=-100.0)
DESTINATION = Place(label="Destination", lat=40.0, lon=-90.0)


def departure() -> datetime:
    return (datetime.now(timezone.utc) + timedelta(hours=2)).replace(
        minute=0, second=0, microsecond=0
    )


def trip(
    load_lb: float = 20_000.0,
    interval_miles: float = 25.0,
    demo_scenario: str = "",
) -> TripRequest:
    return TripRequest(
        origin=ORIGIN,
        destination=DESTINATION,
        departure=departure(),
        load_lb=load_lb,
        interval_miles=interval_miles,
        demo_scenario=demo_scenario,
    )


def calm(lon: float, lat: float) -> dict:
    """Severe crosswinds north of 40.5 degrees, calm elsewhere."""
    if lat >= 40.5:
        return {"wind": 50.0, "gust": 50.0}
    return {"wind": 5.0, "gust": 8.0}


class TimeVaryingWeather:
    """Wind climbs 1 mph every hour so ETA sampling is observable."""

    name = "time-fake"

    def __init__(self) -> None:
        start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        self.times = [int((start + timedelta(hours=hour)).timestamp()) for hour in range(72)]
        self.requested: list[tuple[float, float]] = []

    def forecast_days_for(self, latest: datetime) -> int:
        return 4

    def forecasts(self, coords, forecast_days: int = 3):
        out: dict = {}
        count = len(self.times)
        wind = [float(hour) for hour in range(count)]
        for coord in coords:
            key = snap(coord)
            if key in out:
                continue
            self.requested.append(key)
            out[key] = PointForecast(
                lon=key[0],
                lat=key[1],
                times=self.times,
                wind=wind,
                gust=wind,
                wind_dir=[270.0] * count,
                rain=[0.0] * count,
                snow=[0.0] * count,
                temperature=[40.0] * count,
                visibility=[16000.0] * count,
                code=[0] * count,
            )
        return out


class ShortHorizonWeather:
    """A two-hour series that cannot cover a 12-hour trip's destination ETA."""

    name = "short-fake"

    def __init__(self) -> None:
        start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        self.times = [int((start + timedelta(hours=hour)).timestamp()) for hour in range(2)]
        self.requested: list[tuple[float, float]] = []

    def forecast_days_for(self, latest: datetime) -> int:
        return 1

    def forecasts(self, coords, forecast_days: int = 3):
        out: dict = {}
        count = len(self.times)
        for coord in coords:
            key = snap(coord)
            if key in out:
                continue
            self.requested.append(key)
            out[key] = PointForecast(
                lon=key[0],
                lat=key[1],
                times=self.times,
                wind=[5.0] * count,
                gust=[5.0] * count,
                rain=[0.0] * count,
                snow=[0.0] * count,
                temperature=[40.0] * count,
                visibility=[16000.0] * count,
                code=[0] * count,
            )
        return out


class AggregationTests(SimpleTestCase):
    def setUp(self):
        # A calm southern route and a stormy northern one.
        self.southern = make_route((-100.0, 40.0), (-90.0, 40.0), 600.0, 12.0)
        self.northern = make_route((-100.0, 41.0), (-90.0, 41.0), 560.0, 10.0)

    def plan(self, **kwargs):
        router = FakeRouter([self.southern, self.northern])
        return plan_trip(trip(**kwargs), weather_client=FakeWeather(calm), router=router)

    def test_level_mileage_sums_to_route_distance(self):
        payload = self.plan()
        for route in payload["routes"]:
            with self.subTest(route=route["id"]):
                total = sum(route["summary"]["miles_by_level"].values())
                self.assertAlmostEqual(total, route["summary"]["distance_miles"], delta=0.5)

    def test_calm_route_is_low_risk_and_stormy_route_is_severe(self):
        payload = self.plan()
        by_id = {route["id"]: route for route in payload["routes"]}

        southern = by_id["route-1"]["summary"]
        self.assertEqual(southern["max_level"], RiskLevel.LOW.slug)
        self.assertEqual(southern["miles_by_level"]["SEVERE"], 0.0)
        self.assertAlmostEqual(southern["average_risk"], 0.0, places=3)

        northern = by_id["route-2"]["summary"]
        self.assertEqual(northern["max_level"], RiskLevel.SEVERE.slug)
        self.assertAlmostEqual(
            northern["miles_by_level"]["SEVERE"], northern["distance_miles"], delta=0.5
        )
        self.assertAlmostEqual(northern["average_risk"], 3.0, places=2)

    def test_low_components_are_not_serialized_as_unknown(self):
        checkpoint = self.plan()["routes"][0]["checkpoints"][0]
        self.assertEqual(checkpoint["risk"]["level"], "LOW")
        self.assertEqual(checkpoint["risk"]["components"]["wind"], "LOW")
        self.assertEqual(checkpoint["risk"]["components"]["rain"], "LOW")
        self.assertEqual(checkpoint["risk"]["components"]["snow"], "LOW")

    def test_routes_are_labeled_a_then_b(self):
        payload = self.plan()
        self.assertEqual([route["label"] for route in payload["routes"]], ["Route A", "Route B"])
        self.assertIn(payload["recommendation"]["label"], {"Route A", "Route B"})

    def test_demo_load_wind_makes_route_a_lose_at_42000_lb(self):
        def still(lon, lat):
            return {"wind": 5.0, "gust": 5.0}

        router = FakeRouter(
            [
                make_route((-100.0, 40.0), (-90.0, 40.0), 600.0, 10.0),
                make_route((-100.0, 40.2), (-90.0, 40.2), 620.0, 12.0),
            ]
        )
        weather = FakeWeather(still)
        baseline = plan_trip(trip(load_lb=42_000), weather_client=weather, router=router)
        self.assertEqual(baseline["recommendation"]["route_id"], "route-1")

        demo = plan_trip(
            trip(load_lb=42_000, demo_scenario="load_wind"),
            weather_client=weather,
            router=router,
        )
        route_a = demo["routes"][0]
        self.assertGreater(route_a["summary"]["miles_by_level"]["SEVERE"], 10)
        severe = next(cp for cp in route_a["checkpoints"] if cp["risk"]["level"] == "SEVERE")
        self.assertEqual(severe["risk"]["driver"], "wind")
        self.assertIsNotNone(severe["weather"]["wind_dir_deg"])
        self.assertEqual(demo["recommendation"]["route_id"], "route-2")
        self.assertEqual(demo["recommendation"]["label"], "Route B")
        self.assertTrue(any("Route A" in reason for reason in demo["recommendation"]["reasons"]))

    def test_recommendation_prefers_fewer_severe_miles_over_speed(self):
        payload = self.plan()
        # The northern route is two hours faster but entirely Severe.
        self.assertEqual(payload["recommendation"]["route_id"], "route-1")
        self.assertTrue(
            any("Severe" in reason for reason in payload["recommendation"]["reasons"])
        )

    def test_load_rules_block_the_stormy_route_for_a_heavy_load(self):
        # 50 mph wind plus >30,000 lb is No Travel.
        payload = self.plan(load_lb=42_000.0)
        by_id = {route["id"]: route for route in payload["routes"]}
        self.assertTrue(by_id["route-2"]["summary"]["blocked"])
        self.assertFalse(by_id["route-1"]["summary"]["blocked"])
        self.assertEqual(payload["recommendation"]["route_id"], "route-1")

    def test_checkpoint_etas_run_from_departure_to_arrival(self):
        payload = self.plan()
        route = payload["routes"][0]
        etas = [datetime.fromisoformat(cp["eta"]) for cp in route["checkpoints"]]

        self.assertEqual(etas[0], trip().departure)
        self.assertTrue(all(b > a for a, b in zip(etas, etas[1:])))
        arrival = datetime.fromisoformat(route["summary"]["arrival"])
        self.assertAlmostEqual((arrival - etas[-1]).total_seconds(), 0.0, delta=60)

    def test_sampling_interval_controls_checkpoint_count(self):
        for interval, expected in ((50.0, 13), (25.0, 25), (10.0, 61)):
            with self.subTest(interval=interval):
                payload = self.plan(interval_miles=interval)
                self.assertEqual(
                    len(payload["routes"][0]["checkpoints"]), expected
                )

    def test_response_includes_geometry_and_corridor_seeds(self):
        route = self.plan()["routes"][0]
        self.assertEqual(route["geometry"]["type"], "LineString")
        self.assertGreaterEqual(len(route["geometry"]["coordinates"]), 2)
        self.assertGreaterEqual(len(route["corridor_seeds"]), 2)

    def test_weather_is_requested_once_per_grid_cell(self):
        weather = FakeWeather(calm)
        plan_trip(
            trip(),
            weather_client=weather,
            router=FakeRouter([self.southern, self.northern]),
        )
        self.assertEqual(len(weather.requested), len(set(weather.requested)))

    def test_router_receives_resolved_origin_and_destination(self):
        router = FakeRouter([self.southern])
        plan_trip(trip(), weather_client=FakeWeather(calm), router=router)
        waypoints, alternatives, _load = router.calls[0]
        self.assertEqual(waypoints[0], ORIGIN.coord)
        self.assertEqual(waypoints[-1], DESTINATION.coord)
        self.assertEqual(alternatives, 3)

    def test_checkpoints_use_eta_weather_at_their_own_coordinates(self):
        weather = TimeVaryingWeather()
        payload = plan_trip(
            trip(),
            weather_client=weather,
            router=FakeRouter([self.southern]),
        )
        route = payload["routes"][0]
        first = route["checkpoints"][0]
        last = route["checkpoints"][-1]

        self.assertIsNotNone(first["weather"]["wind_mph"])
        self.assertIsNotNone(last["weather"]["wind_mph"])
        self.assertGreater(last["weather"]["wind_mph"], first["weather"]["wind_mph"] + 8)
        self.assertEqual(first["weather"]["forecast_at"], first["eta"])
        self.assertEqual(last["weather"]["forecast_at"], last["eta"])
        self.assertEqual(first["weather"]["wind_dir_deg"], 270.0)
        self.assertEqual(first["weather"]["wind_dir"], "W")

        requested = set(weather.requested)
        for checkpoint in route["checkpoints"]:
            self.assertIn(snap((checkpoint["lon"], checkpoint["lat"])), requested)

    def test_out_of_range_eta_weather_is_unavailable(self):
        weather = ShortHorizonWeather()
        payload = plan_trip(
            trip(),
            weather_client=weather,
            router=FakeRouter([self.southern]),
        )
        last = payload["routes"][0]["checkpoints"][-1]
        self.assertIsNone(last["weather"]["wind_mph"])
        self.assertIsNone(last["weather"]["forecast_at"])
        self.assertFalse(last["risk"]["available"])
        self.assertEqual(last["risk"]["level"], "UNKNOWN")


class RankingTests(SimpleTestCase):
    """Each tier of the preference order decides when the ones above it tie."""

    def rank(self, routes, conditions=calm, load_lb=20_000.0):
        payload = plan_trip(
            trip(load_lb=load_lb),
            weather_client=FakeWeather(conditions),
            router=FakeRouter(routes),
        )
        return [entry["route_id"] for entry in payload["recommendation"]["ranking"]]

    def test_high_miles_break_a_severe_tie(self):
        def conditions(lon, lat):
            if lat >= 41.5:
                return {"wind": 40.0, "gust": 40.0}   # High
            return {"wind": 5.0, "gust": 5.0}         # Low

        routes = [
            make_route((-100.0, 42.0), (-90.0, 42.0), 500.0, 9.0),   # all High
            make_route((-100.0, 40.0), (-90.0, 40.0), 520.0, 11.0),  # all Low
        ]
        self.assertEqual(self.rank(routes, conditions)[0], "route-2")

    def test_average_risk_breaks_a_severe_and_high_tie(self):
        def conditions(lon, lat):
            # Moderate in the north, Low in the south; neither is High or Severe.
            return {"wind": 30.0, "gust": 30.0} if lat >= 41.5 else {"wind": 5.0, "gust": 5.0}

        routes = [
            make_route((-100.0, 42.0), (-90.0, 42.0), 500.0, 9.0),   # Moderate throughout
            make_route((-100.0, 40.0), (-90.0, 40.0), 500.0, 9.5),   # Low throughout
        ]
        ranking = self.rank(routes, conditions)
        self.assertEqual(ranking[0], "route-2")

    def test_duration_breaks_an_all_risk_tie(self):
        def uniform(lon, lat):
            return {"wind": 5.0, "gust": 5.0}

        routes = [
            make_route((-100.0, 40.0), (-90.0, 40.0), 500.0, 11.0),
            make_route((-100.0, 39.0), (-90.0, 39.0), 500.0, 9.0),
        ]
        self.assertEqual(self.rank(routes, uniform)[0], "route-2")

    def test_no_travel_route_ranks_last_even_when_fastest(self):
        def gale(lon, lat):
            return {"wind": 70.0, "gust": 70.0} if lat >= 41.5 else {"wind": 5.0, "gust": 5.0}

        routes = [
            make_route((-100.0, 42.0), (-90.0, 42.0), 400.0, 6.0),   # fastest, No Travel
            make_route((-100.0, 40.0), (-90.0, 40.0), 600.0, 12.0),  # slow but clear
        ]
        self.assertEqual(self.rank(routes, gale)[0], "route-2")

    def test_fewer_severe_miles_beat_fewer_high_miles(self):
        def conditions(lon, lat):
            if lat >= 41.5:
                return {"wind": 50.0, "gust": 50.0}  # Severe
            if lat >= 40.5:
                return {"wind": 40.0, "gust": 40.0}  # High
            return {"wind": 5.0, "gust": 5.0}

        routes = [
            make_route((-100.0, 42.0), (-90.0, 42.0), 480.0, 8.0),   # Severe, faster
            make_route((-100.0, 41.0), (-90.0, 41.0), 520.0, 11.0),  # High only, slower
        ]
        ranking = self.rank(routes, conditions)
        self.assertEqual(ranking[0], "route-2")
        self.assertEqual(ranking[1], "route-1")

    def test_fewer_high_miles_beat_average_risk_and_duration(self):
        def conditions(lon, lat):
            if lat >= 41.5:
                return {"wind": 40.0, "gust": 40.0}  # High
            return {"wind": 30.0, "gust": 30.0}      # Moderate

        routes = [
            make_route((-100.0, 42.0), (-90.0, 42.0), 450.0, 8.0),   # High, faster
            make_route((-100.0, 40.0), (-90.0, 40.0), 500.0, 12.0),  # Moderate, slower
        ]
        self.assertEqual(self.rank(routes, conditions)[0], "route-2")

    def test_ranking_key_priority_is_severe_then_high_then_average_then_time(self):
        def scored(route_id, severe, high, average, hours):
            route = EvaluatedRoute(
                id=route_id,
                label=route_id,
                raw=make_route((-100.0, 40.0), (-90.0, 40.0), 500.0, hours),
                checkpoints=[],
            )
            route.miles_by_level = {level: 0.0 for level in RiskLevel}
            route.miles_by_level[RiskLevel.SEVERE] = severe
            route.miles_by_level[RiskLevel.HIGH] = high
            route.average_risk = average
            route.scored_miles = 500.0
            return route

        ordered = sorted(
            [
                scored("more-severe", 20.0, 0.0, 0.2, 8.0),
                scored("more-high", 0.0, 80.0, 0.2, 8.0),
                scored("higher-avg", 0.0, 0.0, 1.4, 8.0),
                scored("slower-low-avg", 0.0, 0.0, 0.2, 14.0),
                scored("fastest-low-avg", 0.0, 0.0, 0.2, 9.0),
            ],
            key=lambda route: route.ranking_key(),
        )
        self.assertEqual(
            [route.id for route in ordered],
            ["fastest-low-avg", "slower-low-avg", "higher-avg", "more-high", "more-severe"],
        )

    def test_ranking_rows_match_route_summaries(self):
        payload = plan_trip(
            trip(),
            weather_client=FakeWeather(calm),
            router=FakeRouter(
                [
                    make_route((-100.0, 40.0), (-90.0, 40.0), 600.0, 12.0),
                    make_route((-100.0, 41.0), (-90.0, 41.0), 560.0, 10.0),
                ]
            ),
        )
        by_id = {route["id"]: route for route in payload["routes"]}
        for row in payload["recommendation"]["ranking"]:
            summary = by_id[row["route_id"]]["summary"]
            self.assertEqual(row["severe_miles"], summary["miles_by_level"]["SEVERE"])
            self.assertEqual(row["high_miles"], summary["miles_by_level"]["HIGH"])
            self.assertEqual(row["average_risk"], summary["average_risk"])
            self.assertEqual(row["duration_hours"], summary["duration_hours"])
            self.assertEqual(row["no_travel_miles"], summary["miles_by_level"]["NO_TRAVEL"])

    def test_missing_forecast_is_not_ranked_as_zero_risk(self):
        def conditions(lon, lat):
            return {"wind": 40.0, "gust": 40.0}

        class PartialWeather(FakeWeather):
            def forecasts(self, coords, forecast_days=3):
                kept = [coord for coord in coords if coord[1] < 40.5]
                return super().forecasts(kept, forecast_days)

        payload = plan_trip(
            trip(),
            weather_client=PartialWeather(conditions),
            router=FakeRouter(
                [
                    make_route((-100.0, 41.0), (-90.0, 41.0), 400.0, 7.0),  # no weather
                    make_route((-100.0, 40.0), (-90.0, 40.0), 520.0, 11.0),  # High, scored
                ]
            ),
        )
        northern = next(route for route in payload["routes"] if route["id"] == "route-1")
        self.assertFalse(northern["checkpoints"][0]["risk"]["available"])
        self.assertEqual(northern["checkpoints"][0]["risk"]["level"], "UNKNOWN")
        self.assertEqual(payload["recommendation"]["route_id"], "route-2")


class RouteCollectionTests(SimpleTestCase):
    def test_identical_routes_are_deduplicated(self):
        duplicate = make_route((-100.0, 40.0), (-90.0, 40.0), 600.0, 12.0)
        near_duplicate = make_route((-100.0, 40.001), (-90.0, 40.001), 601.0, 12.1)
        routes = collect_routes(FakeRouter([duplicate, near_duplicate]), trip())
        self.assertEqual(len(routes), 1)

    def test_distinct_routes_are_all_kept(self):
        routes = collect_routes(
            FakeRouter(
                [
                    make_route((-100.0, 40.0), (-90.0, 40.0), 600.0, 12.0),
                    make_route((-100.0, 41.0), (-90.0, 41.0), 610.0, 12.2),
                    make_route((-100.0, 42.0), (-90.0, 42.0), 620.0, 12.4),
                ]
            ),
            trip(),
        )
        self.assertEqual(len(routes), 3)

    def test_detours_are_attempted_when_the_router_returns_too_few(self):
        router = FakeRouter([make_route((-100.0, 40.0), (-90.0, 40.0), 600.0, 12.0)])
        collect_routes(router, trip())
        # One origin/destination call plus at least one three-waypoint detour attempt.
        self.assertGreater(len([call for call in router.calls if len(call[0]) == 3]), 0)

    def test_shared_fraction_detects_overlap(self):
        a = line((-100.0, 40.0), (-90.0, 40.0))
        b = line((-100.0, 45.0), (-90.0, 45.0))
        self.assertAlmostEqual(shared_fraction(a, a), 1.0, places=6)
        self.assertEqual(shared_fraction(a, b), 0.0)

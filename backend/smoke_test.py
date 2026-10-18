"""Live end-to-end check against the real routing and weather providers.

Unlike the unit tests this one hits the network, so it is kept out of the test
suite and run on demand:

    python smoke_test.py "Chicago, IL" "Philadelphia, PA" 42000
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from trucking.corridor import CorridorRequest, build_heatmap  # noqa: E402
from trucking.planner import TripRequest, plan_trip  # noqa: E402
from trucking.providers.registry import get_geocoder  # noqa: E402


def main() -> int:
    origin_text = sys.argv[1] if len(sys.argv) > 1 else "Chicago, IL"
    destination_text = sys.argv[2] if len(sys.argv) > 2 else "Philadelphia, PA"
    load_lb = float(sys.argv[3]) if len(sys.argv) > 3 else 42_000.0
    interval = float(sys.argv[4]) if len(sys.argv) > 4 else 25.0

    geocoder = get_geocoder()
    origin = geocoder.search(origin_text, 1)[0]
    destination = geocoder.search(destination_text, 1)[0]
    print(f"origin      : {origin.label} ({origin.lat:.4f}, {origin.lon:.4f})")
    print(f"destination : {destination.label} ({destination.lat:.4f}, {destination.lon:.4f})")

    departure = (datetime.now(timezone.utc) + timedelta(hours=3)).replace(
        minute=0, second=0, microsecond=0
    )
    started = datetime.now()
    payload = plan_trip(
        TripRequest(
            origin=origin,
            destination=destination,
            departure=departure,
            load_lb=load_lb,
            interval_miles=interval,
        )
    )
    elapsed = (datetime.now() - started).total_seconds()

    provider = payload["provider"]
    print(
        f"\nrouting={provider['routing']} truck_profile={provider['truck_profile']} "
        f"weather={provider['weather']} wind={provider['wind_metric']} "
        f"load={load_lb:,.0f} lb interval={interval:.0f} mi  ({elapsed:.1f}s)"
    )

    print(f"\n{len(payload['routes'])} route option(s):")
    header = f"{'id':9} {'label':11} {'mi':>7} {'hrs':>6} {'cps':>4} {'avg':>5} {'worst':>9}"
    print(header)
    print("-" * len(header))
    for route in payload["routes"]:
        s = route["summary"]
        print(
            f"{route['id']:9} {route['label']:11} {s['distance_miles']:7.1f} "
            f"{s['duration_hours']:6.2f} {s['checkpoint_count']:4d} "
            f"{s['average_risk']:5.2f} {s['max_level_label']:>9}"
        )
        miles = {k: v for k, v in s["miles_by_level"].items() if v > 0}
        print(f"{'':9} miles by level: {miles}")

    recommendation = payload["recommendation"]
    print(f"\nrecommended: {recommendation['route_id']} ({recommendation['label']})")
    for reason in recommendation["reasons"]:
        print(f"  - {reason}")

    best = next(r for r in payload["routes"] if r["id"] == recommendation["route_id"])
    print(f"\nfirst 5 checkpoints on {best['id']}:")
    for cp in best["checkpoints"][:5]:
        w = cp["weather"]
        print(
            f"  mi {cp['mile']:7.1f}  {cp['eta'][:16]}  "
            f"wind {w['wind_mph']:5.1f}/{w['wind_gust_mph']:5.1f} mph  "
            f"rain {w['rain_in_hr']:.2f}  snow {w['snow_in_hr']:.2f}  "
            f"-> {cp['risk']['label']}"
        )

    started = datetime.now()
    heatmap = build_heatmap(
        CorridorRequest(
            seeds=[tuple(c) for c in best["corridor_seeds"]],
            load_lb=load_lb,
            anchor=departure,
            hours=48,
        )
    )
    elapsed = (datetime.now() - started).total_seconds()
    print(
        f"\nheatmap: {len(heatmap['points'])} points x {len(heatmap['hours'])} hours "
        f"({elapsed:.1f}s)"
    )
    peak = max((max(row) for row in heatmap["risk"]), default=0)
    print(f"peak corridor risk score over the window: {peak}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

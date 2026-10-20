"""Weather risk classification for a loaded truck.

Implements the assignment's risk table and load rules. The thresholds are kept
as explicit bands rather than chained ``if`` statements so the boundary
behaviour is reviewable at a glance and directly testable.

Boundary convention
-------------------
The table is written with integer bands (wind "25-34", "35-44"), which leaves
the real numbers in between undefined. We treat each band as running up to the
start of the next one, and resolve the printed shared endpoints in favour of the
*lower* band exactly as written: rain of 0.25 in/hr is "0.10-0.25" (Moderate),
and only rain above 1.00 is No Travel. Wind is the one metric with an
explicitly open-ended top (">=55"), so 55.0 itself is No Travel.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class RiskLevel(IntEnum):
    """Ordered severity. Integer values double as the score for averaging."""

    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def slug(self) -> str:
        return self.name

    @property
    def label(self) -> str:
        return "No Travel" if self is RiskLevel.NO_TRAVEL else self.name.capitalize()


# (upper_bound, bound_is_inclusive, level); a bound of None closes the scale.
Band = tuple[float | None, bool, RiskLevel]

WIND_BANDS: tuple[Band, ...] = (
    (25.0, False, RiskLevel.LOW),       # < 25 mph
    (35.0, False, RiskLevel.MODERATE),  # 25 - 34
    (45.0, False, RiskLevel.HIGH),      # 35 - 44
    (55.0, False, RiskLevel.SEVERE),    # 45 - 54
    (None, False, RiskLevel.NO_TRAVEL),  # >= 55
)

RAIN_BANDS: tuple[Band, ...] = (
    (0.10, False, RiskLevel.LOW),       # < 0.10 in/hr
    (0.25, True, RiskLevel.MODERATE),   # 0.10 - 0.25
    (0.50, True, RiskLevel.HIGH),       # 0.25 - 0.50
    (1.00, True, RiskLevel.SEVERE),     # 0.50 - 1.00
    (None, False, RiskLevel.NO_TRAVEL),  # > 1.00
)

SNOW_BANDS: tuple[Band, ...] = (
    (0.5, False, RiskLevel.LOW),        # < 0.5 in/hr
    (1.0, True, RiskLevel.MODERATE),    # 0.5 - 1.0
    (2.0, True, RiskLevel.HIGH),        # 1.0 - 2.0
    (3.0, True, RiskLevel.SEVERE),      # 2.0 - 3.0
    (None, False, RiskLevel.NO_TRAVEL),  # > 3.0
)

# Load rules: wind band (lower, upper_exclusive), minimum load, resulting level.
NO_TRAVEL_WIND_MPH = 55.0
HEAVY_LOAD_LB = 30_000.0        # 45-54 mph + >30,000 lb -> No Travel
VERY_HEAVY_LOAD_LB = 40_000.0   # 35-44 mph + >40,000 lb -> Severe


def classify(value: float, bands: tuple[Band, ...]) -> RiskLevel:
    """Map a measurement onto its risk band."""
    for upper, inclusive, level in bands:
        if upper is None:
            return level
        if value < upper or (inclusive and value == upper):
            return level
    return bands[-1][2]


def classify_wind(wind_mph: float) -> RiskLevel:
    return classify(wind_mph, WIND_BANDS)


def classify_rain(rain_in_hr: float) -> RiskLevel:
    return classify(rain_in_hr, RAIN_BANDS)


def classify_snow(snow_in_hr: float) -> RiskLevel:
    return classify(snow_in_hr, SNOW_BANDS)


@dataclass(frozen=True)
class WeatherSample:
    """Forecast values at one checkpoint, already in the risk table's units.

    ``None`` means the provider did not return that field. Missing is not the
    same as 0: calm air is Low risk, but an empty forecast must not be scored.
    """

    wind_mph: float | None = None
    wind_gust_mph: float | None = None
    rain_in_hr: float | None = None
    snow_in_hr: float | None = None
    temperature_f: float | None = None
    visibility_mi: float | None = None
    weather_code: int | None = None

    def has_observation(self) -> bool:
        return any(
            value is not None
            for value in (self.wind_mph, self.wind_gust_mph, self.rain_in_hr, self.snow_in_hr)
        )

    def effective_wind(self, metric: str = "max") -> float | None:
        """Wind figure used for classification.

        Gusts, not sustained wind, are what tip a high-profile trailer, and DOT
        high-wind advisories are issued on gusts - so the default compares both
        and takes the worse. Set ``WIND_RISK_METRIC`` to override.
        """
        if metric == "sustained":
            return self.wind_mph
        if metric == "gust":
            return self.wind_gust_mph if self.wind_gust_mph is not None else self.wind_mph
        values = [value for value in (self.wind_mph, self.wind_gust_mph) if value is not None]
        return max(values) if values else None


@dataclass(frozen=True)
class RiskAssessment:
    """Risk at a single checkpoint, with the reasoning that produced it."""

    level: RiskLevel
    wind: RiskLevel | None
    rain: RiskLevel | None
    snow: RiskLevel | None
    driver: str  # which condition set the overall level
    wind_used_mph: float | None
    reasons: list[str] = field(default_factory=list)
    available: bool = True

    @property
    def score(self) -> int:
        return int(self.level) if self.available else -1


def assess(
    sample: WeatherSample,
    load_lb: float,
    wind_metric: str = "max",
) -> RiskAssessment:
    """Classify one checkpoint, applying the table then the load overrides."""
    if not sample.has_observation():
        return RiskAssessment(
            level=RiskLevel.LOW,
            wind=None,
            rain=None,
            snow=None,
            driver="none",
            wind_used_mph=None,
            reasons=["Weather data unavailable at this checkpoint; risk was not scored as Low."],
            available=False,
        )

    wind_mph = sample.effective_wind(wind_metric)
    wind_level = classify_wind(wind_mph) if wind_mph is not None else None
    rain_level = classify_rain(sample.rain_in_hr) if sample.rain_in_hr is not None else None
    snow_level = classify_snow(sample.snow_in_hr) if sample.snow_in_hr is not None else None

    reasons: list[str] = []

    # --- Load rules escalate the wind classification -----------------------
    if wind_mph is not None:
        if wind_mph >= NO_TRAVEL_WIND_MPH:
            wind_level = RiskLevel.NO_TRAVEL
            reasons.append(f"Wind {wind_mph:.0f} mph is at or above 55 mph - No Travel for any load")
        elif 45.0 <= wind_mph < NO_TRAVEL_WIND_MPH and load_lb > HEAVY_LOAD_LB:
            wind_level = RiskLevel.NO_TRAVEL
            reasons.append(
                f"Wind {wind_mph:.0f} mph (45-54) with a {load_lb:,.0f} lb load "
                f"over 30,000 lb - No Travel"
            )
        elif 35.0 <= wind_mph < 45.0 and load_lb > VERY_HEAVY_LOAD_LB:
            wind_level = RiskLevel.SEVERE
            reasons.append(
                f"Wind {wind_mph:.0f} mph (35-44) with a {load_lb:,.0f} lb load "
                f"over 40,000 lb - escalated to Severe"
            )

    components = {
        name: level
        for name, level in (("wind", wind_level), ("rain", rain_level), ("snow", snow_level))
        if level is not None
    }
    if not components:
        return RiskAssessment(
            level=RiskLevel.LOW,
            wind=wind_level,
            rain=rain_level,
            snow=snow_level,
            driver="none",
            wind_used_mph=None if wind_mph is None else round(wind_mph, 1),
            reasons=["Weather data unavailable at this checkpoint; risk was not scored as Low."],
            available=False,
        )

    level = max(components.values())
    # Ties resolve to wind, then rain, then snow - wind is the condition the
    # load rules act on, so it is the most useful thing to surface.
    driver = next(name for name in ("wind", "rain", "snow") if components.get(name) == level)

    if not reasons and level > RiskLevel.LOW:
        if driver == "wind" and wind_mph is not None:
            reasons.append(f"Wind {wind_mph:.0f} mph - {level.label}")
        elif driver == "rain" and sample.rain_in_hr is not None:
            reasons.append(f"Rain {sample.rain_in_hr:.2f} in/hr - {level.label}")
        elif sample.snow_in_hr is not None:
            reasons.append(f"Snow {sample.snow_in_hr:.2f} in/hr - {level.label}")

    # Mention secondary conditions that are also elevated.
    for name, value, unit in (
        ("Rain", sample.rain_in_hr, "in/hr"),
        ("Snow", sample.snow_in_hr, "in/hr"),
    ):
        comp = components.get(name.lower())
        if value is not None and comp is not None and comp > RiskLevel.LOW and name.lower() != driver:
            reasons.append(f"{name} {value:.2f} {unit} - {comp.label}")

    return RiskAssessment(
        level=level,
        wind=wind_level,
        rain=rain_level,
        snow=snow_level,
        driver=driver,
        wind_used_mph=None if wind_mph is None else round(wind_mph, 1),
        reasons=reasons,
    )


def assess_score(
    wind_mph: float | None,
    wind_gust_mph: float | None,
    rain_in_hr: float | None,
    snow_in_hr: float | None,
    load_lb: float,
    wind_metric: str = "max",
) -> int:
    """Fast path returning only the numeric level, used for the heatmap grid.

    Returns -1 when the sample has no observations so callers do not paint
    missing weather as Low.
    """
    sample = WeatherSample(
        wind_mph=wind_mph,
        wind_gust_mph=wind_gust_mph,
        rain_in_hr=rain_in_hr,
        snow_in_hr=snow_in_hr,
    )
    result = assess(sample, load_lb, wind_metric)
    return result.score if result.available else -1


def describe_rules() -> dict:
    """Machine-readable copy of the rules, served to the UI for its legend."""

    def render(bands: tuple[Band, ...], unit: str) -> list[dict]:
        out = []
        lower: float | None = 0.0
        for upper, inclusive, level in bands:
            out.append(
                {
                    "level": level.slug,
                    "label": level.label,
                    "min": lower,
                    "max": upper,
                    "max_inclusive": inclusive,
                    "unit": unit,
                }
            )
            lower = upper
        return out

    return {
        "levels": [{"slug": lvl.slug, "label": lvl.label, "score": int(lvl)} for lvl in RiskLevel],
        "wind": render(WIND_BANDS, "mph"),
        "rain": render(RAIN_BANDS, "in/hr"),
        "snow": render(SNOW_BANDS, "in/hr"),
        "load_rules": [
            {"condition": "Wind >= 55 mph", "load_lb": None, "result": RiskLevel.NO_TRAVEL.slug},
            {"condition": "Wind 45-54 mph", "load_lb": "> 30,000", "result": RiskLevel.NO_TRAVEL.slug},
            {"condition": "Wind 35-44 mph", "load_lb": "> 40,000", "result": RiskLevel.SEVERE.slug},
        ],
    }

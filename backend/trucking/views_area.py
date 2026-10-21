"""Hourly corridor weather rasters served as PNGs."""

from __future__ import annotations

from django.http import HttpResponse

from .weather.raster import get_cached


def area_weather_png(request, cache_id: str, hour):
    bundle = get_cached(cache_id)
    if bundle is None:
        return HttpResponse(b"", status=404, content_type="image/png")
    metric = (request.GET.get("metric") or "risk").lower()
    png = bundle.png(int(hour), metric)
    response = HttpResponse(png, content_type="image/png")
    response["Cache-Control"] = "public, max-age=120"
    return response

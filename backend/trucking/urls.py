from django.urls import path, re_path

from . import views
from . import views_area

urlpatterns = [
    path("health/", views.health, name="health"),
    path("rules/", views.rules, name="rules"),
    path("geocode/", views.geocode, name="geocode"),
    path("plan/", views.plan, name="plan"),
    path("corridor/", views.corridor, name="corridor"),
    re_path(
        r"^area-weather/(?P<cache_id>[^/]+)/(?P<hour>\d+)\.png$",
        views_area.area_weather_png,
        name="area-weather",
    ),
    path("weather-map/", views.weather_map, name="weather-map"),
    path("weather/point/", views.weather_point, name="weather-point"),
]

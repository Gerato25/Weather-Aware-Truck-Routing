from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("rules/", views.rules, name="rules"),
    path("geocode/", views.geocode, name="geocode"),
    path("plan/", views.plan, name="plan"),
    path("corridor/", views.corridor, name="corridor"),
    path("weather-map/", views.weather_map, name="weather-map"),
    path("weather/point/", views.weather_point, name="weather-point"),
]

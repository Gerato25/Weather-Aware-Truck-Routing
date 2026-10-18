"""Django settings for the weather-aware truck routing API."""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "*")

# Render injects the public hostname; honour it so a missed ALLOWED_HOSTS
# env var does not 400 the health check after a first deploy.
_render_host = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()
if _render_host and _render_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_render_host)

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "trucking",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

# The service is entirely stateless: routes and forecasts come from upstream APIs
# and are held in the cache, so no relational database is configured.
DATABASES = {}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "trucking-cache",
        "TIMEOUT": 600,
        "OPTIONS": {"MAX_ENTRIES": 20000},
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Production serves the Vite build from this folder via WhiteNoise so a single
# web process hosts both the API and the UI.
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"
WHITENOISE_INDEX_FILE = True
WHITENOISE_MAX_AGE = 60 * 60 * 24 * 30
if FRONTEND_DIST.exists():
    WHITENOISE_ROOT = FRONTEND_DIST

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        # The manifest variant needs collectstatic to have run, which is only
        # true for a built deployment.
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
        if DEBUG
        else "whitenoise.storage.CompressedStaticFilesStorage"
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "trucking.views.api_exception_handler",
}
if DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"].append(
        "rest_framework.renderers.BrowsableAPIRenderer"
    )

CORS_ALLOW_ALL_ORIGINS = env_bool("CORS_ALLOW_ALL_ORIGINS", True)
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "%(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "simple"}},
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
}

# --- Third-party routing / weather providers -------------------------------
# OpenRouteService is preferred because it exposes a real heavy-goods-vehicle
# profile (axle load, weight, height restrictions). When no key is configured we
# fall back to the public OSRM demo server, which only knows a car profile.
OPENROUTESERVICE_API_KEY = os.getenv("OPENROUTESERVICE_API_KEY", "").strip()
OPENROUTESERVICE_BASE_URL = os.getenv(
    "OPENROUTESERVICE_BASE_URL", "https://api.openrouteservice.org"
)
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org")
NOMINATIM_BASE_URL = os.getenv("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")
OPEN_METEO_BASE_URL = os.getenv("OPEN_METEO_BASE_URL", "https://api.open-meteo.com/v1/forecast")

# Nominatim's usage policy requires a contactable User-Agent.
USER_AGENT = os.getenv("USER_AGENT", "weather-aware-truck-routing/1.0 (+https://github.com/)")

HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))
WEATHER_BATCH_SIZE = int(os.getenv("WEATHER_BATCH_SIZE", "40"))
WEATHER_MAX_WORKERS = int(os.getenv("WEATHER_MAX_WORKERS", "1"))
WEATHER_MIN_INTERVAL_SECONDS = float(os.getenv("WEATHER_MIN_INTERVAL_SECONDS", "0.4"))
WEATHER_CACHE_SECONDS = int(os.getenv("WEATHER_CACHE_SECONDS", "900"))
ROUTE_CACHE_SECONDS = int(os.getenv("ROUTE_CACHE_SECONDS", "3600"))

# Which wind figure drives the risk table. Gusts are what actually overturn a
# high-profile trailer, so "max" (worse of sustained and gust) is the default.
WIND_RISK_METRIC = os.getenv("WIND_RISK_METRIC", "max")  # max | gust | sustained

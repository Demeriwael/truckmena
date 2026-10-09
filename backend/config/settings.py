"""Environment-driven settings for the stateless trip planner."""

import os
import secrets
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", override=False)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    if value not in {"true", "false", "1", "0"}:
        raise ImproperlyConfigured(f"{name} must be true or false")
    return value in {"true", "1"}


def env_list(name: str, default: str) -> list[str]:
    return [
        item.strip() for item in (os.getenv(name) or default).split(",") if item.strip()
    ]


DEBUG = env_bool("DJANGO_DEBUG", default=True)
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "").strip()
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when DJANGO_DEBUG=false")
    SECRET_KEY = secrets.token_urlsafe(50)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "trips",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
]
DATABASES = {}
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "eld-trip-planner",
        "TIMEOUT": 24 * 60 * 60,
        "OPTIONS": {"MAX_ENTRIES": 4096},
    }
}
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "EXCEPTION_HANDLER": "trips.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"autocomplete": "60/min", "plan": "10/min"},
}
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
CORS_URLS_REGEX = r"^/api/.*$"
APPEND_SLASH = False
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# collectstatic writes deployment assets to this directory.
WHITENOISE_USE_FINDERS = DEBUG
DATA_UPLOAD_MAX_MEMORY_SIZE = 32 * 1024
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

ORS_API_KEY = os.getenv("ORS_API_KEY", "").strip()
ORS_BASE_URL = (os.getenv("ORS_BASE_URL") or "https://api.openrouteservice.org").rstrip(
    "/"
)
OSRM_BASE_URL = (
    os.getenv("OSRM_BASE_URL") or "https://router.project-osrm.org"
).rstrip("/")
NOMINATIM_BASE_URL = (
    os.getenv("NOMINATIM_BASE_URL") or "https://nominatim.openstreetmap.org"
).rstrip("/")
NOMINATIM_ENABLED = env_bool("NOMINATIM_ENABLED")
GEOCODING_USER_AGENT = os.getenv("GEOCODING_USER_AGENT", "").strip()
if NOMINATIM_ENABLED and not GEOCODING_USER_AGENT:
    raise ImproperlyConfigured("Set GEOCODING_USER_AGENT before enabling Nominatim")
PROVIDER_TIMEOUT = (3.05, 12)
PROVIDER_CACHE_SECONDS = 24 * 60 * 60
PROVIDER_FAILURE_SECONDS = 30
REVERSE_LOOKUP_BUDGET = 8

"""Isolated test configuration: no secrets, external services, or database."""

from config.settings import *  # noqa: F403

DEBUG = False
SECRET_KEY = "test-only-key-never-used-for-deployment"
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
ORS_API_KEY = ""
NOMINATIM_ENABLED = False
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": []}  # noqa: F405
WHITENOISE_USE_FINDERS = True
STATIC_ROOT = None

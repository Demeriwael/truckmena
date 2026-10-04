"""HTTPS deployment behind a trusted host proxy; no development defaults."""

import os
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

from config.settings import *  # noqa: F403

if DEBUG:  # noqa: F405
    raise ImproperlyConfigured("Set DJANGO_DEBUG=false for production")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "")  # noqa: F405
render_hostname = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()
if render_hostname and render_hostname not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(render_hostname)
if not ALLOWED_HOSTS or any(
    "*" in host or host.startswith(".") or "/" in host or ":" in host
    for host in ALLOWED_HOSTS
):
    raise ImproperlyConfigured("Set explicit production hostnames without schemes")

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "")  # noqa: F405
for origin in CORS_ALLOWED_ORIGINS:
    parsed = urlsplit(origin)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
        or "*" in origin
    ):
        raise ImproperlyConfigured("CORS_ALLOWED_ORIGINS must contain HTTPS origins")

# Enable only when the host's ingress overwrites the forwarded protocol header.
SECURE_PROXY_SSL_HEADER = (
    ("HTTP_X_FORWARDED_PROTO", "https")
    if env_bool("DJANGO_TRUST_PROXY")  # noqa: F405
    else None
)
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 3600
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
    }
}
WHITENOISE_USE_FINDERS = False
# Anonymous JSON endpoints use no cookies, sessions, or authentication. Add CSRF
# middleware before introducing cookie-based authentication or browser forms.
# HSTS deliberately covers this hostname for one hour, without subdomain or
# browser-preload commitments for an assessment service on shared hosting.
SILENCED_SYSTEM_CHECKS = ["security.W003", "security.W005", "security.W021"]

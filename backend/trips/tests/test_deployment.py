"""Load real production settings in fresh, environment-isolated interpreters."""

import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
PRELUDE = """
from unittest.mock import patch
with patch("dotenv.load_dotenv"):
    import django
    django.setup()
"""
PROBE = """
import io
import json
import os
from pathlib import Path
from django.conf import settings
from django.core.management import call_command
from django.test import Client

settings.STATIC_ROOT = Path(os.environ["PROBE_STATIC_ROOT"])
settings.STATIC_ROOT.mkdir(exist_ok=True)
(settings.STATIC_ROOT / "probe.txt").write_text("static probe", encoding="utf-8")
call_command("check", deploy=True, fail_level="WARNING", stdout=io.StringIO())
client = Client(HTTP_HOST="api.example.invalid")
health = client.get("/api/health", HTTP_X_FORWARDED_PROTO="https",
                    HTTP_ORIGIN="https://frontend.example.invalid")
redirect = client.get("/api/health")
preflight = client.options("/api/trips/plan", HTTP_X_FORWARDED_PROTO="https",
    HTTP_ORIGIN="https://frontend.example.invalid",
    HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
    HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type")
blocked = client.get("/api/health", HTTP_X_FORWARDED_PROTO="https",
    HTTP_ORIGIN="https://untrusted.example.invalid")
unknown_host = client.get("/api/health", HTTP_X_FORWARDED_PROTO="https",
    HTTP_HOST="untrusted.example.invalid")
static = client.get("/static/probe.txt", HTTP_X_FORWARDED_PROTO="https")
print(json.dumps({
    "hosts": settings.ALLOWED_HOSTS,
    "health": health.status_code,
    "body": health.json(),
    "cors": health.get("Access-Control-Allow-Origin"),
    "preflight": preflight.get("Access-Control-Allow-Origin"),
    "blocked_cors": blocked.get("Access-Control-Allow-Origin"),
    "redirect": redirect.status_code,
    "redirect_url": redirect.get("Location"),
    "hsts": health.get("Strict-Transport-Security"),
    "frame": health.get("X-Frame-Options"),
    "nosniff": health.get("X-Content-Type-Options"),
    "database_engines": [item["ENGINE"] for item in settings.DATABASES.values()],
    "unknown_host": unknown_host.status_code,
    "static": static.status_code,
    "static_body": b"".join(static.streaming_content).decode(),
}))
"""


@pytest.fixture
def deployment_env(tmp_path):
    # Do not inherit owner credentials or load the ignored local environment file.
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() in {"PATH", "SYSTEMROOT", "TEMP", "TMP", "LANG"}
    }
    return {
        **environment,
        "DJANGO_SETTINGS_MODULE": "config.production_settings",
        "DJANGO_DEBUG": "false",
        "DJANGO_SECRET_KEY": secrets.token_urlsafe(50),
        "RENDER_EXTERNAL_HOSTNAME": "api.example.invalid",
        "CORS_ALLOWED_ORIGINS": "https://frontend.example.invalid",
        "DJANGO_TRUST_PROXY": "true",
        "ORS_API_KEY": "",
        "PROBE_STATIC_ROOT": str(tmp_path / "static"),
    }


def production_process(environment, code=""):
    return subprocess.run(
        [sys.executable, "-c", PRELUDE + code],
        cwd=BACKEND,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


@pytest.mark.parametrize("origin", ["https://frontend.example.invalid", ""])
def test_production_health_https_headers_and_exact_cors(deployment_env, origin):
    deployment_env["CORS_ALLOWED_ORIGINS"] = origin
    result = production_process(deployment_env, PROBE)
    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout)
    assert response["hosts"] == ["api.example.invalid"]
    assert response["health"] == 200
    assert response["body"] == {"status": "ok", "service": "eld-trip-planner"}
    assert response["cors"] == (origin or None)
    assert response["preflight"] == (origin or None)
    assert response["blocked_cors"] is None
    assert response["redirect"] == 301
    assert response["redirect_url"] == "https://api.example.invalid/api/health"
    assert response["hsts"] == "max-age=3600"
    assert response["frame"] == "DENY"
    assert response["nosniff"] == "nosniff"
    # Django's checks initialize the empty database config with its dummy backend.
    assert response["database_engines"] == ["django.db.backends.dummy"]
    assert response["unknown_host"] == 400
    assert response["static"] == 200
    assert response["static_body"] == "static probe"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"DJANGO_DEBUG": "true"}, "DJANGO_DEBUG=false"),
        ({"DJANGO_SECRET_KEY": ""}, "Set DJANGO_SECRET_KEY"),
        ({"DJANGO_ALLOWED_HOSTS": "*"}, "explicit production hostnames"),
        ({"RENDER_EXTERNAL_HOSTNAME": ""}, "explicit production hostnames"),
        ({"CORS_ALLOWED_ORIGINS": "http://frontend.example.invalid"}, "HTTPS origins"),
        (
            {"CORS_ALLOWED_ORIGINS": "https://frontend.example.invalid/app"},
            "HTTPS origins",
        ),
        ({"DJANGO_TRUST_PROXY": "maybe"}, "must be true or false"),
    ],
)
def test_invalid_production_configuration_stops_startup(
    deployment_env, overrides, message
):
    result = production_process({**deployment_env, **overrides})
    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr
    assert message in result.stderr


def test_forwarded_scheme_requires_explicit_proxy_trust(deployment_env):
    result = production_process(
        {**deployment_env, "DJANGO_TRUST_PROXY": "false"},
        """
from django.test import Client
response = Client(HTTP_HOST="api.example.invalid").get(
    "/api/health", HTTP_X_FORWARDED_PROTO="https")
assert response.status_code == 301
""",
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(sys.platform == "win32", reason="Gunicorn runs on the Linux host")
def test_linux_gunicorn_loads_production_application(deployment_env):
    result = production_process(
        deployment_env,
        """
import sys
from django.conf import settings
settings.STATIC_ROOT.mkdir(exist_ok=True)
from gunicorn.app.wsgiapp import run
sys.argv = ["gunicorn", "config.wsgi:application", "--check-config",
            "--config", "gunicorn.conf.py"]
run()
""",
    )
    assert result.returncode == 0, result.stderr

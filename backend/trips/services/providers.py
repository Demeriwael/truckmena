"""Bounded HTTP and provider caching without logging sensitive requests."""

import hashlib
import json
import math
from decimal import Decimal, InvalidOperation
from threading import Lock
from time import monotonic, sleep

import requests
from django.conf import settings
from django.core.cache import cache


class ProviderFailure(Exception):
    def __init__(self, status: int = 0, code: int | str | None = None):
        super().__init__("Provider request failed")
        self.status = status
        self.code = code


def cache_key(kind: str, *parts: object) -> str:
    digest = hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()
    return f"{kind}:v1:{digest}"


def decimal_number(value: object) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError("Invalid provider number")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ValueError("Invalid provider number") from None
    if not number.is_finite() or number < 0:
        raise ValueError("Invalid provider number")
    return number


def coordinates(value: object) -> tuple[float, float]:
    """Validate GeoJSON [lng, lat] and return the app's (lat, lng) ordering."""
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        raise ValueError("Invalid provider coordinates")
    if any(isinstance(item, bool) for item in value[:2]):
        raise ValueError("Invalid provider coordinates")
    lng, lat = float(value[0]), float(value[1])
    if not math.isfinite(lat) or not math.isfinite(lng):
        raise ValueError("Invalid provider coordinates")
    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise ValueError("Invalid provider coordinates")
    return lat, lng


def request_json(method: str, url: str, **kwargs: object) -> dict | list:
    """No redirects or retries; exceptions never carry request URLs to the API."""
    try:
        with requests.request(
            method,
            url,
            timeout=settings.PROVIDER_TIMEOUT,
            allow_redirects=False,
            stream=True,
            **kwargs,
        ) as response:
            if response.status_code not in (200, 400, 404):
                raise ProviderFailure(response.status_code)
            chunks = bytearray()
            for chunk in response.iter_content(chunk_size=64 * 1024):
                chunks.extend(chunk)
                if len(chunks) > 8 * 1024 * 1024:
                    raise ProviderFailure()
            try:
                payload = json.loads(chunks)
            except ValueError:
                raise ProviderFailure(response.status_code) from None
            if response.status_code != 200:
                # ORS distinguishes no-route (2010/2009) from transient failures.
                error = payload.get("error", {}) if isinstance(payload, dict) else {}
                code = error.get("code") if isinstance(error, dict) else None
                raise ProviderFailure(response.status_code, code)
            if not isinstance(payload, (dict, list)):
                raise ProviderFailure()
            return payload
    except (requests.RequestException, ValueError):
        raise ProviderFailure() from None


class RequestGate:
    """Serialize starts AND completions, preserving an application-wide interval.

    This gate is per process: public Nominatim requires one worker/one replica.
    A busy gate is skipped rather than building an unbounded request queue.
    """

    def __init__(self, interval: float):
        self.interval = interval
        self.lock = Lock()
        self.last_start = -math.inf

    def request(self, method: str, url: str, **kwargs: object) -> dict | list:
        return self.call(request_json, method, url, **kwargs)

    def call(self, function, *args, **kwargs) -> dict | list:
        if not self.lock.acquire(timeout=2):
            raise ProviderFailure()
        try:
            sleep(max(0, self.interval - (monotonic() - self.last_start)))
            self.last_start = monotonic()
            return function(*args, **kwargs)
        finally:
            self.lock.release()


nominatim_gate = RequestGate(1.1)
osrm_gate = RequestGate(1.1)
reverse_gate = RequestGate(0.25)


def ors_request(method: str, path: str, **kwargs: object) -> dict | list:
    """Keep the ORS token out of URLs, including geocoder GET requests."""
    if not settings.ORS_API_KEY:
        raise ProviderFailure()
    failure_key = cache_key("ors-cooldown", settings.ORS_BASE_URL)
    if cache.get(failure_key):
        raise ProviderFailure()
    try:
        return request_json(
            method,
            settings.ORS_BASE_URL + path,
            headers={"Authorization": settings.ORS_API_KEY},
            **kwargs,
        )
    except ProviderFailure as error:
        if error.status in (0, 401, 403, 429) or error.status >= 500:
            cache.set(failure_key, True, settings.PROVIDER_FAILURE_SECONDS)
        raise

"""Network-isolated fixtures; provider tests exercise the real service parsers."""

import json
from dataclasses import dataclass, field
from decimal import Decimal

import pytest
import requests
from django.core.cache import cache
from rest_framework.test import APIClient

from trips.services import providers


@pytest.fixture(autouse=True)
def isolated_providers(monkeypatch):
    cache.clear()

    def forbidden(*args, **kwargs):
        raise AssertionError("Tests must never contact an external provider")

    monkeypatch.setattr(requests, "request", forbidden)
    monkeypatch.setattr(providers, "sleep", lambda seconds: None)
    yield
    cache.clear()


class ResponseStub:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status_code = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def json(self):
        return self.payload

    def iter_content(self, chunk_size):
        yield json.dumps(self.payload).encode()


@dataclass
class HTTPStub:
    responses: list = field(default_factory=list)
    calls: list = field(default_factory=list)

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if not self.responses:
            raise AssertionError("Unexpected provider request")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return (
            response if isinstance(response, ResponseStub) else ResponseStub(response)
        )


@pytest.fixture
def http_stub(monkeypatch, settings):
    settings.ORS_API_KEY = "provider-test-credential"
    stub = HTTPStub()
    monkeypatch.setattr(requests, "request", stub.request)
    return stub


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def trip_input():
    return {
        "current_location": {"label": "Current", "lat": 0, "lng": 0},
        "pickup_location": {"label": "Pickup", "lat": 1, "lng": 1},
        "dropoff_location": {"label": "Dropoff", "lat": 1, "lng": 4},
        "cycle_used_hours": 0,
        "start_time": "2026-10-03T08:00:00-05:00",
    }


@pytest.fixture
def ors_payload():
    def make(miles=(110, 55), *, zero_first=False):
        points = [[0, 0], [1, 0], [1, 1], [3, 1], [4, 1]]
        indices = [0, 2, 4]
        if zero_first:
            points = [[1, 1], [3, 1], [4, 1]]
            indices = [0, 0, 2]
        return {
            "features": [
                {
                    "geometry": {"type": "LineString", "coordinates": points},
                    "properties": {
                        "way_points": indices,
                        "segments": [
                            {
                                "distance": str(
                                    Decimal(str(distance)) * Decimal("1609.344")
                                ),
                                # Intentionally different from the HOS planning speed.
                                "duration": 60,
                            }
                            for distance in miles
                        ],
                    },
                }
            ],
        }

    return make


@pytest.fixture
def osrm_payload():
    points = [[0, 0], [1, 0], [1, 1], [3, 1], [4, 1]]
    return {
        "code": "Ok",
        "routes": [
            {
                "geometry": {"type": "LineString", "coordinates": points},
                "legs": [
                    {
                        "distance": distance,
                        "duration": 60,
                        "steps": [
                            {
                                "geometry": {
                                    "type": "LineString",
                                    "coordinates": geometry,
                                }
                            }
                        ],
                    }
                    for distance, geometry in (
                        (177027.84, points[:3]),
                        (88513.92, points[2:]),
                    )
                ],
            }
        ],
    }

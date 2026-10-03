"""Caching, policy-safe fallback, reverse pacing, and graceful degradation."""

import pytest
import requests

from trips.exceptions import AddressNotFound, ProviderUnavailable
from trips.services.geocoding import autocomplete, resolve_location, reverse_place
from trips.tests.conftest import ResponseStub


def feature(label="Chicago, IL", point=(-87.63, 41.88), **properties):
    return {
        "features": [
            {
                "geometry": {"coordinates": point},
                "properties": {"label": label, **properties},
            }
        ]
    }


def test_autocomplete_minimum_and_normalized_cache(http_stub):
    assert autocomplete("ch") == []
    http_stub.responses.append(feature())
    result = autocomplete(" Chicago   IL ")
    assert result == [{"label": "Chicago, IL", "lat": 41.88, "lng": -87.63}]
    assert autocomplete("chicago il") == result
    assert len(http_stub.calls) == 1
    assert http_stub.calls[0][2]["params"] == {"text": "Chicago IL"}


def test_autocomplete_never_falls_back_to_public_nominatim(http_stub, settings):
    settings.NOMINATIM_ENABLED = True
    settings.GEOCODING_USER_AGENT = "test-planner/1 (https://example.com/contact)"
    http_stub.responses.append(ResponseStub({}, 429))
    with pytest.raises(ProviderUnavailable):
        autocomplete("Chicago")
    assert len(http_stub.calls) == 1
    assert "openrouteservice" in http_stub.calls[0][1]


def test_empty_suggestions_are_cached(http_stub):
    http_stub.responses.append({"features": []})
    assert autocomplete("nothing") == autocomplete("nothing") == []
    assert len(http_stub.calls) == 1


def test_selected_coordinates_skip_forward_geocoding(http_stub):
    assert resolve_location({"label": "Selected", "lat": 1, "lng": 2}).point == (1, 2)
    assert http_stub.calls == []


def test_submitted_address_uses_search_and_cache(http_stub):
    http_stub.responses.append(feature())
    location = resolve_location({"label": "Chicago IL"})
    assert location.label == "Chicago, IL"
    assert resolve_location({"label": "chicago il"}) == location
    assert len(http_stub.calls) == 1 and http_stub.calls[0][1].endswith(
        "/geocode/search"
    )


def test_no_address_is_a_client_error(http_stub):
    http_stub.responses.append({"features": []})
    with pytest.raises(AddressNotFound):
        resolve_location({"label": "Nonexistent address"})


def test_nominatim_requires_explicit_opt_in(http_stub):
    http_stub.responses.append(ResponseStub({}, 503))
    with pytest.raises(ProviderUnavailable):
        resolve_location({"label": "Chicago IL"})
    assert len(http_stub.calls) == 1


def test_full_address_fallback_is_identified_and_cached(http_stub, settings):
    settings.NOMINATIM_ENABLED = True
    settings.GEOCODING_USER_AGENT = "test-planner/1 (https://example.com/contact)"
    http_stub.responses.extend(
        [
            ResponseStub({}, 429),
            [
                {
                    "display_name": "Chicago, Illinois",
                    "lat": "41.88",
                    "lon": "-87.63",
                }
            ],
        ]
    )
    location = resolve_location({"label": "Chicago IL"})
    assert location.label == "Chicago, Illinois"
    assert resolve_location({"label": "Chicago IL"}) == location
    method, url, kwargs = http_stub.calls[-1]
    assert method == "GET" and url.endswith("/search")
    assert kwargs["headers"] == {"User-Agent": settings.GEOCODING_USER_AGENT}
    assert "credential" not in url


def test_reverse_returns_city_region_and_caches_nearby_points(http_stub):
    http_stub.responses.append(feature(locality="Chicago", region_a="IL"))
    assert reverse_place(41.88001, -87.63001, "Mile 10 on route") == "Chicago, IL"
    assert reverse_place(41.88002, -87.63002, "different fallback") == "Chicago, IL"
    assert len(http_stub.calls) == 1


@pytest.mark.parametrize(
    "payload", [ResponseStub({}, 429), {"features": []}, requests.Timeout("sensitive")]
)
def test_reverse_failure_preserves_fallback_and_caches_failure(http_stub, payload):
    http_stub.responses.append(payload)
    assert reverse_place(1, 2, "Mile 5 on route") == "Mile 5 on route"
    assert reverse_place(1, 2, "Mile 6 on route") == "Mile 6 on route"
    assert len(http_stub.calls) == 1


def test_ors_cooldown_prevents_repeated_requests_after_quota_failure(http_stub):
    http_stub.responses.append(ResponseStub({}, 429))
    with pytest.raises(ProviderUnavailable):
        autocomplete("Chicago")
    assert reverse_place(1, 2, "Mile 5 on route") == "Mile 5 on route"
    with pytest.raises(ProviderUnavailable):
        autocomplete("Dallas")
    assert len(http_stub.calls) == 1

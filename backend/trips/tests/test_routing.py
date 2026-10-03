"""Provider distances, single-call routing, fallback, and polyline boundaries."""

from decimal import Decimal
from fractions import Fraction

import pytest
import requests

from trips.exceptions import NoRoute, ProviderUnavailable
from trips.services.providers import (
    ProviderFailure,
    RequestGate,
    decimal_number,
    request_json,
)
from trips.services.routing import (
    Location,
    Route,
    RoutedLeg,
    RoutePositionIndex,
    decode_polyline,
    get_route,
    haversine_meters,
)
from trips.tests.conftest import ResponseStub


def locations():
    return (
        Location("Current", 0, 0),
        Location("Pickup", 1, 1),
        Location("Dropoff", 1, 4),
    )


def test_ors_uses_one_hgv_request_with_three_waypoints_and_caches(
    http_stub, ors_payload
):
    http_stub.responses.append(ors_payload((110.125, 55.375)))
    route = get_route(locations())
    assert route.miles == Fraction("165.5")
    assert route.geometry[2] == (1, 1)
    assert route.legs[0].geometry[-1] == route.legs[1].geometry[0]
    assert get_route(locations()) == route
    assert len(http_stub.calls) == 1
    method, url, kwargs = http_stub.calls[0]
    assert method == "POST" and url.endswith("/directions/driving-hgv/geojson")
    assert kwargs["json"]["coordinates"] == [[0, 0], [1, 1], [4, 1]]
    assert kwargs["headers"]["Authorization"] == "provider-test-credential"
    assert "credential" not in url
    assert kwargs["allow_redirects"] is False
    assert kwargs["timeout"] == (3.05, 12)


@pytest.mark.parametrize(
    "failure",
    [
        requests.Timeout("private upstream text"),
        ResponseStub({}, 429),
        ResponseStub({}, 503),
        ResponseStub({"features": []}),
    ],
)
def test_transient_or_malformed_ors_falls_back_with_warning(
    http_stub, osrm_payload, failure
):
    http_stub.responses.extend([failure, osrm_payload])
    route = get_route(locations())
    assert route.provider == "osrm" and route.miles == 165
    assert "car profile" in route.warnings[0]
    assert len(http_stub.calls) == 2
    assert http_stub.calls[1][2]["params"]["steps"] == "true"
    assert "Authorization" not in http_stub.calls[1][2]["headers"]


@pytest.mark.parametrize("code", [2009, 2010])
def test_ors_no_route_does_not_hide_error_with_car_routing(http_stub, code):
    http_stub.responses.append(ResponseStub({"error": {"code": code}}, 404))
    with pytest.raises(NoRoute):
        get_route(locations())
    assert len(http_stub.calls) == 1


def test_osrm_no_route_is_a_clear_client_error(http_stub):
    http_stub.responses.extend([ResponseStub({}, 503), {"code": "NoRoute"}])
    with pytest.raises(NoRoute):
        get_route(locations())


def test_both_providers_down_raise_safe_error(http_stub):
    http_stub.responses.extend(
        [requests.Timeout("sensitive"), requests.Timeout("sensitive")]
    )
    with pytest.raises(ProviderUnavailable) as caught:
        get_route(locations())
    assert "sensitive" not in str(caught.value)


def test_missing_key_skips_ors_and_uses_osrm(http_stub, settings, osrm_payload):
    settings.ORS_API_KEY = ""
    http_stub.responses.append(osrm_payload)
    assert get_route(locations()).provider == "osrm"
    assert len(http_stub.calls) == 1


def test_duplicate_current_pickup_stays_zero_length(http_stub, ors_payload):
    http_stub.responses.append(ors_payload((0, 55), zero_first=True))
    inputs = (Location("Current", 1, 1), *locations()[1:])
    route = get_route(inputs)
    assert route.legs[0].miles == 0
    assert RoutePositionIndex(route).at(Fraction(0)) == (1, 1)


def test_corrupt_unbounded_provider_distance_is_rejected_before_scheduling(
    http_stub, ors_payload, osrm_payload
):
    payload = ors_payload()
    payload["features"][0]["properties"]["segments"][0]["distance"] = "1e100"
    http_stub.responses.extend([payload, osrm_payload])
    assert get_route(locations()).provider == "osrm"


def test_position_index_scales_each_leg_instead_of_whole_route(http_stub, ors_payload):
    http_stub.responses.append(ors_payload((10, 1000)))
    route = get_route(locations())
    index = RoutePositionIndex(route)
    assert index.at(Fraction(0)) == (0, 0)
    assert index.at(Fraction(10)) == (1, 1)
    assert index.at(route.miles) == (1, 4)
    lat, lng = index.at(Fraction(510))
    assert lat == 1 and lng == pytest.approx(2.5, abs=0.001)
    with pytest.raises(ValueError):
        index.at(route.miles + 1)


def test_position_index_handles_repeated_points_and_date_line():
    first = RoutedLeg(Decimal("1609.344"), Decimal(1), ((0, 179), (0, 179), (0, -179)))
    second = RoutedLeg(Decimal("1609.344"), Decimal(1), ((0, -179), (0, -178)))
    index = RoutePositionIndex(
        Route(first.geometry + second.geometry[1:], (first, second), "ors")
    )
    assert index.at(Fraction(1, 2)) == (0, -180)
    assert haversine_meters((0, 0), (0, 1)) == pytest.approx(111195, abs=1)


def test_decode_standard_polyline():
    assert decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == (
        (38.5, -120.2),
        (40.7, -120.95),
        (43.252, -126.453),
    )


@pytest.mark.parametrize("value", ["", "_", "~~~~~~~~~~~", "a\x01"])
def test_reject_truncated_or_invalid_polyline(value):
    with pytest.raises(ValueError):
        decode_polyline(value)


@pytest.mark.parametrize("number", [True, "NaN", "Infinity", -1, None, "words"])
def test_reject_invalid_provider_distances(number):
    with pytest.raises(ValueError):
        decimal_number(number)


def test_gate_paces_starts_without_an_actual_sleep(monkeypatch):
    from trips.services import providers

    sleeps = []
    times = iter([10.0, 10.0, 10.2, 11.1])
    monkeypatch.setattr(providers, "monotonic", lambda: next(times))
    monkeypatch.setattr(providers, "sleep", sleeps.append)
    gate = RequestGate(1.1)
    assert gate.call(lambda: {"ok": True}) == {"ok": True}
    gate.call(lambda: {})
    assert sleeps == pytest.approx([0, 0.9])


def test_http_rejects_scalar_json(http_stub):
    http_stub.responses.append("invalid")
    with pytest.raises(ProviderFailure):
        request_json("GET", "https://provider.invalid")


def test_http_bounds_response_size(http_stub):
    http_stub.responses.append("x" * (8 * 1024 * 1024))
    with pytest.raises(ProviderFailure):
        request_json("GET", "https://provider.invalid")

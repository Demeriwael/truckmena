"""Public endpoints with real provider parsing and the real HOS scheduler."""

import copy
from datetime import datetime

import pytest
import requests
from django.conf import settings
from rest_framework.throttling import ScopedRateThrottle

from trips.serializers import TripRequestSerializer
from trips.services.planner import calendar_days
from trips.tests.conftest import ResponseStub
from trips.views import plan_view


def test_health_needs_no_provider_or_database(api_client):
    assert settings.DATABASES == {}
    assert api_client.get("/api/health").json() == {
        "status": "ok",
        "service": "eld-trip-planner",
    }


def test_plan_contract_mileage_offsets_summary_and_pickup_marker(
    api_client, http_stub, ors_payload, trip_input
):
    http_stub.responses.append(ors_payload())
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["route"]["geometry"][0] == [0, 0]
    assert data["route"]["legs"] == [
        {"from": "Current", "to": "Pickup", "miles": 110},
        {"from": "Pickup", "to": "Dropoff", "miles": 55},
    ]
    assert data["summary"] == {
        "total_miles": 165,
        "total_driving_hours": 3,
        "total_duration_hours": 5,
        "log_days": 1,
        "fuel_stops": 0,
        "rests": 0,
        "breaks": 0,
        "restarts": 0,
        "cycle_remaining_hours_at_end": 65,
    }
    assert data["route"]["provider_duration_hours"] == pytest.approx(1 / 30)
    assert (
        data["events"][0]["type"] == "start" and data["events"][0]["duration_min"] == 0
    )
    pickup = next(event for event in data["events"] if event["type"] == "pickup")
    assert (pickup["lat"], pickup["lng"], pickup["mile_marker"]) == (1, 1, 110)
    assert pickup["start"] == "2026-10-03T10:00:00-05:00"
    assert pickup["end"] == "2026-10-03T11:00:00-05:00"
    assert data["logs"] == [] and data["log_generation_available"] is False
    assert len(http_stub.calls) == 1
    assert "provider-test-credential" not in response.content.decode()


@pytest.mark.parametrize("cycle", [69, 70])
def test_exhausted_cycle_and_zero_first_leg(
    api_client, http_stub, ors_payload, trip_input, cycle
):
    trip_input["current_location"] = dict(trip_input["pickup_location"])
    trip_input["cycle_used_hours"] = cycle
    http_stub.responses.append(ors_payload((0, 55), zero_first=True))
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["summary"]["restarts"] == 1
    assert data["summary"]["cycle_remaining_hours_at_end"] == (
        67 if cycle == 70 else 68
    )
    positive_events = data["events"][1:]
    assert positive_events[0]["type"] == ("restart" if cycle == 70 else "pickup")


def test_long_trip_preserves_contiguous_intervals_and_fuel_distance(
    api_client, http_stub, ors_payload, trip_input, monkeypatch
):
    monkeypatch.setattr(
        "trips.services.planner.reverse_place", lambda lat, lng, fallback: fallback
    )
    http_stub.responses.append(ors_payload((1200.25, 1800.125)))
    trip_input["cycle_used_hours"] = 34
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 200, response.json()
    data = response.json()
    events = data["events"][1:]
    assert data["summary"]["total_miles"] == 3000.375
    assert data["summary"]["fuel_stops"] == 3
    assert data["summary"]["rests"] >= 4
    assert data["summary"]["restarts"] == 1
    assert [event["mile_marker"] for event in events if event["type"] == "fuel"] == [
        1000,
        2000,
        3000,
    ]
    for left, right in zip(events, events[1:], strict=False):
        assert left["end"] == right["start"]
        assert left["end_mile_marker"] == right["mile_marker"]
    assert events[-1]["mile_marker"] == 3000.375


@pytest.mark.parametrize(
    "field,value",
    [
        ("cycle_used_hours", -1),
        ("cycle_used_hours", 70.01),
        ("cycle_used_hours", True),
        ("cycle_used_hours", "NaN"),
        ("start_time", "2026-10-03T08:00:00"),
        ("start_time", "bad datetime"),
        ("vehicle", ""),
        ("driver_name", "x" * 161),
    ],
)
def test_invalid_fields_are_rejected_before_network(
    api_client, http_stub, trip_input, field, value
):
    trip_input[field] = value
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 400 and field in response.json()
    assert http_stub.calls == []


@pytest.mark.parametrize(
    "location",
    [
        {"label": ""},
        {"label": "Place", "lat": 1},
        {"label": "Place", "lng": 1},
        {"label": "Place", "lat": 91, "lng": 0},
        {"label": "Place", "lat": 1, "lng": True},
        {"label": "Place", "lat": "NaN", "lng": 1},
        {"label": "Place", "lat": 1, "lng": 181},
    ],
)
def test_invalid_coordinates_are_client_errors(
    api_client, http_stub, trip_input, location
):
    trip_input["pickup_location"] = location
    assert (
        api_client.post("/api/trips/plan", trip_input, format="json").status_code == 400
    )
    assert http_stub.calls == []


def test_same_pickup_dropoff_is_rejected_without_routing(
    api_client, http_stub, trip_input
):
    trip_input["dropoff_location"] = copy.deepcopy(trip_input["pickup_location"])
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 400 and response.json()["code"] == "same_locations"
    assert http_stub.calls == []


def test_unknown_fields_are_not_silently_ignored(api_client, trip_input):
    trip_input["average_mph"] = 100
    assert api_client.post("/api/trips/plan", trip_input, format="json").json() == {
        "average_mph": ["Unknown field."]
    }


def test_optional_demo_details_and_default_start_are_complete(trip_input):
    trip_input.pop("start_time")
    serializer = TripRequestSerializer(data=trip_input)
    assert serializer.is_valid(), serializer.errors
    data = serializer.validated_data
    assert data["start_time"].utcoffset().total_seconds() == 0
    assert data["start_time"].second == data["start_time"].microsecond == 0
    assert data["carrier"] == {"name": "Demo Freight LLC", "address": "Chicago, IL"}
    assert all(data[key] for key in ("driver_name", "vehicle", "shipping_doc"))


def test_start_time_retains_offset_and_uses_whole_minutes(trip_input):
    trip_input["start_time"] = "2026-10-03T23:59:59.999+03:00"
    serializer = TripRequestSerializer(data=trip_input)
    assert serializer.is_valid(), serializer.errors
    assert (
        serializer.validated_data["start_time"].isoformat()
        == "2026-10-03T23:59:00+03:00"
    )


def test_label_only_locations_are_geocoded_once_each(
    api_client, http_stub, ors_payload, trip_input
):
    for key in ("current_location", "pickup_location", "dropoff_location"):
        location = trip_input[key]
        http_stub.responses.append(
            {
                "features": [
                    {
                        "geometry": {"coordinates": [location["lng"], location["lat"]]},
                        "properties": {"label": location["label"]},
                    }
                ]
            }
        )
        trip_input[key] = {"label": location["label"]}
    http_stub.responses.append(ors_payload())
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 200, response.json()
    assert len(http_stub.calls) == 4
    assert [method for method, _, _ in http_stub.calls] == ["GET", "GET", "GET", "POST"]


def test_distinct_work_locations_at_one_snapped_point_keep_their_labels(
    api_client, http_stub, ors_payload, trip_input
):
    payload = ors_payload((110, 0))
    feature = payload["features"][0]
    feature["geometry"]["coordinates"] = feature["geometry"]["coordinates"][:3]
    feature["properties"]["way_points"] = [0, 2, 2]
    trip_input["dropoff_location"] = {
        "label": "Delivery across street",
        "lat": 1,
        "lng": 1.0001,
    }
    http_stub.responses.append(payload)
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 200, response.json()
    work = [
        event
        for event in response.json()["events"]
        if event["type"] in ("pickup", "dropoff")
    ]
    assert [event["place"] for event in work] == ["Pickup", "Delivery across street"]
    assert work[0]["mile_marker"] == work[1]["mile_marker"] == 110


def test_calendar_overflow_returns_client_error(
    api_client, http_stub, ors_payload, trip_input
):
    trip_input["start_time"] = "9999-12-31T23:59:00Z"
    http_stub.responses.append(ors_payload())
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert (
        response.status_code == 400 and response.json()["code"] == "invalid_start_time"
    )


def test_provider_failure_returns_friendly_502_without_secrets(
    api_client, http_stub, trip_input, caplog
):
    http_stub.responses.extend(
        [
            requests.Timeout("provider-test-credential secret URL"),
            requests.ConnectionError("provider-test-credential secret URL"),
        ]
    )
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert (
        response.status_code == 502
        and response.json()["code"] == "provider_unavailable"
    )
    assert "provider-test-credential" not in response.content.decode() + caplog.text


def test_osrm_warning_survives_api_serialization(
    api_client, http_stub, osrm_payload, trip_input
):
    http_stub.responses.extend([ResponseStub({}, 429), osrm_payload])
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 200
    assert response.json()["route"]["provider"] == "osrm"
    assert "car profile" in response.json()["warnings"][0]


def test_unexpected_error_is_sanitized_in_response_and_logs(
    api_client, trip_input, monkeypatch, caplog
):
    def fail(data):
        raise RuntimeError("sensitive-token-or-request-url")

    monkeypatch.setattr("trips.views.plan_trip", fail)
    response = api_client.post("/api/trips/plan", trip_input, format="json")
    assert response.status_code == 500 and response.json()["code"] == "internal_error"
    assert "sensitive-token" not in response.content.decode() + caplog.text
    assert "RuntimeError" in caplog.text


def test_autocomplete_api_minimum_and_missing_query(api_client):
    assert api_client.get("/api/geocode/autocomplete?q=ab").json() == []
    assert api_client.get("/api/geocode/autocomplete").json() == []


def test_autocomplete_api_serializes_suggestions(api_client, http_stub):
    http_stub.responses.append(
        {
            "features": [
                {
                    "geometry": {"coordinates": [-87, 41]},
                    "properties": {"label": "Chicago"},
                }
            ]
        }
    )
    response = api_client.get("/api/geocode/autocomplete", {"q": "Chicago"})
    assert response.json() == [{"label": "Chicago", "lat": 41, "lng": -87}]


def test_cors_allows_configured_frontend_only(api_client):
    allowed = api_client.get("/api/health", HTTP_ORIGIN="http://localhost:5173")
    assert allowed["Access-Control-Allow-Origin"] == "http://localhost:5173"
    denied = api_client.get("/api/health", HTTP_ORIGIN="https://untrusted.invalid")
    assert "Access-Control-Allow-Origin" not in denied


def test_scoped_plan_throttle_returns_429(api_client, trip_input, monkeypatch):
    monkeypatch.setattr(plan_view.cls, "throttle_classes", [ScopedRateThrottle])
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"plan": "1/min"})
    assert api_client.post("/api/trips/plan", {}, format="json").status_code == 400
    assert (
        api_client.post("/api/trips/plan", trip_input, format="json").status_code == 429
    )


@pytest.mark.parametrize(
    "start,duration,expected",
    [
        ("2026-10-03T22:00:00-05:00", 120, 1),
        ("2026-10-03T22:00:00-05:00", 121, 2),
        ("2026-10-03T00:00:00+03:00", 1440, 1),
        ("2026-10-03T23:00:00+03:00", 2040, 3),
    ],
)
def test_log_day_count_uses_local_offset_and_exclusive_end(start, duration, expected):
    assert calendar_days(datetime.fromisoformat(start), duration) == expected

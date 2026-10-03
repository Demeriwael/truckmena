"""Orchestrate providers and the pure scheduler, then enrich public events."""

from datetime import datetime, timedelta
from time import monotonic

from django.conf import settings

from trips.exceptions import InvalidStartTime, SameLocations
from trips.services.geocoding import resolve_location, reverse_place
from trips.services.hos_engine import EventType, RouteLeg, schedule_trip
from trips.services.log_builder import LogMetadata, build_daily_logs
from trips.services.routing import RoutePositionIndex, get_route, same_point
from trips.services.trip_time import local_departure


def calendar_days(start: datetime, duration_min: int) -> int:
    """Count occupied local dates; an end exactly at midnight adds no empty day."""
    last = start + timedelta(minutes=duration_min) - timedelta(microseconds=1)
    return (last.date() - start.date()).days + 1


def plan_trip(data: dict) -> dict:
    locations = tuple(
        resolve_location(data[key])
        for key in ("current_location", "pickup_location", "dropoff_location")
    )
    if same_point(locations[1], locations[2]):
        raise SameLocations()
    route = get_route(locations)
    legs = tuple(
        RouteLeg(locations[i].label, locations[i + 1].label, leg.miles)
        for i, leg in enumerate(route.legs)
    )
    schedule = schedule_trip(legs, data["cycle_used_hours"])
    start = data.get("start_time") or local_departure(
        locations[0].lat, locations[0].lng
    )
    try:
        log_days = calendar_days(start, schedule.total_duration_min)
    except OverflowError:
        raise InvalidStartTime() from None
    positions = RoutePositionIndex(route)
    known = {
        schedule.total_miles: locations[2].label,
        legs[0].distance_miles: locations[1].label,
    }
    known.setdefault(0, locations[0].label)
    places = dict(known)
    location_labels = {location.label for location in locations}
    reverse_budget = settings.REVERSE_LOOKUP_BUDGET
    reverse_deadline = monotonic() + 3
    events = []
    lat, lng = route.legs[0].geometry[0]
    events.append(
        {
            "id": "event-start",
            "type": "start",
            "status": "OFF",
            "start": start.isoformat(),
            "end": start.isoformat(),
            "duration_min": 0,
            "lat": lat,
            "lng": lng,
            "place": locations[0].label,
            "mile_marker": 0,
            "end_mile_marker": 0,
            "note": "Trip starts",
        }
    )
    for event in schedule.events:
        lat, lng = positions.at(event.mile_marker)
        if event.mile_marker not in places:
            fallback = f"Mile {float(event.mile_marker):,.1f} on route"
            if reverse_budget > 0 and monotonic() < reverse_deadline:
                places[event.mile_marker] = reverse_place(lat, lng, fallback)
                reverse_budget -= 1
            else:
                places[event.mile_marker] = fallback
        events.append(
            {
                "id": event.id,
                "type": event.type.value,
                "status": event.status.value,
                "start": (start + timedelta(minutes=event.start_min)).isoformat(),
                "end": (start + timedelta(minutes=event.end_min)).isoformat(),
                "duration_min": event.duration_min,
                "lat": lat,
                "lng": lng,
                # Different work locations can snap to the same road/mile marker.
                "place": (
                    event.place
                    if event.place in location_labels
                    else places[event.mile_marker]
                ),
                "mile_marker": float(event.mile_marker),
                "end_mile_marker": float(event.end_mile),
                "note": event.note,
            }
        )
    carrier = data["carrier"]
    logs = build_daily_logs(
        schedule,
        start,
        metadata=LogMetadata(
            driver_name=data["driver_name"],
            carrier_name=carrier["name"],
            main_office_address=carrier["address"],
            home_terminal_address=carrier["home_terminal_address"],
            vehicle=data["vehicle"],
            shipping_doc=data["shipping_doc"],
        ),
        places={event["id"]: event["place"] for event in events},
    )
    assert len(logs) == log_days, "Summary day count must match the generated sheets"
    return {
        "route": {
            "geometry": route.geometry,
            "total_miles": float(route.miles),
            "legs": [
                {
                    "from": leg.from_place,
                    "to": leg.to_place,
                    "miles": float(leg.distance_miles),
                }
                for leg in legs
            ],
            "provider": route.provider,
            "profile": "driving-hgv" if route.provider == "ors" else "driving",
            "provider_duration_hours": float(
                sum(leg.duration_seconds for leg in route.legs) / 3600
            ),
            "attribution": [
                "© OpenStreetMap contributors",
                "openrouteservice / HeiGIT" if route.provider == "ors" else "OSRM",
            ],
        },
        "summary": {
            "total_miles": float(schedule.total_miles),
            "total_driving_hours": schedule.total_driving_min / 60,
            "total_duration_hours": schedule.total_duration_min / 60,
            "log_days": log_days,
            "fuel_stops": schedule.count(EventType.FUEL),
            "rests": schedule.count(EventType.REST),
            "breaks": schedule.count(EventType.BREAK),
            "restarts": schedule.count(EventType.RESTART),
            "cycle_remaining_hours_at_end": schedule.cycle_remaining_min / 60,
        },
        "events": events,
        "logs": [log.to_dict() for log in logs],
        "warnings": list(route.warnings),
        "log_generation_available": True,
    }

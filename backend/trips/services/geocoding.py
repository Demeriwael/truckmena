"""Cached ORS geocoding; Nominatim only for explicit full-address submissions."""

from threading import Lock

from django.conf import settings
from django.core.cache import cache

from trips.exceptions import AddressNotFound, ProviderUnavailable
from trips.services.providers import (
    ProviderFailure,
    cache_key,
    coordinates,
    nominatim_gate,
    ors_request,
    reverse_gate,
)
from trips.services.routing import Location

# One reverse worker per process; skip contention rather than delaying planning.
_reverse_lock = Lock()


def _suggestions(payload: dict) -> list[dict]:
    results = []
    for feature in payload["features"][:5]:
        lat, lng = coordinates(feature["geometry"]["coordinates"])
        label = feature["properties"]["label"]
        if not isinstance(label, str) or not label.strip():
            raise ValueError("Invalid geocode label")
        results.append({"label": label, "lat": lat, "lng": lng})
    return results


def autocomplete(query: str) -> list[dict]:
    query = " ".join(query.split())
    if len(query) < 3:
        return []
    key = cache_key("autocomplete", query.casefold(), settings.ORS_BASE_URL)
    cached = cache.get(key)
    if cached is not None:
        return cached
    try:
        results = _suggestions(
            ors_request("GET", "/geocode/autocomplete", params={"text": query})
        )
    except (
        ProviderFailure,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
    ):
        raise ProviderUnavailable(
            "Address suggestions are unavailable. "
            "Enter full addresses and submit the trip."
        ) from None
    cache.set(key, results, settings.PROVIDER_CACHE_SECONDS)
    return results


def resolve_location(value: dict) -> Location:
    if "lat" in value:
        return Location(value["label"], value["lat"], value["lng"])
    query = " ".join(value["label"].split())
    key = cache_key(
        "address", query.casefold(), settings.ORS_BASE_URL, settings.NOMINATIM_BASE_URL
    )
    cached = cache.get(key)
    if cached is not None:
        return Location(**cached)
    try:
        results = _suggestions(
            ors_request("GET", "/geocode/search", params={"text": query, "size": 1})
        )
    except (
        ProviderFailure,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
    ):
        results = _nominatim_search(query)
    if not results:
        raise AddressNotFound()
    result = results[0]
    cache.set(key, result, settings.PROVIDER_CACHE_SECONDS)
    return Location(**result)


def _nominatim_search(query: str) -> list[dict]:
    if not settings.NOMINATIM_ENABLED:
        raise ProviderUnavailable(
            "Address lookup is unavailable. "
            "Select a saved suggestion or try again shortly."
        )
    try:
        payload = nominatim_gate.request(
            "GET",
            settings.NOMINATIM_BASE_URL + "/search",
            params={"q": query, "format": "jsonv2", "limit": 1},
            headers={"User-Agent": settings.GEOCODING_USER_AGENT},
        )
        results = []
        for item in payload:
            lat, lng = coordinates([item["lon"], item["lat"]])
            label = item["display_name"]
            if not isinstance(label, str) or not label.strip():
                raise ValueError("Invalid geocode label")
            results.append({"label": label, "lat": lat, "lng": lng})
        return results
    except (
        ProviderFailure,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
    ):
        raise ProviderUnavailable() from None


def reverse_place(lat: float, lng: float, fallback: str) -> str:
    """Optional remarks enrichment; failure never breaks an otherwise valid trip.

    Round to ~100m cells, cache missing results, and pace ORS reverse lookups.
    Never batch reverse-geocode the route through public Nominatim.
    """
    point = (round(lat, 3), round(lng, 3))
    key = cache_key("reverse", point, settings.ORS_BASE_URL)
    cached = cache.get(key)
    if cached is not None:
        return cached or fallback
    if not _reverse_lock.acquire(blocking=False):
        return fallback
    try:
        # Hold this lock across the gate so other requests skip enrichment.
        payload = reverse_gate.call(
            ors_request,
            "GET",
            "/geocode/reverse",
            params={"point.lat": point[0], "point.lon": point[1], "size": 1},
        )
        props = payload["features"][0]["properties"] if payload else {}
        city = props.get("locality") or props.get("localadmin") or props.get("county")
        region = props.get("region_a") or props.get("region")
        place = ", ".join(str(item) for item in (city, region) if item)
        cache.set(key, place, settings.PROVIDER_CACHE_SECONDS if place else 60)
        return place or fallback
    except (
        ProviderFailure,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
    ):
        cache.set(key, "", 60)
        return fallback
    finally:
        _reverse_lock.release()

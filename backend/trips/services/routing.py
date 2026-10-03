"""One three-waypoint directions request and provider-scaled map positions."""

import math
from bisect import bisect_left
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from itertools import pairwise

from django.conf import settings
from django.core.cache import cache

from trips.exceptions import NoRoute, ProviderUnavailable
from trips.services.providers import (
    ProviderFailure,
    cache_key,
    coordinates,
    decimal_number,
    ors_request,
    osrm_gate,
)

type Point = tuple[float, float]
METERS_PER_MILE = Decimal("1609.344")
OSRM_WARNING = (
    "ORS truck routing is unavailable. This fallback uses OSRM's car profile; "
    "truck height, weight, and road restrictions are not verified."
)


@dataclass(frozen=True, slots=True)
class Location:
    label: str
    lat: float
    lng: float

    @property
    def point(self) -> Point:
        return self.lat, self.lng


@dataclass(frozen=True, slots=True)
class RoutedLeg:
    distance_meters: Decimal
    duration_seconds: Decimal
    geometry: tuple[Point, ...]

    @property
    def miles(self) -> Fraction:
        return Fraction(self.distance_meters) / Fraction(METERS_PER_MILE)


@dataclass(frozen=True, slots=True)
class Route:
    geometry: tuple[Point, ...]
    legs: tuple[RoutedLeg, RoutedLeg]
    provider: str
    warnings: tuple[str, ...] = ()

    @property
    def miles(self) -> Fraction:
        return sum((leg.miles for leg in self.legs), Fraction(0))


def haversine_meters(a: Point, b: Point) -> float:
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat = lat2 - lat1
    dlng = math.radians(b[1] - a[1])
    value = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    )
    return 6_371_008.8 * 2 * math.asin(math.sqrt(min(1, max(0, value))))


def same_point(a: Location, b: Location) -> bool:
    return haversine_meters(a.point, b.point) <= 1


def decode_polyline(encoded: str, precision: int = 5) -> tuple[Point, ...]:
    """Decode standard 2D polylines; the providers normally return GeoJSON."""
    if not isinstance(encoded, str) or precision not in (5, 6):
        raise ValueError("Invalid encoded polyline")
    index = 0
    values = [0, 0]
    points = []
    while index < len(encoded):
        for axis in range(2):
            result = shift = 0
            while True:
                if index >= len(encoded) or shift > 30:
                    raise ValueError("Invalid encoded polyline")
                byte = ord(encoded[index]) - 63
                index += 1
                if not 0 <= byte <= 63:
                    raise ValueError("Invalid encoded polyline")
                result |= (byte & 31) << shift
                shift += 5
                if byte < 32:
                    break
            values[axis] += ~(result >> 1) if result & 1 else result >> 1
        points.append(
            coordinates([values[1] / 10**precision, values[0] / 10**precision])
        )
    if not points:
        raise ValueError("Empty encoded polyline")
    return tuple(points)


def _geometry(value: dict) -> tuple[Point, ...]:
    if value["type"] != "LineString" or not value["coordinates"]:
        raise ValueError("Missing road geometry")
    return tuple(coordinates(point) for point in value["coordinates"])


def _leg(value: dict, geometry: tuple[Point, ...]) -> RoutedLeg:
    distance = decimal_number(value["distance"])
    duration = decimal_number(value["duration"])
    # Bound corrupt upstream data before handing distances to the scheduler.
    if distance > 100_000_000 or duration > 365 * 24 * 60 * 60:
        raise ValueError("Provider leg exceeds planning bounds")
    if not geometry or (
        distance > 0 and not any(a != b for a, b in pairwise(geometry))
    ):
        raise ValueError("Missing leg geometry")
    return RoutedLeg(distance, duration, geometry)


def _parse_ors(payload: dict) -> Route:
    feature = payload["features"][0]
    geometry = _geometry(feature["geometry"])
    props = feature["properties"]
    segments, indices = props["segments"], props["way_points"]
    if len(segments) != 2 or len(indices) != 3:
        raise ValueError("Three waypoints must produce two legs")
    if any(type(index) is not int for index in indices):
        raise ValueError("Invalid waypoint indices")
    if not 0 == indices[0] <= indices[1] <= indices[2] == len(geometry) - 1:
        raise ValueError("Invalid waypoint indices")
    legs = tuple(
        _leg(segments[i], geometry[indices[i] : indices[i + 1] + 1]) for i in range(2)
    )
    return Route(geometry, legs, "ors")


def _parse_osrm(payload: dict) -> Route:
    if payload.get("code") == "NoRoute":
        raise NoRoute()
    if payload.get("code") != "Ok":
        raise ValueError("Invalid OSRM response")
    route = payload["routes"][0]
    geometry = _geometry(route["geometry"])
    if len(route["legs"]) != 2:
        raise ValueError("Three waypoints must produce two legs")
    legs = []
    for leg in route["legs"]:
        points: list[Point] = []
        for step in leg["steps"]:
            step_points = _geometry(step["geometry"])
            points.extend(
                step_points[1:]
                if points and points[-1] == step_points[0]
                else step_points
            )
        legs.append(_leg(leg, tuple(points)))
    return Route(geometry, tuple(legs), "osrm", (OSRM_WARNING,))


def get_route(locations: Sequence[Location]) -> Route:
    if len(locations) != 3:
        raise ValueError("Exactly three locations are required")
    points = [[item.lng, item.lat] for item in locations]
    key = cache_key("route", points, settings.ORS_BASE_URL, settings.OSRM_BASE_URL)
    cached = cache.get(key)
    if cached is not None:
        return cached
    try:
        payload = ors_request(
            "POST",
            "/v2/directions/driving-hgv/geojson",
            json={"coordinates": points, "instructions": False},
        )
        result = _parse_ors(payload)
    except ProviderFailure as error:
        if error.code in (2009, 2010):
            raise NoRoute() from None
        result = _fallback_route(points)
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        result = _fallback_route(points)
    if result.miles <= 0:
        raise NoRoute()
    # A duplicated current/pickup must remain a zero-mile leg, without a loop.
    if same_point(locations[0], locations[1]) and result.legs[0].miles != 0:
        raise ProviderUnavailable()
    # Retry ORS sooner after a fallback instead of pinning a car route all day.
    timeout = settings.PROVIDER_CACHE_SECONDS if result.provider == "ors" else 60
    cache.set(key, result, timeout)
    return result


def _fallback_route(points: list[list[float]]) -> Route:
    path = ";".join(f"{lng:.7f},{lat:.7f}" for lng, lat in points)
    try:
        payload = osrm_gate.request(
            "GET",
            settings.OSRM_BASE_URL + "/route/v1/driving/" + path,
            params={"overview": "full", "geometries": "geojson", "steps": "true"},
            headers={
                "User-Agent": settings.GEOCODING_USER_AGENT
                or "truckmena-eld-planner/0.1"
            },
        )
        return _parse_osrm(payload)
    except (
        ProviderFailure,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
    ):
        raise ProviderUnavailable() from None


class RoutePositionIndex:
    """Walk each leg by haversine, scaled to its authoritative provider miles.

    Scaling independently per leg guarantees the pickup marker lands exactly at
    the pickup waypoint even when polyline length differs from road distance.
    """

    def __init__(self, route: Route):
        self.route = route
        self.lengths: list[list[float]] = []
        for leg in route.legs:
            lengths = [0.0]
            for a, b in pairwise(leg.geometry):
                lengths.append(lengths[-1] + haversine_meters(a, b))
            self.lengths.append(lengths)

    def at(self, mile_marker: Fraction) -> Point:
        if not 0 <= mile_marker <= self.route.miles:
            raise ValueError("Mile marker is outside the route")
        first = self.route.legs[0].miles
        leg_index = 0 if mile_marker < first else 1
        leg = self.route.legs[leg_index]
        relative = mile_marker if leg_index == 0 else mile_marker - first
        if relative == 0:
            return leg.geometry[0]
        if relative == leg.miles:
            return leg.geometry[-1]
        lengths = self.lengths[leg_index]
        target = float(relative / leg.miles) * lengths[-1]
        index = max(1, bisect_left(lengths, target))
        a, b = leg.geometry[index - 1 : index + 1]
        ratio = (target - lengths[index - 1]) / (lengths[index] - lengths[index - 1])
        # Interpolate across the shortest longitude arc, including the date line.
        dlng = (b[1] - a[1] + 180) % 360 - 180
        lng = (a[1] + ratio * dlng + 180) % 360 - 180
        return a[0] + ratio * (b[0] - a[0]), lng

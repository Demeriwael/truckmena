"""Infer an omitted departure's local offset without a geocoding request."""

from datetime import UTC, datetime, timezone
from zoneinfo import ZoneInfo

from tzfpy import get_tz


def local_departure(lat: float, lng: float, now: datetime | None = None) -> datetime:
    """Freeze the start-location offset so every planning sheet has 24 hours."""
    instant = now if now is not None else datetime.now(UTC)
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("Current time must have a timezone offset")
    zone = ZoneInfo(get_tz(lng, lat) or "UTC")
    offset = instant.astimezone(zone).utcoffset()
    return instant.astimezone(timezone(offset)).replace(second=0, microsecond=0)

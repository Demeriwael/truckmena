"""Offline coordinate timezone inference and fixed departure offsets."""

from datetime import UTC, datetime, timedelta

import pytest

from trips.services.trip_time import local_departure


@pytest.mark.parametrize(
    "lat,lng,instant,expected",
    [
        (
            41.8781,
            -87.6298,
            datetime(2026, 10, 3, 13, tzinfo=UTC),
            "2026-10-03T08:00:00-05:00",
        ),
        (
            41.8781,
            -87.6298,
            datetime(2026, 12, 3, 14, tzinfo=UTC),
            "2026-12-03T08:00:00-06:00",
        ),
        (
            34.0522,
            -118.2437,
            datetime(2026, 10, 3, 13, tzinfo=UTC),
            "2026-10-03T06:00:00-07:00",
        ),
        (
            27.7172,
            85.324,
            datetime(2026, 10, 3, 13, tzinfo=UTC),
            "2026-10-03T18:45:00+05:45",
        ),
    ],
)
def test_coordinate_lookup_uses_local_offset_without_network(
    lat, lng, instant, expected
):
    assert local_departure(lat, lng, instant).isoformat() == expected


def test_inferred_timezone_is_fixed_even_when_the_trip_crosses_dst():
    start = local_departure(41.8781, -87.6298, datetime(2026, 10, 31, 13, tzinfo=UTC))
    assert (start + timedelta(days=3)).utcoffset() == start.utcoffset()


def test_seconds_are_removed_from_default_departure():
    start = local_departure(
        41.8781, -87.6298, datetime(2026, 10, 3, 13, 2, 59, 123, tzinfo=UTC)
    )
    assert start.minute == 2 and start.second == start.microsecond == 0


def test_naive_current_time_is_rejected():
    with pytest.raises(ValueError):
        local_departure(41.8781, -87.6298, datetime(2026, 10, 3, 13))

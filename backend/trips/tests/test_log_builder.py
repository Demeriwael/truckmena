"""Daily boundaries, exact allocation, restarts, and independent reconstruction."""

from collections import defaultdict
from dataclasses import replace
from datetime import datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from zoneinfo import ZoneInfo

import pytest
from hypothesis import example, given, settings
from hypothesis import strategies as st

from trips.services.hos_engine import (
    DutyStatus,
    EventType,
    RouteLeg,
    TripConfig,
    schedule_trip,
)
from trips.services.log_builder import LogMetadata, build_daily_logs


def schedule(first=55, second=55, cycle=0, *, config=None):
    return schedule_trip(
        (RouteLeg("Current", "Pickup", first), RouteLeg("Pickup", "Dropoff", second)),
        cycle,
        config=config,
    )


def departure(value="2026-10-03T08:00:00-05:00"):
    return datetime.fromisoformat(value)


def assert_reconstructed(sheets, plan, start):
    """Reassemble original events and derive recap from duty intersections.

    The oracle uses no log-builder helpers and never advances the engine clock.
    Event IDs tie fragments back to original duty intervals, while cutoff
    intersections independently check cycle usage and the last-five-day recap.
    """
    first_minute = start.hour * 60 + start.minute
    fragments = defaultdict(list)
    all_actual = []
    cumulative_miles = Fraction(0)
    on_duty_by_day = []
    for index, sheet in enumerate(sheets):
        day_start = index * 1440 - first_minute
        day_end = day_start + 1440
        assert sheet.iso_date == (start.date() + timedelta(days=index)).isoformat()
        assert sum(sheet.totals_min) == 1440
        assert sheet.segments[0].start_min_of_day == 0
        assert sheet.segments[-1].end_min_of_day == 1440
        previous_end = 0
        for segment in sheet.segments:
            assert segment.start_min_of_day == previous_end
            assert 0 <= segment.start_min_of_day < segment.end_min_of_day <= 1440
            previous_end = segment.end_min_of_day
            global_start = day_start + segment.start_min_of_day
            global_end = day_start + segment.end_min_of_day
            if segment.is_padding:
                assert segment.status == DutyStatus.OFF and segment.miles == 0
                assert global_end <= 0 or global_start >= plan.total_duration_min
                assert segment.event_id is None
            else:
                assert 0 <= global_start < global_end <= plan.total_duration_min
                fragments[segment.event_id].append(segment)
                all_actual.append((global_start, global_end, segment))
        for status_index, status in enumerate(DutyStatus):
            assert sheet.totals_min[status_index] == sum(
                segment.duration_min
                for segment in sheet.segments
                if segment.status == status
            )
        assert sheet.total_miles == sum(
            (
                segment.miles
                for segment in sheet.segments
                if segment.status == DutyStatus.DRIVING
            ),
            Fraction(0),
        )
        cumulative_miles += sheet.total_miles
        assert sheet.cumulative_trip_miles == cumulative_miles

        on_duty_today = sum(
            max(0, min(day_end, event.end_min) - max(day_start, event.start_min))
            for event in plan.events
            if event.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY)
        )
        on_duty_by_day.append(on_duty_today)
        completed_restarts = [
            event.end_min
            for event in plan.events
            if event.type == EventType.RESTART and event.end_min <= day_end
        ]
        cycle_start = max(completed_restarts, default=0)
        initial = 0 if completed_restarts else plan.initial_cycle_used_min
        expected_cycle = initial + sum(
            max(0, min(day_end, event.end_min) - max(cycle_start, event.start_min))
            for event in plan.events
            if event.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY)
        )
        assert sheet.recap.cycle_used_min == expected_cycle
        assert sheet.recap.available_min == max(0, 4200 - expected_cycle)
        assert sheet.recap.last_five_days_on_duty_min == sum(
            on_duty_by_day[max(0, index - 4) : index + 1]
        )
        assert sheet.recap.on_duty_today_min == on_duty_today
        assert sheet.recap.restart_taken == any(
            day_start < event.end_min <= day_end
            for event in plan.events
            if event.type == EventType.RESTART
        )
        assert sheet.recap.restart_in_progress == any(
            event.start_min < day_end < event.end_min
            for event in plan.events
            if event.type == EventType.RESTART
        )

        encoded = sheet.to_dict()
        assert sum(
            Decimal(str(value)) for value in encoded["totals"].values()
        ) == Decimal("24.00")
        for minutes, displayed in zip(
            sheet.totals_min, encoded["totals"].values(), strict=True
        ):
            assert abs(Fraction(str(displayed)) - Fraction(minutes, 60)) < Fraction(
                1, 100
            )
        assert sum(encoded["totals_min"].values()) == 1440
        assert all(0 <= remark.minute_of_day <= 1440 for remark in sheet.remarks)

    assert cumulative_miles == plan.total_miles
    assert set(fragments) == {event.id for event in plan.events}
    for event in plan.events:
        pieces = fragments[event.id]
        assert sum(piece.duration_min for piece in pieces) == event.duration_min
        assert (
            sum((piece.miles for piece in pieces), Fraction(0)) == event.distance_miles
        )
        assert all(piece.status == event.status for piece in pieces)
        assert (
            pieces[0].start_mile == event.start_mile
            and pieces[-1].end_mile == event.end_mile
        )
    assert all_actual[0][0] == 0 and all_actual[-1][1] == plan.total_duration_min
    for left, right in zip(all_actual, all_actual[1:], strict=False):
        assert left[1] == right[0] and left[2].end_mile == right[2].start_mile


def test_short_day_headers_padding_and_recap():
    plan = schedule(cycle=34)
    metadata = LogMetadata(
        "Wael",
        "Example Carrier",
        "Office",
        "Terminal",
        "Truck 10 / Trailer 20",
        "BOL-123 / Machinery",
    )
    (sheet,) = build_daily_logs(plan, departure(), metadata=metadata)
    assert sheet.date == "10/03/2026" and sheet.iso_date == "2026-10-03"
    assert (sheet.from_place, sheet.to_place) == ("Current", "Dropoff")
    assert sheet.totals_min == (1200, 0, 120, 120)
    assert sheet.total_miles == 110
    assert sheet.recap.cycle_used_min == 38 * 60
    assert sheet.recap.available_min == 32 * 60
    assert sheet.recap.last_five_days_on_duty_min == 240
    assert sheet.segments[0].is_padding and sheet.segments[-1].is_padding
    data = sheet.to_dict()
    assert data["driver_name"] == "Wael" and data["carrier_name"] == "Example Carrier"
    assert (
        data["home_terminal_address"] == "Terminal"
        and data["shipping_doc"] == metadata.shipping_doc
    )
    assert data["timezone_offset"] == "-05:00"
    assert data["totals"] == {"off": 20, "sleeper": 0, "driving": 2, "on_duty": 2}
    assert_reconstructed((sheet,), plan, departure())


def test_driving_split_at_midnight_preserves_fractional_mileage_and_year_rollover():
    plan = schedule()
    start = departure("2026-12-31T23:30:00+03:00")
    sheets = build_daily_logs(plan, start)
    assert [sheet.date for sheet in sheets] == ["12/31/2026", "01/01/2027"]
    assert [sheet.total_miles for sheet in sheets] == [
        Fraction("27.5"),
        Fraction("82.5"),
    ]
    assert sheets[0].to_place == sheets[1].from_place == "Mile 27.5 on route"
    assert sheets[1].segments[0].status == DutyStatus.DRIVING
    assert sheets[1].remarks[0].minute_of_day == 0
    assert "Continue driving" in sheets[1].remarks[0].note
    assert_reconstructed(sheets, plan, start)


def test_pickup_crossing_midnight_counts_partial_work_and_allows_exhausted_cycle():
    plan = schedule(55, 0, 69)
    start = departure("2026-10-03T22:30:00-05:00")
    first, second = build_daily_logs(plan, start)
    assert first.recap.cycle_used_min == 70 * 60 + 30
    assert second.recap.cycle_used_min == 72 * 60
    assert first.recap.available_min == second.recap.available_min == 0
    assert first.total_miles == 55 and second.total_miles == 0
    assert second.segments[0].status == DutyStatus.ON_DUTY
    assert second.segments[0].place == "Pickup"
    assert_reconstructed((first, second), plan, start)


def test_ten_hour_sleeper_rest_crosses_midnight_without_resetting_cycle():
    plan = schedule(605, 55)
    start = departure("2026-10-03T11:00:00-05:00")
    sheets = build_daily_logs(plan, start)
    assert sheets[0].totals_min[1] == 30
    assert sheets[1].totals_min[1] == 570
    assert sheets[0].recap.cycle_used_min == 12 * 60
    assert sheets[1].recap.cycle_used_min == 14 * 60
    assert all(not sheet.recap.restart_taken for sheet in sheets)
    assert_reconstructed(sheets, plan, start)


def test_initial_restart_full_off_day_and_reset_only_at_completion():
    plan = schedule(0, 55, 70)
    start = departure("2026-10-03T18:00:00-05:00")
    first, middle, last = build_daily_logs(plan, start)
    assert first.recap.cycle_used_min == middle.recap.cycle_used_min == 4200
    assert middle.totals_min == (1440, 0, 0, 0)
    assert not middle.segments[0].is_padding
    assert middle.recap.restart_in_progress and not middle.recap.restart_taken
    assert last.recap.restart_taken and not last.recap.restart_in_progress
    assert last.recap.cycle_used_min == 180 and last.recap.available_min == 4020
    assert "34-hour restart taken" in last.recap.to_dict()["notes"]
    assert_reconstructed((first, middle, last), plan, start)


def test_restart_finishing_exactly_midnight_resets_the_ending_days_recap():
    plan = schedule(0, 55, 70)
    start = departure("2026-10-03T14:00:00-05:00")
    sheets = build_daily_logs(plan, start)
    assert sheets[1].recap.cycle_used_min == 0
    assert sheets[1].recap.available_min == 4200
    assert sheets[1].recap.restart_taken
    completion = next(
        remark for remark in sheets[1].remarks if remark.note == "34-hour restart taken"
    )
    assert completion.minute_of_day == 1440
    assert sheets[2].segments[0].start_min_of_day == 0
    assert_reconstructed(sheets, plan, start)


def test_display_padding_does_not_complete_restart_early():
    plan = schedule(0, 55, 70)
    sheets = build_daily_logs(plan, departure("2026-10-03T23:00:00-05:00"))
    # The graph shows 48 OFF hours across the first two dates, but only 25 were
    # actually scheduled. The prior 23-hour padding cannot satisfy the restart.
    assert sum(sheet.totals_min[0] for sheet in sheets[:2]) == 48 * 60
    assert sheets[1].recap.cycle_used_min == 4200
    assert sheets[1].recap.restart_in_progress


@pytest.mark.parametrize(
    "event_type", [EventType.BREAK, EventType.FUEL, EventType.REST, EventType.RESTART]
)
def test_each_required_stop_can_cross_midnight_without_losing_minutes(event_type):
    plan = schedule(500, 700, 69)
    event = next(event for event in plan.events if event.type == event_type)
    start_minute = (1425 - event.start_min) % 1440
    start = departure("2026-10-03T00:00:00Z") + timedelta(minutes=start_minute)
    sheets = build_daily_logs(plan, start)
    pieces = [
        segment
        for sheet in sheets
        for segment in sheet.segments
        if segment.event_id == event.id
    ]
    assert len(pieces) >= 2
    assert pieces[0].start_min_of_day == 1425 and pieces[0].end_min_of_day == 1440
    assert pieces[1].start_min_of_day == 0
    assert sum(piece.duration_min for piece in pieces) == event.duration_min
    assert all(piece.miles == 0 and piece.status == event.status for piece in pieces)
    assert_reconstructed(sheets, plan, start)


def test_exact_midnight_end_does_not_create_an_empty_sheet_or_zero_segment():
    plan = schedule(0, 0)
    start = departure("2026-10-03T22:00:00Z")
    sheets = build_daily_logs(plan, start)
    assert len(sheets) == 1
    assert sheets[0].segments[-1].end_min_of_day == 1440
    assert not sheets[0].segments[-1].is_padding
    assert_reconstructed(sheets, plan, start)


def test_fractional_minutes_display_as_24_hours_without_changing_exact_minutes():
    plan = schedule(
        Fraction(1, 1000),
        Fraction(1, 1000),
        config=TripConfig(pickup_min=1, dropoff_min=1),
    )
    (sheet,) = build_daily_logs(plan, departure())
    assert sheet.totals_min == (1436, 0, 2, 2)
    # Independent rounding of these rows would produce 23.99.
    assert sum(round(minutes / 60, 2) for minutes in sheet.totals_min) == pytest.approx(
        23.99
    )
    assert sum(
        Decimal(str(value)) for value in sheet.to_dict()["totals"].values()
    ) == Decimal("24.00")
    assert sheet.total_miles == Fraction(1, 500)


def test_fixed_start_offset_keeps_days_24_hours_across_daylight_saving_transition():
    start = datetime(2026, 10, 31, 23, 30, tzinfo=ZoneInfo("America/Chicago"))
    plan = schedule(1000, 1000)
    sheets = build_daily_logs(plan, start)
    assert len(sheets) >= 3
    assert all(sheet.timezone_offset == "-05:00" for sheet in sheets)
    assert all(sum(sheet.totals_min) == 1440 for sheet in sheets)
    assert_reconstructed(sheets, plan, start)


def test_enriched_places_are_preserved_and_inputs_are_not_modified():
    plan = schedule()
    places = {event.id: f"Resolved {event.place}" for event in plan.events}
    original = places.copy()
    sheets = build_daily_logs(plan, departure(), places=places)
    assert sheets[0].from_place == "Resolved Current"
    assert sheets[0].to_place == "Resolved Dropoff"
    assert any(remark.place == "Resolved Pickup" for remark in sheets[0].remarks)
    assert places == original
    assert build_daily_logs(plan, departure(), places=places) == sheets


@pytest.mark.parametrize(
    "bad_start", [datetime(2026, 10, 3, 8), departure("2026-10-03T08:00:01Z")]
)
def test_rejects_naive_or_fractional_minute_departure(bad_start):
    with pytest.raises(ValueError):
        build_daily_logs(schedule(), bad_start)


@pytest.mark.parametrize(
    "changes",
    [
        {"start_min": 1},
        {"end_min": 0},
        {"start_min": 0.0},
        {"end_mile": Fraction(-1)},
        {"cycle_used_before_min": 123},
    ],
)
def test_rejects_corrupt_intervals_instead_of_silently_filling_gaps(changes):
    plan = schedule()
    event = replace(plan.events[0], **changes)
    with pytest.raises(ValueError):
        build_daily_logs(replace(plan, events=(event, *plan.events[1:])), departure())


def test_rejects_mileage_during_non_driving_work():
    plan = schedule(0, 0)
    event = replace(plan.events[0], end_mile=Fraction(1))
    with pytest.raises(ValueError, match="Only driving"):
        build_daily_logs(replace(plan, events=(event, *plan.events[1:])), departure())


@settings(max_examples=150, derandomize=True, deadline=None, database=None)
@given(
    first_thousandths=st.integers(0, 5_000_000),
    second_thousandths=st.integers(0, 5_000_000),
    start_minute=st.integers(0, 1439),
    cycle_min=st.integers(0, 4200),
    offset_minutes=st.sampled_from([-480, -330, 0, 180, 330, 345, 840]),
)
@example(
    first_thousandths=0,
    second_thousandths=0,
    start_minute=1320,
    cycle_min=0,
    offset_minutes=0,
)
@example(
    first_thousandths=0,
    second_thousandths=55_000,
    start_minute=1380,
    cycle_min=4200,
    offset_minutes=-330,
)
@example(
    first_thousandths=5_000_000,
    second_thousandths=5_000_000,
    start_minute=0,
    cycle_min=4140,
    offset_minutes=345,
)
def test_generated_logs_reconstruct_schedule_mileage_and_recap(
    first_thousandths, second_thousandths, start_minute, cycle_min, offset_minutes
):
    from datetime import timezone

    start = datetime(
        2026, 10, 3, tzinfo=timezone(timedelta(minutes=offset_minutes))
    ) + timedelta(minutes=start_minute)
    plan = schedule(
        Fraction(first_thousandths, 1000),
        Fraction(second_thousandths, 1000),
        Fraction(cycle_min, 60),
    )
    sheets = build_daily_logs(plan, start)
    assert_reconstructed(sheets, plan, start)


def test_five_day_recap_excludes_older_trip_days_and_prior_input_history():
    plan = schedule(5000, 5000, 34)
    start = departure()
    sheets = build_daily_logs(plan, start)
    assert len(sheets) > 8
    assert_reconstructed(sheets, plan, start)
    assert (
        sheets[0].recap.last_five_days_on_duty_min == sheets[0].recap.on_duty_today_min
    )
    assert sheets[-1].recap.last_five_days_on_duty_min < sum(
        sheet.recap.on_duty_today_min for sheet in sheets
    )

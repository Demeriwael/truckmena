"""Boundary examples and independent replay of generated trip schedules."""

from decimal import Decimal
from fractions import Fraction
from math import ceil
from typing import cast

import pytest
from hypothesis import example, given, settings
from hypothesis import strategies as st

from trips.services.hos_engine import (
    DriverState,
    DutyStatus,
    EventType,
    HOSViolation,
    Number,
    RouteLeg,
    TripConfig,
    TripSchedule,
    advance_clock,
    available_driving_minutes,
    schedule_trip,
)


def route(first: Number = 0, second: Number = 0) -> tuple[RouteLeg, RouteLeg]:
    return (RouteLeg("Start", "Pickup", first), RouteLeg("Pickup", "End", second))


def replay(schedule: TripSchedule, config: TripConfig | None = None) -> None:
    """Check legal driving directly from event times, statuses, and distances.

    This deliberately does not call the engine's clock functions or reuse its
    constants. It catches violations independently of how stops are chosen.
    """
    if config is None:
        config = TripConfig()
    now = 0
    position = Fraction(0)
    cycle = schedule.initial_cycle_used_min
    period_drive = 0
    drive_since_break = 0
    non_drive = 0
    off_run = 0
    window: int | None = None
    fuel_gap = Fraction(0)
    speed = Fraction(str(config.average_mph)) / 60
    ids: set[str] = set()

    for event in schedule.events:
        assert event.id not in ids
        ids.add(event.id)
        assert event.start_min == now
        assert event.duration_min > 0
        assert isinstance(event.start_min, int)
        assert isinstance(event.end_min, int)
        assert event.start_mile == position
        assert event.end_mile >= event.start_mile
        assert event.cycle_used_before_min == cycle

        if event.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY):
            if window is None:
                window = event.start_min
            off_run = 0
            if event.status == DutyStatus.DRIVING:
                assert period_drive + event.duration_min <= 660
                assert event.end_min <= window + 840
                assert drive_since_break + event.duration_min <= 480
                assert cycle + event.duration_min <= 4200
                assert event.distance_miles > 0
                assert event.distance_miles <= event.duration_min * speed
                period_drive += event.duration_min
                drive_since_break += event.duration_min
                fuel_gap += event.distance_miles
                non_drive = 0
            else:
                assert event.distance_miles == 0
                non_drive += event.duration_min
            cycle += event.duration_min
        else:
            assert event.distance_miles == 0
            off_run += event.duration_min
            non_drive += event.duration_min

        assert fuel_gap <= 1000
        if event.type == EventType.FUEL:
            assert event.status == DutyStatus.ON_DUTY
            assert event.duration_min == 30
            fuel_gap = Fraction(0)
        if non_drive >= 30:
            drive_since_break = 0
        if off_run >= 600:
            period_drive = 0
            drive_since_break = 0
            window = None
        if off_run >= 2040:
            cycle = 0
        if event.type == EventType.REST:
            assert event.status == DutyStatus.SLEEPER
            assert event.duration_min == 600
        if event.type == EventType.RESTART:
            assert event.status == DutyStatus.OFF
            assert event.duration_min == 2040
        if event.type == EventType.BREAK:
            assert event.status == DutyStatus.OFF
            assert event.duration_min == 30

        assert event.cycle_used_after_min == cycle
        position = event.end_mile
        now = event.end_min

    assert schedule.events[-1].type == EventType.DROPOFF
    assert schedule.total_miles == position
    assert schedule.total_duration_min == now
    assert schedule.miles_since_fuel_at_end == fuel_gap
    assert schedule.final_state.cycle_used_min == cycle
    assert schedule.final_state.driving_period_min == period_drive
    assert schedule.final_state.drive_since_break_min == drive_since_break
    assert schedule.final_state.window_start_min == window
    assert schedule.cycle_remaining_min == max(0, 4200 - cycle)
    # Only fuel frontiers and leg ends introduce fractional-minute rounding.
    rounding = schedule.total_driving_min - schedule.total_miles / speed
    assert 0 <= rounding < schedule.count(EventType.FUEL) + 2


def test_short_trip_has_no_scheduled_break_or_rest() -> None:
    plan = schedule_trip(route(55, 110), 34)

    assert [event.type for event in plan.events] == [
        EventType.DRIVING,
        EventType.PICKUP,
        EventType.DRIVING,
        EventType.DROPOFF,
    ]
    assert plan.total_driving_min == 180
    assert plan.total_duration_min == 300
    assert plan.cycle_remaining_min == 31 * 60
    assert plan.events[0].place == "Start"
    assert plan.events[0].mile_marker == 0
    assert plan.events[0].end_mile == 55
    assert plan.events[2].place == "Pickup"
    assert plan.events[2].mile_marker == 55
    assert plan.events[1].place == "Pickup"
    assert plan.events[-1].place == "End"
    replay(plan)


def test_break_after_eight_cumulative_driving_hours() -> None:
    plan = schedule_trip(route(495, 0))

    assert [event.duration_min for event in plan.events] == [480, 30, 60, 60, 60]
    pause = plan.events[1]
    assert pause.type == EventType.BREAK
    assert pause.mile_marker == 440
    replay(plan)


@pytest.mark.parametrize("drive_minutes,breaks", [(479, 0), (480, 0), (481, 1)])
def test_eight_hour_boundary_at_arrival(drive_minutes: int, breaks: int) -> None:
    plan = schedule_trip(route(Fraction(drive_minutes * 55, 60), 0))

    assert plan.count(EventType.BREAK) == breaks
    assert plan.total_driving_min == drive_minutes
    replay(plan)


def test_pickup_at_eight_hours_satisfies_break_before_next_leg() -> None:
    plan = schedule_trip(route(440, 55))

    assert plan.count(EventType.BREAK) == 0
    assert plan.total_driving_min == 540
    replay(plan)


@pytest.mark.parametrize("drive_minutes,rests", [(659, 0), (660, 0), (661, 1)])
def test_eleven_hour_boundary_at_arrival(drive_minutes: int, rests: int) -> None:
    plan = schedule_trip(route(Fraction(drive_minutes * 55, 60), 0))

    assert plan.count(EventType.REST) == rests
    assert plan.total_driving_min == drive_minutes
    replay(plan)


def test_pickup_finishes_before_ten_hour_rest() -> None:
    plan = schedule_trip(route(605, 55))
    pickup_index = next(
        index
        for index, event in enumerate(plan.events)
        if event.type == EventType.PICKUP
    )

    assert plan.events[pickup_index].duration_min == 60
    assert plan.events[pickup_index + 1].type == EventType.REST
    assert plan.events[pickup_index + 1].place == "Pickup"
    assert plan.events[pickup_index + 1].start_min == 750
    replay(plan)


@pytest.mark.parametrize("pickup_min,drive_before_rest", [(779, 1), (780, 0), (781, 0)])
def test_fourteen_hour_window_with_long_on_duty_work(
    pickup_min: int, drive_before_rest: int
) -> None:
    config = TripConfig(pickup_min=pickup_min)
    plan = schedule_trip(route(55, 55), config=config)
    pickup_index = next(
        index
        for index, event in enumerate(plan.events)
        if event.type == EventType.PICKUP
    )
    following = plan.events[pickup_index + 1]

    assert plan.events[pickup_index].duration_min == pickup_min
    if drive_before_rest:
        assert following.type == EventType.DRIVING
        assert following.duration_min == 1
        following = plan.events[pickup_index + 2]
    assert following.type == EventType.REST
    assert "14-hour" in following.note
    replay(plan, config)


@pytest.mark.parametrize(
    "miles,fuel_stops",
    [(Fraction(999999, 1000), 0), (1000, 0), (Fraction(1000001, 1000), 1)],
)
def test_fuel_frontier_is_exact_and_only_required_before_more_driving(
    miles: Number, fuel_stops: int
) -> None:
    plan = schedule_trip(route(0, miles))

    assert plan.count(EventType.FUEL) == fuel_stops
    if fuel_stops:
        fuel = next(event for event in plan.events if event.type == EventType.FUEL)
        assert fuel.mile_marker == 1000
    replay(plan)


def test_fuel_at_pickup_is_not_forgotten_between_legs() -> None:
    plan = schedule_trip(route(1000, 1))
    pickup_index = next(
        index
        for index, event in enumerate(plan.events)
        if event.type == EventType.PICKUP
    )
    fuel = plan.events[pickup_index + 1]

    assert fuel.type == EventType.FUEL
    assert fuel.mile_marker == 1000
    assert fuel.place == "Pickup"
    replay(plan)


def test_coincident_fuel_and_break_use_one_stop() -> None:
    config = TripConfig(average_mph=125)
    plan = schedule_trip(route(1500, 0), config=config)

    assert plan.events[0].duration_min == 480
    assert plan.events[1].type == EventType.FUEL
    assert plan.events[1].mile_marker == 1000
    assert plan.count(EventType.BREAK) == 0
    replay(plan, config)


def test_cycle_restart_wins_over_coincident_fuel_and_break() -> None:
    config = TripConfig(average_mph=125)
    plan = schedule_trip(route(1001, 0), 62, config=config)

    assert [event.type for event in plan.events[:3]] == [
        EventType.DRIVING,
        EventType.RESTART,
        EventType.FUEL,
    ]
    assert plan.events[1].mile_marker == 1000
    assert plan.count(EventType.BREAK) == 0
    assert plan.count(EventType.REST) == 0
    replay(plan, config)


def test_cycle_restart_wins_over_eleven_hour_rest() -> None:
    plan = schedule_trip(route(606, 0), 59)
    restart = next(event for event in plan.events if event.type == EventType.RESTART)

    assert restart.mile_marker == 605
    assert plan.count(EventType.REST) == 0
    replay(plan)


def test_rest_and_fuel_at_same_position_remain_distinct_duty_statuses() -> None:
    config = TripConfig(average_mph=Fraction(1000, 11))
    plan = schedule_trip(route(1001, 0), config=config)
    rest_index = next(
        index for index, event in enumerate(plan.events) if event.type == EventType.REST
    )

    assert plan.events[rest_index].mile_marker == 1000
    assert plan.events[rest_index + 1].type == EventType.FUEL
    assert plan.events[rest_index + 1].mile_marker == 1000
    replay(plan, config)


@pytest.mark.parametrize("cycle_used", [70, 71, Decimal("70.5")])
def test_already_exhausted_cycle_restarts_first(cycle_used: Number) -> None:
    plan = schedule_trip(route(55, 55), cycle_used)

    assert plan.events[0].type == EventType.RESTART
    assert plan.events[0].start_min == 0
    assert plan.events[0].duration_min == 2040
    assert plan.events[0].cycle_used_after_min == 0
    assert plan.final_state.cycle_used_min == 240
    replay(plan)


def test_sixty_nine_hours_restarts_mid_leg_when_needed() -> None:
    plan = schedule_trip(route(110, 55), 69)

    assert plan.events[0].duration_min == 60
    assert plan.events[1].type == EventType.RESTART
    assert plan.events[1].mile_marker == 55
    replay(plan)


@pytest.mark.parametrize("cycle_used", [69, Decimal("69.5")])
def test_cycle_reached_during_pickup_finishes_work_before_restart(
    cycle_used: Number,
) -> None:
    plan = schedule_trip(route(0, 55), cycle_used)

    assert plan.events[0].type == EventType.PICKUP
    assert plan.events[0].duration_min == 60
    assert plan.events[0].cycle_used_after_min >= 4200
    assert plan.events[1].type == EventType.RESTART
    replay(plan)


def test_delivery_can_finish_over_cycle_limit_without_pointless_final_restart() -> None:
    plan = schedule_trip(route(0, 55), 68)

    assert plan.final_state.cycle_used_min == 71 * 60
    assert plan.cycle_remaining_min == 0
    assert plan.count(EventType.RESTART) == 0
    replay(plan)


def test_fractional_input_cycle_is_rounded_up_to_a_whole_minute() -> None:
    plan = schedule_trip(route(1, 1), Decimal("69.999"))

    assert plan.initial_cycle_used_min == 4200
    assert plan.events[0].type == EventType.RESTART
    replay(plan)


def test_zero_current_to_pickup_leg_emits_no_empty_drive() -> None:
    plan = schedule_trip(route(0, 55))

    assert [event.type for event in plan.events] == [
        EventType.PICKUP,
        EventType.DRIVING,
        EventType.DROPOFF,
    ]
    assert plan.total_duration_min == 180
    replay(plan)


def test_both_zero_length_legs_still_record_pickup_and_delivery() -> None:
    plan = schedule_trip(route())

    assert plan.total_miles == 0
    assert plan.total_driving_min == 0
    assert plan.total_duration_min == 120
    assert plan.count(EventType.PICKUP) == 1
    assert plan.count(EventType.DROPOFF) == 1
    replay(plan)


def test_zero_length_trip_with_exhausted_input_cycle_still_restarts_first() -> None:
    plan = schedule_trip(route(), 70)

    assert plan.events[0].type == EventType.RESTART
    assert plan.final_state.cycle_used_min == 120
    replay(plan)


def test_multi_day_trip_over_three_thousand_miles_and_repeated_restarts() -> None:
    plan = schedule_trip(route(1250, 4750), 69)

    assert plan.total_miles == 6000
    assert plan.total_duration_min > 5 * 24 * 60
    assert plan.count(EventType.FUEL) == 5
    assert plan.count(EventType.RESTART) >= 2
    assert plan.count(EventType.REST) > 0
    replay(plan)


def test_fractional_miles_are_preserved_and_driving_is_never_underestimated() -> None:
    plan = schedule_trip(route(Decimal("0.001"), Decimal("1000.001")))

    assert plan.total_miles == Fraction(500001, 500)
    assert plan.total_driving_min >= ceil(plan.total_miles * 60 / 55)
    assert [
        event.mile_marker for event in plan.events if event.type == EventType.FUEL
    ] == [Fraction(1000)]
    replay(plan)


def test_same_inputs_produce_identical_schedules_without_mutating_legs() -> None:
    legs = list(route(900, 2400))
    before = tuple(legs)

    assert schedule_trip(legs, 34) == schedule_trip(legs, 34)
    assert tuple(legs) == before


@pytest.mark.parametrize("first,second", [(0, 0), (0.1, 0.2), (55, 110), (3000, 6000)])
def test_summary_driving_time_is_the_sum_of_actual_driving_events(
    first: Number, second: Number
) -> None:
    plan = schedule_trip(route(first, second))

    assert plan.total_driving_min == sum(
        event.duration_min
        for event in plan.events
        if event.status == DutyStatus.DRIVING
    )
    assert plan.total_duration_min == sum(event.duration_min for event in plan.events)
    replay(plan)


@pytest.mark.parametrize(
    "status", [DutyStatus.OFF, DutyStatus.SLEEPER, DutyStatus.ON_DUTY]
)
def test_any_thirty_minute_non_driving_status_resets_break_counter(
    status: DutyStatus,
) -> None:
    state = advance_clock(DriverState(), DutyStatus.DRIVING, 480)
    state = advance_clock(state, status, 29)
    assert available_driving_minutes(state) == 0

    state = advance_clock(state, status, 1)
    assert state.drive_since_break_min == 0
    assert available_driving_minutes(state) == 180


def test_consecutive_mixed_non_driving_statuses_satisfy_break() -> None:
    state = advance_clock(DriverState(), DutyStatus.DRIVING, 480)
    state = advance_clock(state, DutyStatus.ON_DUTY, 10)
    state = advance_clock(state, DutyStatus.OFF, 10)
    state = advance_clock(state, DutyStatus.SLEEPER, 10)

    assert state.drive_since_break_min == 0
    assert state.driving_period_min == 480
    assert state.window_start_min == 0
    assert state.cycle_used_min == 490


def test_driving_between_short_pauses_does_not_create_a_qualifying_break() -> None:
    state = advance_clock(DriverState(), DutyStatus.DRIVING, 479)
    state = advance_clock(state, DutyStatus.OFF, 15)
    state = advance_clock(state, DutyStatus.DRIVING, 1)
    state = advance_clock(state, DutyStatus.OFF, 15)

    assert state.drive_since_break_min == 480
    with pytest.raises(HOSViolation):
        advance_clock(state, DutyStatus.DRIVING, 1)


def test_off_duty_during_shift_does_not_pause_fourteen_hour_clock() -> None:
    state = advance_clock(DriverState(), DutyStatus.ON_DUTY, 300)
    state = advance_clock(state, DutyStatus.DRIVING, 120)
    state = advance_clock(state, DutyStatus.OFF, 419)

    assert state.now_min == 839
    assert state.window_start_min == 0
    assert available_driving_minutes(state) == 1
    state = advance_clock(state, DutyStatus.DRIVING, 1)
    with pytest.raises(HOSViolation):
        advance_clock(state, DutyStatus.DRIVING, 1)


def test_rest_at_599_minutes_does_not_restore_daily_allowance() -> None:
    state = advance_clock(DriverState(), DutyStatus.DRIVING, 480)
    state = advance_clock(state, DutyStatus.ON_DUTY, 30)
    state = advance_clock(state, DutyStatus.DRIVING, 180)
    state = advance_clock(state, DutyStatus.SLEEPER, 599)

    assert state.driving_period_min == 660
    assert available_driving_minutes(state) == 0
    cycle = state.cycle_used_min
    state = advance_clock(state, DutyStatus.SLEEPER, 1)
    assert state.driving_period_min == 0
    assert state.window_start_min is None
    assert state.cycle_used_min == cycle
    assert available_driving_minutes(state) == 480


def test_mixed_off_and_sleeper_rest_restores_daily_allowance() -> None:
    state = advance_clock(DriverState(), DutyStatus.DRIVING, 480)
    state = advance_clock(state, DutyStatus.OFF, 300)
    state = advance_clock(state, DutyStatus.SLEEPER, 300)

    assert state.driving_period_min == 0
    assert state.window_start_min is None
    assert state.cycle_used_min == 480
    state = advance_clock(state, DutyStatus.ON_DUTY, 60)
    assert state.window_start_min == 1080


def test_on_duty_time_interrupts_consecutive_off_duty_rest() -> None:
    state = advance_clock(DriverState(), DutyStatus.DRIVING, 480)
    state = advance_clock(state, DutyStatus.SLEEPER, 300)
    state = advance_clock(state, DutyStatus.ON_DUTY, 1)
    state = advance_clock(state, DutyStatus.OFF, 300)

    assert state.driving_period_min == 480
    assert state.window_start_min == 0
    assert available_driving_minutes(state) == 0


def test_thirty_four_hour_restart_boundary() -> None:
    state = DriverState(cycle_used_min=4200)
    state = advance_clock(state, DutyStatus.OFF, 2039)

    assert state.cycle_used_min == 4200
    assert available_driving_minutes(state) == 0
    state = advance_clock(state, DutyStatus.SLEEPER, 1)
    assert state.cycle_used_min == 0
    assert state.window_start_min is None
    assert available_driving_minutes(state) == 480


def test_on_duty_work_can_continue_when_driving_cycle_is_exhausted() -> None:
    state = advance_clock(DriverState(cycle_used_min=4200), DutyStatus.ON_DUTY, 60)

    assert state.cycle_used_min == 4260
    with pytest.raises(HOSViolation):
        advance_clock(state, DutyStatus.DRIVING, 1)


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf"), True, "55", None])
def test_invalid_mileage_is_rejected(value: object) -> None:
    with pytest.raises(ValueError):
        RouteLeg("Start", "Pickup", cast(Number, value))


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf"), True, "34", None])
def test_invalid_cycle_usage_is_rejected(value: object) -> None:
    with pytest.raises(ValueError):
        schedule_trip(route(), cast(Number, value))


@pytest.mark.parametrize("value", [0, -1, float("nan"), float("inf"), True, "55"])
def test_invalid_average_speed_is_rejected(value: object) -> None:
    with pytest.raises(ValueError):
        TripConfig(average_mph=cast(Number, value))


@pytest.mark.parametrize("duration", [0, -1, True, 0.5])
def test_invalid_duty_duration_is_rejected(duration: object) -> None:
    with pytest.raises(ValueError):
        advance_clock(DriverState(), DutyStatus.OFF, cast(int, duration))


def test_empty_location_label_is_rejected() -> None:
    with pytest.raises(ValueError, match="labels"):
        RouteLeg("", "Pickup", 1)


def test_wrong_number_of_route_legs_is_rejected() -> None:
    with pytest.raises(ValueError, match="two"):
        schedule_trip([RouteLeg("Start", "End", 10)])


def test_disconnected_route_legs_are_rejected() -> None:
    with pytest.raises(ValueError, match="connect"):
        schedule_trip([RouteLeg("Start", "Pickup", 10), RouteLeg("Other", "End", 10)])


@settings(max_examples=300, derandomize=True, deadline=None, database=None)
@given(
    first_thousandths=st.integers(0, 10_000_000),
    second_thousandths=st.integers(0, 10_000_000),
    cycle_min=st.integers(0, 4200),
)
@example(first_thousandths=0, second_thousandths=0, cycle_min=4200)
@example(first_thousandths=440_000, second_thousandths=55_000, cycle_min=4140)
@example(first_thousandths=1_000_000, second_thousandths=1, cycle_min=2040)
def test_generated_trips_preserve_all_hos_distance_and_continuity_invariants(
    first_thousandths: int, second_thousandths: int, cycle_min: int
) -> None:
    legs = route(Fraction(first_thousandths, 1000), Fraction(second_thousandths, 1000))
    plan = schedule_trip(legs, Fraction(cycle_min, 60))

    assert plan.total_miles == sum(leg.distance_miles for leg in legs)
    assert plan.count(EventType.PICKUP) == 1
    assert plan.count(EventType.DROPOFF) == 1
    replay(plan)


@settings(max_examples=150, derandomize=True, deadline=None, database=None)
@given(
    first_miles=st.integers(0, 3000),
    second_miles=st.integers(0, 3000),
    pickup_min=st.integers(1, 1200),
    speed=st.integers(10, 125),
    cycle_min=st.integers(0, 4200),
)
def test_generated_long_work_and_variable_speed_preserve_hos_invariants(
    first_miles: int,
    second_miles: int,
    pickup_min: int,
    speed: int,
    cycle_min: int,
) -> None:
    config = TripConfig(average_mph=speed, pickup_min=pickup_min)
    plan = schedule_trip(
        route(first_miles, second_miles), Fraction(cycle_min, 60), config=config
    )

    replay(plan, config)

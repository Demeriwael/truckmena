"""Pure property-carrying HOS scheduling with integer clocks and exact mileage.

The caller supplies provider distances, not provider travel durations. This
module has no Django, network, filesystem, timezone, or database dependencies.
Every emitted event occupies a positive, contiguous interval since trip start.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from decimal import Decimal
from enum import StrEnum
from fractions import Fraction

type Number = int | float | Decimal | Fraction

AVG_MPH = 55
DRIVING_LIMIT_MIN = 11 * 60
WINDOW_LIMIT_MIN = 14 * 60
BREAK_DRIVING_LIMIT_MIN = 8 * 60
CYCLE_LIMIT_MIN = 70 * 60
BREAK_MIN = 30
REST_MIN = 10 * 60
RESTART_MIN = 34 * 60
FUEL_MIN = 30
FUEL_INTERVAL_MILES = 1000


class DutyStatus(StrEnum):
    OFF = "OFF"
    SLEEPER = "SLEEPER"
    DRIVING = "DRIVING"
    ON_DUTY = "ON_DUTY"


class EventType(StrEnum):
    DRIVING = "driving"
    PICKUP = "pickup"
    DROPOFF = "dropoff"
    BREAK = "break"
    REST = "rest"
    RESTART = "restart"
    FUEL = "fuel"


class HOSViolation(ValueError):
    """A requested driving interval exceeds an available HOS clock."""


def _fraction(value: Number, name: str) -> Fraction:
    """Use decimal intent for floats; reject booleans and non-finite values."""
    if isinstance(value, bool) or not isinstance(
        value, (int, float, Decimal, Fraction)
    ):
        raise ValueError(f"{name} must be a finite number")
    try:
        return Fraction(str(value))
    except (ValueError, ZeroDivisionError) as error:
        raise ValueError(f"{name} must be a finite number") from error


def _integer(value: int, name: str, *, minimum: int = 0) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")


def _ceil(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


@dataclass(frozen=True, slots=True)
class RouteLeg:
    from_place: str
    to_place: str
    miles: Number

    def __post_init__(self) -> None:
        for label in (self.from_place, self.to_place):
            if not isinstance(label, str) or not label.strip():
                raise ValueError("Leg locations must have non-empty labels")
        distance = _fraction(self.miles, "Leg miles")
        if distance < 0:
            raise ValueError("Leg miles must be >= 0")
        object.__setattr__(self, "miles", distance)

    @property
    def distance_miles(self) -> Fraction:
        return _fraction(self.miles, "Leg miles")


@dataclass(frozen=True, slots=True)
class TripConfig:
    """Assessment defaults; work durations can vary in domain-level fixtures.

    The REST API will use the fixed 60-minute pickup and delivery defaults.
    Longer work fixtures exercise a 14-hour window without inventing prior duty.
    """

    average_mph: Number = AVG_MPH
    pickup_min: int = 60
    dropoff_min: int = 60

    def __post_init__(self) -> None:
        if _fraction(self.average_mph, "Average speed") <= 0:
            raise ValueError("Average speed must be > 0")
        _integer(self.pickup_min, "Pickup duration", minimum=1)
        _integer(self.dropoff_min, "Dropoff duration", minimum=1)

    @property
    def miles_per_minute(self) -> Fraction:
        return _fraction(self.average_mph, "Average speed") / 60


@dataclass(frozen=True, slots=True)
class DriverState:
    """Driving allowance is per duty period, never reset just by midnight."""

    now_min: int = 0
    cycle_used_min: int = 0
    driving_period_min: int = 0
    drive_since_break_min: int = 0
    window_start_min: int | None = None
    non_driving_min: int = 0
    off_duty_min: int = 0

    def __post_init__(self) -> None:
        for name in (
            "now_min",
            "cycle_used_min",
            "driving_period_min",
            "drive_since_break_min",
            "non_driving_min",
            "off_duty_min",
        ):
            _integer(getattr(self, name), name)
        if self.window_start_min is not None:
            _integer(self.window_start_min, "window_start_min")
            if self.window_start_min > self.now_min:
                raise ValueError("Duty window cannot start in the future")
        if not (
            0
            <= self.drive_since_break_min
            <= self.driving_period_min
            <= DRIVING_LIMIT_MIN
        ):
            raise ValueError("Driving counters exceed the duty-period allowance")
        if self.drive_since_break_min > BREAK_DRIVING_LIMIT_MIN:
            raise ValueError("Driving counter exceeds the break allowance")
        if not 0 <= self.off_duty_min <= self.non_driving_min <= self.now_min:
            raise ValueError("Consecutive non-driving counters are inconsistent")


def available_driving_minutes(state: DriverState) -> int:
    """Return the tightest HOS allowance, without changing any clock."""
    window_start = (
        state.now_min if state.window_start_min is None else state.window_start_min
    )
    return max(
        0,
        min(
            DRIVING_LIMIT_MIN - state.driving_period_min,
            window_start + WINDOW_LIMIT_MIN - state.now_min,
            BREAK_DRIVING_LIMIT_MIN - state.drive_since_break_min,
            CYCLE_LIMIT_MIN - state.cycle_used_min,
        ),
    )


def advance_clock(
    state: DriverState, status: DutyStatus, duration_min: int
) -> DriverState:
    """Apply one contiguous duty interval and return a new immutable state.

    Thirty consecutive non-driving minutes can span different statuses. Ten
    consecutive OFF/SLEEPER hours restore daily clocks; 34 also restore cycle
    hours. Non-driving work may finish past a limit that prohibits driving.
    """
    _integer(duration_min, "Duty duration", minimum=1)
    status = DutyStatus(status)
    if status == DutyStatus.DRIVING and duration_min > available_driving_minutes(state):
        raise HOSViolation("Driving interval exceeds an available HOS clock")

    on_duty = status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY)
    driving = status == DutyStatus.DRIVING
    non_driving = 0 if driving else state.non_driving_min + duration_min
    off_duty = 0 if on_duty else state.off_duty_min + duration_min
    window_start = state.window_start_min
    if on_duty and window_start is None:
        window_start = state.now_min

    result = replace(
        state,
        now_min=state.now_min + duration_min,
        cycle_used_min=state.cycle_used_min + (duration_min if on_duty else 0),
        driving_period_min=state.driving_period_min + (duration_min if driving else 0),
        drive_since_break_min=(
            0
            if non_driving >= BREAK_MIN
            else state.drive_since_break_min + (duration_min if driving else 0)
        ),
        window_start_min=window_start,
        non_driving_min=non_driving,
        off_duty_min=off_duty,
    )
    if off_duty >= REST_MIN:
        result = replace(
            result,
            driving_period_min=0,
            drive_since_break_min=0,
            window_start_min=None,
        )
    if off_duty >= RESTART_MIN:
        result = replace(result, cycle_used_min=0)
    return result


@dataclass(frozen=True, slots=True)
class Event:
    id: str
    type: EventType
    status: DutyStatus
    start_min: int
    end_min: int
    start_mile: Fraction
    end_mile: Fraction
    leg_index: int
    place: str
    note: str
    cycle_used_before_min: int
    cycle_used_after_min: int

    @property
    def duration_min(self) -> int:
        return self.end_min - self.start_min

    @property
    def distance_miles(self) -> Fraction:
        return self.end_mile - self.start_mile

    @property
    def mile_marker(self) -> Fraction:
        """Route position at the event's start/status-change time."""
        return self.start_mile


@dataclass(frozen=True, slots=True)
class TripSchedule:
    events: tuple[Event, ...]
    initial_cycle_used_min: int
    final_state: DriverState
    total_miles: Fraction
    miles_since_fuel_at_end: Fraction

    @property
    def total_driving_min(self) -> int:
        return sum(
            event.duration_min
            for event in self.events
            if event.status == DutyStatus.DRIVING
        )

    @property
    def total_duration_min(self) -> int:
        return self.final_state.now_min

    @property
    def cycle_remaining_min(self) -> int:
        return max(0, CYCLE_LIMIT_MIN - self.final_state.cycle_used_min)

    def count(self, event_type: EventType) -> int:
        return sum(event.type == event_type for event in self.events)


def schedule_trip(
    legs: Sequence[RouteLeg],
    cycle_used_hours: Number = 0,
    *,
    config: TripConfig | None = None,
) -> TripSchedule:
    """Schedule current -> pickup -> dropoff, inserting only necessary stops.

    Provider miles remain exact Fractions. A driving chunk lasts
    ceil(miles / speed * 60) minutes; HOS clocks always stay integral.
    Fractional final minutes at a fuel frontier or leg end count as a whole
    driving minute. This is conservative and never exceeds the planning speed.
    """
    if config is None:
        config = TripConfig()
    if len(legs) != 2 or not all(isinstance(leg, RouteLeg) for leg in legs):
        raise ValueError("Exactly two route legs are required")
    if legs[0].to_place != legs[1].from_place:
        raise ValueError("Route legs must connect at the pickup location")
    cycle_hours = _fraction(cycle_used_hours, "Cycle hours")
    if cycle_hours < 0:
        raise ValueError("Cycle hours must be >= 0")

    initial_cycle = _ceil(cycle_hours * 60)
    state = DriverState(cycle_used_min=initial_cycle)
    position = Fraction(0)
    miles_since_fuel = Fraction(0)
    events: list[Event] = []
    speed = config.miles_per_minute

    def emit(
        event_type: EventType,
        status: DutyStatus,
        duration: int,
        leg_index: int,
        place: str,
        note: str,
        distance: Fraction = Fraction(0),
    ) -> None:
        nonlocal state, position, miles_since_fuel
        after = advance_clock(state, status, duration)
        events.append(
            Event(
                id=f"event-{len(events) + 1:04d}",
                type=event_type,
                status=status,
                start_min=state.now_min,
                end_min=after.now_min,
                start_mile=position,
                end_mile=position + distance,
                leg_index=leg_index,
                place=place,
                note=note,
                cycle_used_before_min=state.cycle_used_min,
                cycle_used_after_min=after.cycle_used_min,
            )
        )
        state = after
        position += distance
        miles_since_fuel = (
            Fraction(0) if event_type == EventType.FUEL else miles_since_fuel + distance
        )

    def route_place(leg: RouteLeg, remaining: Fraction) -> str:
        if remaining == leg.distance_miles:
            return leg.from_place
        return f"Mile {float(position):,.1f} on route"

    # An already exhausted input cycle restarts first, including zero-mile legs.
    if initial_cycle >= CYCLE_LIMIT_MIN:
        emit(
            EventType.RESTART,
            DutyStatus.OFF,
            RESTART_MIN,
            0,
            legs[0].from_place,
            "Initial cycle exhausted; take a 34-hour restart",
        )

    for index, leg in enumerate(legs):
        remaining = leg.distance_miles
        while remaining > 0:
            place = route_place(leg, remaining)
            # Resolve simultaneous obligations in order of the longest reset.
            # Fuel precedes an 8-hour break so one stop satisfies both.
            if state.cycle_used_min >= CYCLE_LIMIT_MIN:
                emit(
                    EventType.RESTART,
                    DutyStatus.OFF,
                    RESTART_MIN,
                    index,
                    place,
                    "Cycle exhausted; take a 34-hour restart before driving",
                )
                continue
            if state.driving_period_min >= DRIVING_LIMIT_MIN or (
                state.window_start_min is not None
                and state.now_min >= state.window_start_min + WINDOW_LIMIT_MIN
            ):
                reason = (
                    "11-hour driving limit"
                    if state.driving_period_min >= DRIVING_LIMIT_MIN
                    else "14-hour duty window"
                )
                emit(
                    EventType.REST,
                    DutyStatus.SLEEPER,
                    REST_MIN,
                    index,
                    place,
                    f"{reason} reached; take 10 hours in sleeper berth",
                )
                continue
            if miles_since_fuel >= FUEL_INTERVAL_MILES:
                emit(
                    EventType.FUEL,
                    DutyStatus.ON_DUTY,
                    FUEL_MIN,
                    index,
                    place,
                    "Fuel stop; also satisfies the 30-minute driving break",
                )
                continue
            if state.drive_since_break_min >= BREAK_DRIVING_LIMIT_MIN:
                emit(
                    EventType.BREAK,
                    DutyStatus.OFF,
                    BREAK_MIN,
                    index,
                    place,
                    "Eight cumulative driving hours; take a 30-minute break",
                )
                continue

            fuel_distance = FUEL_INTERVAL_MILES - miles_since_fuel
            duration = min(
                available_driving_minutes(state),
                _ceil(remaining / speed),
                _ceil(fuel_distance / speed),
            )
            distance = min(remaining, fuel_distance, duration * speed)
            emit(
                EventType.DRIVING,
                DutyStatus.DRIVING,
                duration,
                index,
                place,
                f"Drive toward {leg.to_place}",
                distance,
            )
            remaining -= distance

        pickup = index == 0
        emit(
            EventType.PICKUP if pickup else EventType.DROPOFF,
            DutyStatus.ON_DUTY,
            config.pickup_min if pickup else config.dropoff_min,
            index,
            leg.to_place,
            "Load freight at pickup" if pickup else "Unload freight at delivery",
        )

    return TripSchedule(
        events=tuple(events),
        initial_cycle_used_min=initial_cycle,
        final_state=state,
        total_miles=position,
        miles_since_fuel_at_end=miles_since_fuel,
    )

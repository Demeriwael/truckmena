"""Pure calendar-day logs with exact minutes, mileage, and cycle recap state.

Display padding is OFF; it never changes the scheduler's actual cycle state.
All dates use one fixed departure offset, including trips crossing DST dates.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from itertools import pairwise

from trips.services.hos_engine import (
    CYCLE_LIMIT_MIN,
    DutyStatus,
    Event,
    EventType,
    TripSchedule,
)

MINUTES_PER_DAY = 1440
STATUSES = tuple(DutyStatus)
TOTAL_KEYS = ("off", "sleeper", "driving", "on_duty")
ON_DUTY_STATUSES = (DutyStatus.DRIVING, DutyStatus.ON_DUTY)
HISTORY_NOTE = (
    "Planning recap: prior daily history is unavailable; no rolling hours drop off. "
    "C uses the last five trip days, including today."
)


@dataclass(frozen=True, slots=True)
class LogMetadata:
    driver_name: str = "Demo Driver"
    carrier_name: str = "Demo Freight LLC"
    main_office_address: str = "Chicago, IL"
    home_terminal_address: str = "Chicago, IL"
    vehicle: str = "Truck 101 / Trailer 201"
    shipping_doc: str = "DEMO-001 / General freight"


@dataclass(frozen=True, slots=True)
class LogSegment:
    status: DutyStatus
    start_min_of_day: int
    end_min_of_day: int
    place: str
    start_mile: Fraction
    end_mile: Fraction
    event_id: str | None
    is_padding: bool = False

    @property
    def duration_min(self) -> int:
        return self.end_min_of_day - self.start_min_of_day

    @property
    def miles(self) -> Fraction:
        return self.end_mile - self.start_mile


@dataclass(frozen=True, slots=True)
class LogRemark:
    minute_of_day: int
    place: str
    note: str


@dataclass(frozen=True, slots=True)
class Recap:
    cycle_used_min: int
    last_five_days_on_duty_min: int
    on_duty_today_min: int
    restart_taken: bool
    restart_in_progress: bool

    @property
    def available_min(self) -> int:
        return max(0, CYCLE_LIMIT_MIN - self.cycle_used_min)

    def to_dict(self) -> dict:
        notes = [HISTORY_NOTE]
        if self.restart_taken:
            notes.append("34-hour restart taken")
        if self.restart_in_progress:
            notes.append("34-hour restart in progress; cycle has not reset yet")
        return {
            "a": _hours(self.cycle_used_min),
            "b": _hours(self.available_min),
            "c": _hours(self.last_five_days_on_duty_min),
            "on_duty_today": _hours(self.on_duty_today_min),
            "cycle_used_min": self.cycle_used_min,
            "available_min": self.available_min,
            "last_five_days_on_duty_min": self.last_five_days_on_duty_min,
            "restart_taken": self.restart_taken,
            "restart_in_progress": self.restart_in_progress,
            "notes": notes,
        }


def _hours(minutes: int) -> float:
    return float((Decimal(minutes) / 60).quantize(Decimal("0.01"), ROUND_HALF_UP))


def _display_totals(totals_min: tuple[int, ...]) -> dict[str, float]:
    """Apportion hundredths by largest remainder instead of rounding to 23.99/24.01."""
    hundredths = [minutes * 100 // 60 for minutes in totals_min]
    remainders = [minutes * 100 % 60 for minutes in totals_min]
    order = sorted(range(4), key=lambda index: (-remainders[index], index))
    for index in order[: 2400 - sum(hundredths)]:
        hundredths[index] += 1
    assert sum(hundredths) == 2400, "Displayed log totals must equal 24.00 hours"
    return dict(zip(TOTAL_KEYS, (value / 100 for value in hundredths), strict=True))


@dataclass(frozen=True, slots=True)
class DailyLog:
    date: str
    iso_date: str
    from_place: str
    to_place: str
    total_miles: Fraction
    cumulative_trip_miles: Fraction
    totals_min: tuple[int, int, int, int]
    segments: tuple[LogSegment, ...]
    remarks: tuple[LogRemark, ...]
    recap: Recap
    metadata: LogMetadata
    timezone_offset: str

    def to_dict(self) -> dict:
        return {
            "date": self.date,
            "iso_date": self.iso_date,
            "from": self.from_place,
            "to": self.to_place,
            "total_miles": float(self.total_miles),
            # No non-driving mileage/odometer history is supplied by the assessment.
            "total_mileage_today": float(self.total_miles),
            "cumulative_trip_miles": float(self.cumulative_trip_miles),
            "totals": _display_totals(self.totals_min),
            "totals_min": dict(zip(TOTAL_KEYS, self.totals_min, strict=True)),
            "segments": [
                {
                    "status": segment.status.value,
                    "start_min_of_day": segment.start_min_of_day,
                    "end_min_of_day": segment.end_min_of_day,
                    "place": segment.place,
                    "start_mile_marker": float(segment.start_mile),
                    "end_mile_marker": float(segment.end_mile),
                    "event_id": segment.event_id,
                    "is_padding": segment.is_padding,
                }
                for segment in self.segments
            ],
            "remarks": [
                {
                    "minute_of_day": remark.minute_of_day,
                    "place": remark.place,
                    "note": remark.note,
                }
                for remark in self.remarks
            ],
            "recap": self.recap.to_dict(),
            "driver_name": self.metadata.driver_name,
            "carrier_name": self.metadata.carrier_name,
            "main_office_address": self.metadata.main_office_address,
            "home_terminal_address": self.metadata.home_terminal_address,
            "vehicle": self.metadata.vehicle,
            "shipping_doc": self.metadata.shipping_doc,
            "timezone_offset": self.timezone_offset,
            "period_start": "00:00",
        }


def _validate_schedule(schedule: TripSchedule) -> None:
    if not schedule.events or schedule.total_duration_min <= 0:
        raise ValueError("A nonempty duty schedule is required")
    minute, mile = 0, Fraction(0)
    cycle = schedule.initial_cycle_used_min
    for event in schedule.events:
        if any(type(value) is not int for value in (event.start_min, event.end_min)):
            raise ValueError("Event times must use integer minutes")
        if (
            event.start_min != minute
            or event.start_mile != mile
            or event.duration_min <= 0
        ):
            raise ValueError(
                "Events must have positive contiguous intervals and mileage"
            )
        if event.end_mile < event.start_mile or event.status not in STATUSES:
            raise ValueError("Invalid event mileage or duty status")
        if event.status != DutyStatus.DRIVING and event.distance_miles != 0:
            raise ValueError("Only driving events may accumulate mileage")
        if event.cycle_used_before_min != cycle:
            raise ValueError("Event cycle state is not contiguous")
        cycle = event.cycle_used_after_min
        minute, mile = event.end_min, event.end_mile
    if (minute, mile, cycle) != (
        schedule.total_duration_min,
        schedule.total_miles,
        schedule.final_state.cycle_used_min,
    ):
        raise ValueError("Final state does not match the event schedule")


def _cycle_at(schedule: TripSchedule, cutoff_min: int) -> int:
    """Use actual cycle snapshots, including resets at a restart's exact end."""
    cycle = schedule.initial_cycle_used_min
    for event in schedule.events:
        if cutoff_min >= event.end_min:
            cycle = event.cycle_used_after_min
        elif cutoff_min > event.start_min:
            elapsed = cutoff_min - event.start_min
            return event.cycle_used_before_min + (
                elapsed if event.status in ON_DUTY_STATUSES else 0
            )
        else:
            break
    return cycle


def _mile_at(event: Event, elapsed_min: int) -> Fraction:
    return event.start_mile + event.distance_miles * Fraction(
        elapsed_min, event.duration_min
    )


def _mile_label(mile: Fraction) -> str:
    return f"Mile {float(mile):,.1f} on route"


def build_daily_logs(
    schedule: TripSchedule,
    start: datetime,
    *,
    metadata: LogMetadata | None = None,
    places: Mapping[str, str] | None = None,
) -> tuple[DailyLog, ...]:
    """Split positive engine intervals at midnight and fill only outer-day gaps.

    Miles are distributed uniformly within each driving interval using exact
    fractions. Enriched event places are optional; this module never does I/O.
    Each sheet asserts 1,440 consecutive minutes, including OFF display padding.
    """
    _validate_schedule(schedule)
    if start.tzinfo is None or start.utcoffset() is None:
        raise ValueError("Departure needs a timezone offset")
    if start.second or start.microsecond:
        raise ValueError("Departure must use whole minutes")
    if start.utcoffset().total_seconds() % 60:
        raise ValueError("Departure offset must use whole minutes")
    start = start.astimezone(timezone(start.utcoffset()))
    start_of_day = start.hour * 60 + start.minute
    # Integer exclusive end avoids creating an empty sheet after exact midnight.
    day_count = (start_of_day + schedule.total_duration_min - 1) // MINUTES_PER_DAY + 1
    metadata = metadata or LogMetadata()
    places = places or {}
    event_places = [places.get(event.id, event.place) for event in schedule.events]
    segments: list[list[LogSegment]] = [[] for _ in range(day_count)]
    remarks: list[list[LogRemark]] = [[] for _ in range(day_count)]
    day_to = [""] * day_count
    if start_of_day:
        segments[0].append(
            LogSegment(
                DutyStatus.OFF,
                0,
                start_of_day,
                event_places[0],
                Fraction(0),
                Fraction(0),
                None,
                True,
            )
        )
    for index, event in enumerate(schedule.events):
        elapsed = 0
        while elapsed < event.duration_min:
            day_index, minute = divmod(
                start_of_day + event.start_min + elapsed, MINUTES_PER_DAY
            )
            duration = min(event.duration_min - elapsed, MINUTES_PER_DAY - minute)
            start_mile = _mile_at(event, elapsed)
            end_mile = _mile_at(event, elapsed + duration)
            place = (
                _mile_label(start_mile)
                if elapsed and event.status == DutyStatus.DRIVING
                else event_places[index]
            )
            segments[day_index].append(
                LogSegment(
                    event.status,
                    minute,
                    minute + duration,
                    place,
                    start_mile,
                    end_mile,
                    event.id,
                )
            )
            note = (
                event.note
                if elapsed == 0
                else f"Continue {event.type.value} across midnight"
            )
            remarks[day_index].append(LogRemark(minute, place, note))
            end_place = event_places[index]
            if event.status == DutyStatus.DRIVING:
                end_place = (
                    event_places[index + 1]
                    if elapsed + duration == event.duration_min
                    and index + 1 < len(event_places)
                    else _mile_label(end_mile)
                )
            day_to[day_index] = end_place
            if (
                event.type == EventType.RESTART
                and elapsed + duration == event.duration_min
            ):
                remarks[day_index].append(
                    LogRemark(minute + duration, end_place, "34-hour restart taken")
                )
            elapsed += duration
    last_segment = segments[-1][-1]
    if last_segment.end_min_of_day < MINUTES_PER_DAY:
        segments[-1].append(
            LogSegment(
                DutyStatus.OFF,
                last_segment.end_min_of_day,
                MINUTES_PER_DAY,
                day_to[-1],
                schedule.total_miles,
                schedule.total_miles,
                None,
                True,
            )
        )
        remarks[-1].append(
            LogRemark(
                last_segment.end_min_of_day,
                day_to[-1],
                "Trip finished; remaining day shown off duty",
            )
        )

    sheets = []
    daily_on_duty = []
    cumulative_miles = Fraction(0)
    for day_index, pieces in enumerate(segments):
        assert (
            pieces[0].start_min_of_day == 0
            and pieces[-1].end_min_of_day == MINUTES_PER_DAY
        )
        assert all(
            0 <= piece.start_min_of_day < piece.end_min_of_day <= MINUTES_PER_DAY
            for piece in pieces
        )
        assert all(
            left.end_min_of_day == right.start_min_of_day
            for left, right in pairwise(pieces)
        )
        totals = tuple(
            sum(piece.duration_min for piece in pieces if piece.status == status)
            for status in STATUSES
        )
        assert (
            sum(totals) == MINUTES_PER_DAY
        ), "Every daily log must total exactly 24 hours"
        miles = sum((piece.miles for piece in pieces), Fraction(0))
        cumulative_miles += miles
        daily_on_duty.append(totals[2] + totals[3])
        cutoff = (day_index + 1) * MINUTES_PER_DAY - start_of_day
        restart_taken = any(
            event.type == EventType.RESTART
            and cutoff - MINUTES_PER_DAY < event.end_min <= cutoff
            for event in schedule.events
        )
        restart_in_progress = any(
            event.type == EventType.RESTART and event.start_min < cutoff < event.end_min
            for event in schedule.events
        )
        day = start.date() + timedelta(days=day_index)
        sheets.append(
            DailyLog(
                f"{day.month:02d}/{day.day:02d}/{day.year:04d}",
                day.isoformat(),
                pieces[0].place,
                day_to[day_index],
                miles,
                cumulative_miles,
                totals,
                tuple(pieces),
                tuple(remarks[day_index]),
                Recap(
                    _cycle_at(schedule, cutoff),
                    sum(daily_on_duty[-5:]),
                    daily_on_duty[-1],
                    restart_taken,
                    restart_in_progress,
                ),
                metadata,
                start.isoformat()[-6:],
            )
        )
    assert (
        cumulative_miles == schedule.total_miles
    ), "Daily mileage must preserve provider miles"
    return tuple(sheets)

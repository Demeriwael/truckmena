import { describe, expect, it } from "vitest";
import type { TripEvent } from "./contracts";
import { dutyTotals, itineraryDays } from "./plan-view";
import { calendarDay, clockTime, tripOffset } from "./format";
import fixture from "@/test/fixtures/trip.json";

function event(start: string, end: string, duration: number): TripEvent {
  return {
    id: "overnight",
    type: "rest",
    status: "SLEEPER",
    start,
    end,
    duration_min: duration,
    lat: 40,
    lng: -90,
    place: "Rest location",
    mile_marker: 100,
    end_mile_marker: 100,
    note: "Rest",
  };
}
describe("fixed-offset itinerary days", () => {
  it.each(["-05:00", "+05:45", "+14:00", "-12:00", "Z"])(
    "splits at trip midnight with offset %s",
    (offset) => {
      const original = event(
        `2026-10-03T23:30:00${offset}`,
        `2026-10-04T09:30:00${offset}`,
        600,
      );
      const days = itineraryDays([original]);
      expect(days.map((day) => day.date)).toEqual(["2026-10-03", "2026-10-04"]);
      const entries = days.flatMap((day) => day.entries);
      expect(entries.map((entry) => entry.durationMin)).toEqual([30, 570]);
      expect(entries.map((entry) => [entry.continued, entry.continues])).toEqual([
        [false, true],
        [true, false],
      ]);
      expect(entries[1]?.start).toBe(`2026-10-04T00:00:00${offset}`);
      expect(entries.every((entry) => entry.event === original)).toBe(true);
    },
  );
  it.each([
    ["2026-12-31T23:30:00-05:00", "2027-01-01T00:30:00-05:00", "2027-01-01"],
    ["2028-02-28T23:30:00+05:45", "2028-02-29T00:30:00+05:45", "2028-02-29"],
    ["2026-11-01T23:30:00-05:00", "2026-11-02T00:30:00-05:00", "2026-11-02"],
  ])("preserves chronology across %s", (start, end, nextDate) => {
    const days = itineraryDays([event(start, end, 60)]);
    expect(days.at(-1)?.date).toBe(nextDate);
    expect(
      days
        .flatMap((day) => day.entries)
        .reduce((sum, entry) => sum + entry.durationMin, 0),
    ).toBe(60);
  });
  it("does not create an empty day at an exact midnight finish", () => {
    const days = itineraryDays([
      event("2026-10-03T14:00:00-05:00", "2026-10-04T00:00:00-05:00", 600),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0]?.entries[0]?.continues).toBe(false);
  });
  it("preserves every minute of a restart spanning three dates", () => {
    const original = {
      ...event("2026-10-03T23:00:00-05:00", "2026-10-05T09:00:00-05:00", 2040),
      type: "restart" as const,
      status: "OFF" as const,
    };
    const entries = itineraryDays([original]).flatMap((day) => day.entries);
    expect(entries.map((entry) => entry.durationMin)).toEqual([60, 1440, 540]);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(3);
    expect(entries.every((entry) => entry.event.id === original.id)).toBe(true);
  });
  it("keeps a zero-duration departure and following events in order", () => {
    const events = fixture.events as TripEvent[];
    const entries = itineraryDays(events).flatMap((day) => day.entries);
    expect(entries.map((entry) => entry.event.id)).toEqual(
      events.map((item) => item.id),
    );
    expect(entries[0]?.durationMin).toBe(0);
    expect(entries.reduce((sum, entry) => sum + entry.durationMin, 0)).toBe(300);
    expect(dutyTotals(events)).toEqual({
      OFF: 0,
      SLEEPER: 0,
      DRIVING: 180,
      ON_DUTY: 120,
    });
  });
  it("formats clocks and days without using the browser's timezone", () => {
    expect(clockTime("2026-10-03T23:30:00+05:45")).toBe("11:30 PM");
    expect(calendarDay("2026-10-03")).toBe("Sat, Oct 3");
    expect(tripOffset("2026-10-03T23:30:00+05:45")).toBe("UTC+05:45");
    expect(tripOffset("2026-10-03T23:30:00Z")).toBe("UTC+00:00");
  });
});

import { describe, expect, it } from "vitest";
import { tripPlanSchema } from "./contracts";
import {
  logClock,
  logSheetLayout,
  mapLogSegments,
  minuteToX,
  wrapLogText,
} from "./log-sheet";
import fixture from "@/test/fixtures/trip.json";

const log = tripPlanSchema.parse(fixture).logs[0]!;
describe("log graph geometry", () => {
  it.each([
    [0, 184],
    [15, 193],
    [30, 202],
    [60, 220],
    [720, 616],
    [1440, 1048],
    [41, 208.6],
  ])("maps minute %i exactly to %f without quarter-hour rounding", (minute, x) => {
    expect(minuteToX(minute)).toBeCloseTo(x, 8);
  });
  it.each([-1, 1441, NaN, Infinity])("rejects invalid minute %s", (minute) => {
    expect(() => minuteToX(minute)).toThrow(RangeError);
  });
  it("replays the fixture with its exact status changes and full-day OFF padding", () => {
    const mapped = mapLogSegments(log.segments, 100);
    expect(mapped.points).toBe(
      "184,120 472,120 472,200 544,200 544,240 580,240 580,200 616,200 616,240 652,240 652,120 1048,120",
    );
    expect(mapped.changes.map(({ minute }) => minute)).toEqual([
      480, 600, 660, 720, 780,
    ]);
    expect(
      log.totals_min.off +
        log.totals_min.sleeper +
        log.totals_min.driving +
        log.totals_min.on_duty,
    ).toBe(1440);
  });
  it("keeps a continued whole-day sleeper rest horizontal and avoids duplicate same-status changes", () => {
    const first = {
      ...log.segments[0]!,
      status: "SLEEPER" as const,
      start_min_of_day: 0,
      end_min_of_day: 600,
    };
    const second = { ...first, start_min_of_day: 600, end_min_of_day: 1440 };
    expect(mapLogSegments([first, second], 100)).toEqual({
      points: "184,160 544,160 1048,160",
      changes: [],
    });
  });
  it.each(["gap", "overlap", "short-day", "fractional", "empty"])(
    "rejects a %s instead of drawing a misleading clock",
    (kind) => {
      const segments = structuredClone(log.segments);
      if (kind === "gap") segments[1]!.start_min_of_day++;
      if (kind === "overlap") segments[1]!.start_min_of_day--;
      if (kind === "short-day") segments.at(-1)!.end_min_of_day--;
      if (kind === "fractional") segments[0]!.end_min_of_day = 480.5;
      if (kind === "empty") segments.length = 0;
      expect(() => mapLogSegments(segments, 100)).toThrow(RangeError);
    },
  );
});
describe("sheet text layout", () => {
  it("preserves long unbroken text and Unicode without cutting surrogate pairs", () => {
    const text = "🚚".repeat(80);
    expect(wrapLogText(text, 160).join("")).toBe(text);
    expect(wrapLogText('A & B <Freight> "carrier"', 120).join(" ")).toBe(
      'A & B <Freight> "carrier"',
    );
    expect(logClock(1440)).toBe("24:00");
    expect(logClock(5)).toBe("00:05");
  });
  it("grows to retain complete header fields, remarks and warnings", () => {
    const long = structuredClone(log);
    long.carrier_name = "Carrier ".repeat(20);
    long.main_office_address = "Long address ".repeat(23);
    long.remarks = Array.from({ length: 22 }, (_, index) => ({
      minute_of_day: index * 60,
      place: "A long city and full state name ".repeat(5),
      note: "Complete event note ".repeat(8),
    }));
    const layout = logSheetLayout(long, ["Provider fallback warning ".repeat(10)]);
    expect(layout.height).toBeGreaterThan(logSheetLayout(log).height);
    expect(layout.remarkRows).toHaveLength(22);
    expect(layout.remarksBands).toBe(3);
    expect(
      layout.headers
        .find(({ label }) => label === "NAME OF CARRIER OR CARRIERS")!
        .lines.join(" "),
    ).toBe(long.carrier_name.trim());
    expect(layout.noteLines.join(" ")).toContain("Provider fallback warning");
    expect(layout.footerY).toBeLessThan(layout.height);
  });
});

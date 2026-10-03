import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { tripPlanSchema } from "@/lib/contracts";
import fixture from "@/test/fixtures/trip.json";
import { DailyLogSheet } from "./daily-log-sheet";

const log = tripPlanSchema.parse(fixture).logs[0]!;
describe("daily log sheet", () => {
  it("renders one accessible 24-hour sheet with the exact API totals and filled headers", () => {
    const { container } = render(<DailyLogSheet log={log} day={2} count={6} />);
    expect(
      screen.getByRole("img", {
        name: /Driver's Daily Log - 10\/03\/2026 - Day 2 of 6/,
      }),
    ).toHaveAccessibleDescription();
    expect(screen.getByText("Demo Freight LLC")).toBeInTheDocument();
    expect(screen.getByText("Truck 101 / Trailer 201")).toBeInTheDocument();
    expect(screen.getByText("19.00")).toBeInTheDocument();
    expect(screen.getByText("3.00")).toBeInTheDocument();
    expect(screen.getByText("2.00")).toBeInTheDocument();
    expect(container.querySelector("polyline[data-duty-line]")).toHaveAttribute(
      "stroke-width",
      "3.4",
    );
    expect(screen.getByText(/remaining day shown off duty/)).toBeInTheDocument();
    expect(screen.getByText(/DRIVER NAME \(UNSIGNED\)/)).toBeInTheDocument();
  });
  it("escapes custom values and prints the restart and provider warning", () => {
    const custom = structuredClone(log);
    custom.carrier_name = "<script>alert(1)</script> & Freight";
    custom.recap.notes.push("34-hour restart taken");
    const { container } = render(
      <DailyLogSheet
        log={custom}
        day={1}
        count={1}
        warnings={["Truck restrictions are not verified for this fallback route."]}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(custom.carrier_name);
    expect(screen.getByText("34-hour restart taken")).toBeInTheDocument();
    expect(container.textContent).toContain("Truck restrictions are not verified");
  });
});

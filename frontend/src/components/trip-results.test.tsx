import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tripPlanSchema, type TripPlan } from "@/lib/contracts";
import type { EventSelection, ResultTab } from "@/lib/plan-view";
import fixture from "@/test/fixtures/trip.json";
import { TripResults } from "./trip-results";
import { TripSummary } from "./trip-summary";
import { TripItinerary } from "./trip-itinerary";

const plan = tripPlanSchema.parse(fixture);
function Views({
  dirty = false,
  pending = false,
}: {
  dirty?: boolean;
  pending?: boolean;
}) {
  const [tab, setTab] = useState<ResultTab>("summary");
  const [selection, setSelection] = useState<EventSelection | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  return (
    <TripResults
      plan={plan}
      tab={tab}
      onTabChange={setTab}
      selection={selection}
      hoveredId={hoveredId}
      onHover={setHoveredId}
      onSelect={(id) => setSelection({ id, source: "itinerary" })}
      dirty={dirty}
      pending={pending}
    />
  );
}
describe("trip summary", () => {
  it("shows API totals and excludes daily-log padding from the trip timeline", () => {
    render(<TripSummary plan={plan} />);
    expect(
      screen.getByRole("img", { name: /Trip duty timeline/ }),
    ).toHaveAccessibleName(
      "Trip duty timeline: Off Duty 0m, Sleeper Berth 0m, Driving 3h, On Duty 2h.",
    );
    // Values come from the provider/planner, not route geometry or browser HOS rules.
    expect(screen.getByText("165")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "5h used; 65h remaining of 70 hours",
    );
    expect(screen.getByText("Delivery complete").parentElement).toHaveTextContent(
      "Oct 3, 1:00 PM · UTC-05:00",
    );
  });
  it("shows actual cycle use above 70 after allowed non-driving work", () => {
    const over: TripPlan = structuredClone(plan);
    over.logs[0]!.recap.cycle_used_min = 4320;
    over.summary.cycle_remaining_hours_at_end = 0;
    render(<TripSummary plan={over} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "72h used; 0m remaining of 70 hours",
    );
    expect(screen.getByText("72h")).toBeInTheDocument();
    expect(
      screen.getByText(/restart is required before further driving/),
    ).toBeInTheDocument();
  });
  it("uses the final recap after a restart rather than subtracting from the initial cycle", () => {
    const restarted = structuredClone(plan);
    restarted.logs.push({
      ...restarted.logs[0]!,
      recap: {
        ...restarted.logs[0]!.recap,
        cycle_used_min: 45,
        available_min: 4155,
        restart_taken: true,
      },
    });
    restarted.summary.cycle_remaining_hours_at_end = 69.25;
    render(<TripSummary plan={restarted} />);
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "45m used; 69h 15m remaining of 70 hours",
    );
  });
});
describe("results navigation", () => {
  it("supports arrow wrapping, Home/End, and a single active tab stop", async () => {
    render(<Views />);
    const user = userEvent.setup();
    const summary = screen.getByRole("tab", { name: "Summary" });
    const itinerary = screen.getByRole("tab", { name: "Itinerary" });
    const logs = screen.getByRole("tab", { name: "Log Sheets" });
    summary.focus();
    await user.keyboard("{ArrowRight}");
    expect(itinerary).toHaveFocus();
    expect(itinerary).toHaveAttribute("aria-selected", "true");
    expect(summary).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Itinerary");
    await user.keyboard("{ArrowRight}");
    expect(logs).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Log Sheets");
    await user.keyboard("{ArrowRight}");
    expect(summary).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(logs).toHaveFocus();
    await user.keyboard("{Home}");
    expect(summary).toHaveFocus();
    await user.keyboard("{End}");
    expect(logs).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });
  it.each([
    [{ dirty: true }, "Trip details changed. Plan again to update these results."],
    [{ pending: true }, "Updating your plan. These results show the previous trip."],
  ])("labels old results with %j", (props, message) => {
    render(<Views {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });
});
describe("itinerary map links", () => {
  it("synchronizes selection, pointer hover, and keyboard focus with original event IDs", async () => {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    const { rerender } = render(
      <TripItinerary
        plan={plan}
        selection={null}
        hoveredId={null}
        onSelect={onSelect}
        onHover={onHover}
      />,
    );
    const user = userEvent.setup();
    const row = screen.getByRole("button", { name: /Show Pickup event on map/ });
    await user.hover(row);
    expect(onHover).toHaveBeenLastCalledWith(plan.events[2]!.id);
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(plan.events[2]!.id);
    rerender(
      <TripItinerary
        plan={plan}
        selection={{ id: plan.events[2]!.id, source: "map" }}
        hoveredId={plan.events[2]!.id}
        onSelect={onSelect}
        onHover={onHover}
      />,
    );
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row).toHaveClass("is-hovered");
    fireEvent.blur(row);
    expect(onHover).toHaveBeenLastCalledWith(null);
    fireEvent.focus(row);
    expect(onHover).toHaveBeenLastCalledWith(plan.events[2]!.id);
  });
  it("labels overnight portions and maps the continued row to the full original event", async () => {
    const overnight = structuredClone(plan);
    const rest = {
      ...overnight.events[1]!,
      id: "rest",
      type: "rest" as const,
      status: "SLEEPER" as const,
      start: "2026-10-03T23:30:00-05:00",
      end: "2026-10-04T09:30:00-05:00",
      duration_min: 600,
    };
    overnight.events = [rest];
    const onSelect = vi.fn();
    render(
      <TripItinerary
        plan={overnight}
        selection={null}
        hoveredId={null}
        onSelect={onSelect}
        onHover={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Day 2.*Sun, Oct 4/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("30m")).toBeInTheDocument();
    expect(screen.getByText("9h 30m")).toBeInTheDocument();
    const continuation = screen.getByRole("button", { name: /Show full 10-hour rest/ });
    expect(
      within(continuation).getByText(/Continued from previous day/),
    ).toHaveTextContent("Map shows the full event from its original start.");
    await userEvent.setup().click(continuation);
    expect(onSelect).toHaveBeenCalledWith("rest");
  });
});

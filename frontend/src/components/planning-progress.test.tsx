import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanningProgress } from "./planning-progress";

afterEach(() => vi.useRealTimers());

describe("hosted service progress", () => {
  it("explains a possible cold start without claiming planning has begun", () => {
    vi.useFakeTimers();
    const view = render(<PlanningProgress pending phase="connecting" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Connecting to the planning service",
    );
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the server");
    expect(screen.getByRole("status")).toHaveTextContent("may be waking up");
    expect(screen.getByRole("status")).not.toHaveTextContent("applying HOS rules");
    view.rerender(<PlanningProgress pending={false} phase="connecting" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows planning after connection, with a fresh elapsed clock", () => {
    vi.useFakeTimers();
    const view = render(
      <PlanningProgress key="connection" pending phase="connecting" />,
    );
    act(() => vi.advanceTimersByTime(60000));
    view.rerender(<PlanningProgress key="plan" pending phase="planning" />);
    expect(screen.getByRole("status")).toHaveTextContent("Planning your trip…");
    expect(screen.getByRole("status")).not.toHaveTextContent("Still planning");
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByRole("status")).toHaveTextContent("Still planning");
    expect(screen.getByRole("status")).not.toHaveTextContent("waking up");
  });
});

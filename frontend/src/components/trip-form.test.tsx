import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TripForm } from "./trip-form";

function setup(pending = false) {
  const submit = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <TripForm pending={pending} onSubmit={submit} onEdit={() => undefined} />
    </QueryClientProvider>,
  );
  return { submit, user: userEvent.setup() };
}

describe("trip form", () => {
  it("loads a sample and submits it without geocoding or a hardcoded date", async () => {
    const { submit, user } = setup();
    await user.click(screen.getByRole("button", { name: "Use sample trip" }));
    await user.click(screen.getByRole("button", { name: "Plan trip" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0]).toMatchObject({
      current_location: { label: "Chicago, IL", lat: 41.8781 },
      cycle_used_hours: 34,
    });
    expect(submit.mock.calls[0]![0]).not.toHaveProperty("start_time");
  });
  it("validates empty locations before contacting the API", async () => {
    const { submit, user } = setup();
    await user.click(screen.getByRole("button", { name: "Plan trip" }));
    expect(
      await screen.findAllByText("Enter an address or choose a suggestion."),
    ).toHaveLength(3);
    expect(submit).not.toHaveBeenCalled();
  });
  it("swaps complete location objects, including their coordinates", async () => {
    const { submit, user } = setup();
    await user.click(screen.getByRole("button", { name: "Use sample trip" }));
    await user.click(screen.getByRole("button", { name: "Swap start and delivery" }));
    await user.click(screen.getByRole("button", { name: "Plan trip" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0]).toMatchObject({
      current_location: { label: "Los Angeles, CA", lng: -118.2437 },
      dropoff_location: { label: "Chicago, IL", lng: -87.6298 },
    });
  });
  it("disables editing and duplicate submissions while planning", () => {
    setup(true);
    expect(screen.getByRole("button", { name: "Use sample trip" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Current location" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Planning your trip…" })).toBeDisabled();
  });
  it("focuses a validation summary and lets its links focus the invalid fields", async () => {
    const { user, submit } = setup();
    await user.click(screen.getByRole("button", { name: "Plan trip" }));
    const summary = await screen.findByRole("alert", {
      name: "Check your trip details",
    });
    expect(summary).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: /^Pickup location: Enter an address/ }),
    );
    expect(screen.getByRole("combobox", { name: "Pickup location" })).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });
  it("reveals and focuses an invalid optional field that was collapsed", async () => {
    const { user, submit } = setup();
    await user.click(screen.getByRole("button", { name: "Use sample trip" }));
    const details = screen.getByRole("button", { name: /Trip details Optional/ });
    await user.click(details);
    await user.clear(screen.getByRole("textbox", { name: "Carrier name" }));
    await user.click(details);
    await user.click(screen.getByRole("button", { name: "Plan trip" }));
    await screen.findByRole("alert", { name: "Check your trip details" });
    expect(details).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: /^Carrier name:/ }));
    expect(screen.getByRole("textbox", { name: "Carrier name" })).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });
});

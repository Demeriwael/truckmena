import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import fixture from "./test/fixtures/trip.json";
import type { EventSelection } from "./lib/plan-view";

vi.mock("@/components/route-map", () => ({
  RouteMap: ({
    selection,
    onSelect,
    onHover,
  }: {
    selection: EventSelection | null;
    onSelect: (id: string) => void;
    onHover: (id: string | null) => void;
  }) => (
    <div>
      Map preview<span data-testid="map-selection">{selection?.id}</span>
      <button
        type="button"
        onClick={() => onSelect("event-0002")}
        onMouseEnter={() => onHover("event-0002")}
        onMouseLeave={() => onHover(null)}
      >
        Pickup map marker
      </button>
    </div>
  ),
}));
afterEach(() => vi.unstubAllGlobals());

describe("trip planning flow", () => {
  it("retries a failed request from the banner using current form values", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture)));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use sample trip" }));
    await user.click(screen.getByRole("button", { name: "Plan trip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "planning service is unavailable",
    );
    expect(screen.getByRole("alert")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByText("Your route is ready")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status", { name: "Your route is ready" })).toHaveFocus();
  });
  it("links map and itinerary selections and resets them when a new plan arrives", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify(fixture))),
        ),
    );
    const scroll = vi.fn();
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      render(
        <QueryClientProvider client={client}>
          <App />
        </QueryClientProvider>,
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Use sample trip" }));
      await user.click(screen.getByRole("button", { name: "Plan trip" }));
      await screen.findByText("Your route is ready");
      expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await user.click(screen.getByRole("button", { name: "Pickup map marker" }));
      expect(screen.getByRole("tab", { name: "Itinerary" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const pickup = screen.getByRole("button", { name: /Show Pickup event/ });
      expect(pickup).toHaveAttribute("aria-pressed", "true");
      fireEvent.mouseEnter(screen.getByRole("button", { name: "Pickup map marker" }));
      expect(pickup).toHaveClass("is-hovered");
      scroll.mockClear();
      pickup.focus();
      await user.keyboard("{Enter}");
      expect(pickup).toHaveFocus();
      expect(scroll).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: /Show Delivery event/ }));
      expect(screen.getByTestId("map-selection")).toHaveTextContent("event-0004");
      expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
      await user.click(screen.getByRole("tab", { name: "Log Sheets" }));
      expect(
        await screen.findByRole(
          "img",
          { name: /Driver's Daily Log.*Day 1 of 1/ },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      await user.clear(
        screen.getByRole("spinbutton", { name: "Cycle hours already used" }),
      );
      await user.type(
        screen.getByRole("spinbutton", { name: "Cycle hours already used" }),
        "10",
      );
      expect(
        screen.getByText("Trip details changed. Plan again to update these results."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download PDF/ })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Plan trip" }));
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
          "aria-selected",
          "true",
        ),
      );
      expect(screen.getByTestId("map-selection")).toBeEmptyDOMElement();
      await user.click(screen.getByRole("tab", { name: "Log Sheets" }));
      expect(await screen.findByRole("button", { name: /Download PDF/ })).toBeEnabled();
      await user.click(screen.getByRole("tab", { name: "Itinerary" }));
      expect(
        within(screen.getByRole("tabpanel")).getByRole("button", {
          name: /Show Pickup event/,
        }),
      ).toHaveAttribute("aria-pressed", "false");
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScroll;
    }
  }, 10000);
  it("keeps focus on a control chosen while the request is pending", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    let resolveResponse: (response: Response) => void = () => undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use sample trip" }));
    await user.click(screen.getByRole("button", { name: "Plan trip" }));
    expect(
      await screen.findByRole("button", { name: "Planning your trip…" }),
    ).toBeDisabled();
    const theme = screen.getByRole("button", { name: /^Switch to .* theme$/ });
    await user.click(theme);
    await act(async () => {
      resolveResponse(new Response(JSON.stringify(fixture)));
    });
    await screen.findByText("Your route is ready");
    expect(theme).toHaveFocus();
  });
});

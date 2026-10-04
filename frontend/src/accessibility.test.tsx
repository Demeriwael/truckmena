import axe from "axe-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { TripForm } from "./components/trip-form";
import { TripResults } from "./components/trip-results";
import { tripPlanSchema } from "./lib/contracts";
import fixture from "./test/fixtures/trip.json";

afterEach(() => vi.unstubAllGlobals());

async function checkAccessibility(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"],
    },
    // jsdom has no rendered colors or layout. Contrast and reflow are checked
    // separately in the actual browser; these checks cover HTML/ARIA semantics.
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
}

describe("accessibility semantics", () => {
  it("checks the open address list and its active option", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { label: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
              { label: "Chicago Heights, IL", lat: 41.5, lng: -87.6 },
            ]),
          ),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { container } = render(
      <QueryClientProvider client={client}>
        <main>
          <TripForm
            pending={false}
            onSubmit={() => undefined}
            onEdit={() => undefined}
          />
        </main>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("combobox", { name: "Current location" }),
      "Chicago",
    );
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}");
    await checkAccessibility(container);
  });
  it("checks the form before and after failed validation", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { container } = render(
      <QueryClientProvider client={client}>
        <main>
          <TripForm
            pending={false}
            onSubmit={() => undefined}
            onEdit={() => undefined}
          />
        </main>
      </QueryClientProvider>,
    );
    await checkAccessibility(container);
    await userEvent.setup().click(screen.getByRole("button", { name: "Plan trip" }));
    await screen.findByRole("alert", { name: "Check your trip details" });
    await checkAccessibility(container);
  });
  it.each(["summary", "itinerary", "logs"] as const)(
    "checks the %s results view",
    async (tab) => {
      const { container } = render(
        <main>
          <TripResults
            plan={tripPlanSchema.parse(fixture)}
            tab={tab}
            onTabChange={() => undefined}
            selection={null}
            hoveredId={null}
            onSelect={() => undefined}
            onHover={() => undefined}
            dirty={false}
            pending={false}
          />
        </main>,
      );
      if (tab === "logs")
        await screen.findByRole(
          "heading",
          { name: "Every day, accounted for." },
          { timeout: 5000 },
        );
      await checkAccessibility(container);
    },
  );
  it("provides a named error page and focusable skip-link destination", async () => {
    window.history.replaceState(null, "", "/missing-page");
    try {
      const client = new QueryClient();
      const { container } = render(
        <QueryClientProvider client={client}>
          <App />
        </QueryClientProvider>,
      );
      expect(document.title).toBe("Page not found · Wayline");
      expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
      expect(
        screen.getByRole("link", { name: "Back to trip planner" }),
      ).toHaveAttribute("href", "/");
      await checkAccessibility(container);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});

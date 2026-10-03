import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import fixture from "./test/fixtures/trip.json";

vi.mock("@/components/route-map", () => ({ RouteMap: () => <div>Map preview</div> }));
afterEach(() => vi.unstubAllGlobals());

describe("trip planning flow", () => {
  it("retries a failed request from the banner using current form values", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
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
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByText("Your route is ready")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

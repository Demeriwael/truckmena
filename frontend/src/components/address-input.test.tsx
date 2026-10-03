import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Location } from "@/lib/contracts";
import { AddressInput } from "./address-input";

afterEach(() => vi.unstubAllGlobals());
const suggestions = [
  { label: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
  { label: "Chicago Heights, IL", lat: 41.5, lng: -87.6 },
];

function setup(
  initial: Location = { label: "" },
  payload: unknown = suggestions,
  status = 200,
) {
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(payload), { status })),
    );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <QueryClientProvider client={client}>
        <AddressInput
          label="Current location"
          placeholder="Start"
          kind="current"
          value={value}
          onChange={setValue}
          onBlur={() => undefined}
          inputRef={null}
        />
        <output aria-label="Selected location">{JSON.stringify(value)}</output>
      </QueryClientProvider>
    );
  }
  render(<Harness />);
  return { fetchMock, user: userEvent.setup(), input: screen.getByRole("combobox") };
}

describe("address autocomplete", () => {
  it("avoids requests for fewer than three characters", async () => {
    const { user, input, fetchMock } = setup();
    await user.type(input, "Ch");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
  it("debounces rapid edits and supports keyboard selection", async () => {
    const { user, input, fetchMock } = setup();
    await user.type(input, "Chicago");
    await screen.findByRole("listbox");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/geocode/autocomplete?q=Chicago");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(input).toHaveValue("Chicago Heights, IL");
    expect(screen.getByLabelText("Selected location")).toHaveTextContent('"lat":41.5');
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
  it("clears stale coordinates whenever a selected address is edited", () => {
    const { input } = setup(suggestions[0]);
    fireEvent.change(input, { target: { value: "Chicago changed" } });
    expect(screen.getByLabelText("Selected location")).toHaveTextContent(
      '{"label":"Chicago changed"}',
    );
  });
  it("dismisses suggestions with Escape and clears selected locations", async () => {
    const { user, input } = setup();
    await user.type(input, "Chicago");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear current location" }));
    expect(input).toHaveValue("");
  });
  it("lets a complete address remain usable when the provider fails", async () => {
    const { user, input } = setup(undefined, {}, 502);
    await user.type(input, "123 Full Address");
    expect(await screen.findByText(/Suggestions unavailable/)).toBeInTheDocument();
    expect(input).toHaveValue("123 Full Address");
  });
});

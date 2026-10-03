import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, autocomplete, planTrip } from "./api";
import { sample, toTripRequest } from "./trip-form";
import fixture from "@/test/fixtures/trip.json";

afterEach(() => vi.unstubAllGlobals());

describe("safe API requests", () => {
  it("posts only validated trip inputs and checks the returned contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await planTrip(toTripRequest(sample), new AbortController().signal);
    expect(result.route.total_miles).toBe(165);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trips/plan",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty(
      "start_time",
    );
  });
  it("encodes searches and passes cancellation through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    await autocomplete("Dallas & nearby", new AbortController().signal);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/api/geocode/autocomplete?q=Dallas%20%26%20nearby",
    );
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
  it("keeps HTML error pages out of the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>private upstream details</html>", { status: 502 }),
        ),
    );
    await expect(
      planTrip(toTripRequest(sample), new AbortController().signal),
    ).rejects.toThrow("The planning service is unavailable.");
  });
  it("provides a useful rate-limit message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
    );
    await expect(autocomplete("Chicago", new AbortController().signal)).rejects.toThrow(
      "Please wait a minute",
    );
  });
  it("preserves nested validation fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ current_location: { label: ["Address is required."] } }),
            { status: 400 },
          ),
        ),
    );
    try {
      await planTrip(toTripRequest(sample), new AbortController().signal);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fields).toEqual({
        "current_location.label": "Address is required.",
      });
    }
  });
  it("rejects successful but malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(
      planTrip(toTripRequest(sample), new AbortController().signal),
    ).rejects.toThrow("incomplete response");
  });
  it("aborts an active search when its query is superseded", async () => {
    const controller = new AbortController();
    const aborted = new DOMException("Aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(aborted));
          }),
      ),
    );
    const result = expect(autocomplete("Chicago", controller.signal)).rejects.toBe(
      aborted,
    );
    controller.abort();
    await result;
  });
  it("times out a hung request and aborts fetch", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    const result = expect(
      autocomplete("Chicago", new AbortController().signal),
    ).rejects.toThrow("longer than expected");
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    vi.useRealTimers();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, autocomplete, planTrip } from "./api";
import { sample, toTripRequest } from "./trip-form";
import fixture from "@/test/fixtures/trip.json";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

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

describe("hosted service readiness", () => {
  const healthy = () =>
    new Response(JSON.stringify({ status: "ok", service: "eld-trip-planner" }));

  it("checks the configured origin, then submits one plan without cookies", async () => {
    vi.stubEnv("VITE_API_BASE_URL", " https://api.example.invalid/ ");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture)));
    vi.stubGlobal("fetch", fetchMock);
    const phases = vi.fn();
    await planTrip(toTripRequest(sample), new AbortController().signal, phases);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.invalid/api/health",
      "https://api.example.invalid/api/trips/plan",
    ]);
    expect(fetchMock.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
      }),
    );
    expect(phases.mock.calls).toEqual([["connecting"], ["planning"]]);
  });

  it("retries unavailable or loading health responses without replaying the plan", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.invalid");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("host booting", { status: 503 }))
      .mockResolvedValueOnce(new Response("<html>loading</html>"))
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture)));
    vi.stubGlobal("fetch", fetchMock);
    const plan = planTrip(toTripRequest(sample), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(plan).resolves.toHaveProperty("summary.log_days", 1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init.method === "POST"),
    ).toHaveLength(1);
  });

  it("bounds cold-start waiting and never sends a plan to an unavailable service", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.invalid");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = expect(
      planTrip(toTripRequest(sample), new AbortController().signal),
    ).rejects.toThrow("taking too long to wake up");
    await vi.advanceTimersByTimeAsync(90000);
    await result;
    expect(fetchMock.mock.calls.every(([, init]) => init.method !== "POST")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the retry delay immediately when the caller aborts", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.invalid");
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = expect(
      planTrip(toTripRequest(sample), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry configuration errors or failed plan submissions", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.invalid");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      planTrip(toTripRequest(sample), new AbortController().signal),
    ).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(new Response("{}", { status: 502 }));
    await expect(
      planTrip(toTripRequest(sample), new AbortController().signal),
    ).rejects.toThrow("planning service is unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

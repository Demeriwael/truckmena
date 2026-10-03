import type { z } from "zod";
import {
  suggestionsSchema,
  tripPlanSchema,
  tripRequestSchema,
  type TripRequest,
} from "./contracts";

const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Extract only user-facing validation fields. Never surface an HTML error page.
function validationFields(value: unknown, prefix = ""): Record<string, string> {
  if (!record(value)) return {};
  const fields: Record<string, string> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (["detail", "code"].includes(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(nested) && typeof nested[0] === "string")
      fields[path] = nested[0];
    else if (record(nested)) Object.assign(fields, validationFields(nested, path));
  }
  return fields;
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = window.setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(`${configuredBase}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "omit",
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const fields = response.status === 400 ? validationFields(data) : {};
      const message =
        response.status === 429
          ? "Too many requests. Please wait a minute and try again."
          : response.status === 400 && record(data) && typeof data.detail === "string"
            ? data.detail
            : response.status === 400
              ? "Check the highlighted trip details and try again."
              : response.status >= 500
                ? "The planning service is unavailable. Please try again shortly."
                : "Unable to complete this request. Please try again.";
      throw new ApiError(message, response.status, fields);
    }
    const result = schema.safeParse(data);
    if (!result.success)
      throw new ApiError(
        "The planning service returned an incomplete response. Please try again.",
        502,
      );
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (init.signal?.aborted) throw error;
    throw new ApiError(
      controller.signal.aborted
        ? "Planning took longer than expected. Please try again."
        : "Unable to connect to the planning service. Check your connection and try again.",
      0,
    );
  } finally {
    window.clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

export function autocomplete(query: string, signal: AbortSignal) {
  return request(
    `/api/geocode/autocomplete?q=${encodeURIComponent(query)}`,
    suggestionsSchema,
    { signal },
    15000,
  );
}

export function planTrip(payload: TripRequest, signal: AbortSignal) {
  return request(
    "/api/trips/plan",
    tripPlanSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tripRequestSchema.parse(payload)),
      signal,
    },
    65000,
  );
}

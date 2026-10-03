import { z } from "zod";
import { locationSchema, tripRequestSchema, type TripRequest } from "./contracts";

export function departureWithOffset(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const pad = (part: number) => String(part).padStart(2, "0");
  const local = `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() < 1 || local !== value) return undefined;
  return `${value}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export const formSchema = z
  .object({
    current_location: locationSchema,
    pickup_location: locationSchema,
    dropoff_location: locationSchema,
    cycle_used_hours: z
      .number({ error: "Enter cycle hours from 0 to 70." })
      .finite()
      .min(0, "Use 0 to 70 hours.")
      .max(70, "Use 0 to 70 hours."),
    departure: z
      .string()
      .refine(
        (value) =>
          !value ||
          (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
            Boolean(departureWithOffset(value))),
        "Choose a valid departure date and time.",
      ),
    driver_name: tripRequestSchema.shape.driver_name,
    vehicle: tripRequestSchema.shape.vehicle,
    shipping_doc: tripRequestSchema.shape.shipping_doc,
    carrier: tripRequestSchema.shape.carrier,
  })
  .superRefine((value, context) => {
    const pickup = value.pickup_location;
    const dropoff = value.dropoff_location;
    const same =
      pickup.lat !== undefined && dropoff.lat !== undefined
        ? pickup.lat === dropoff.lat && pickup.lng === dropoff.lng
        : pickup.label.toLowerCase().trim() === dropoff.label.toLowerCase().trim();
    if (same) {
      context.addIssue({
        code: "custom",
        path: ["dropoff_location", "label"],
        message: "Choose a delivery location different from pickup.",
      });
    }
  });
export type TripFormValues = z.infer<typeof formSchema>;
export const defaults: TripFormValues = {
  current_location: { label: "" },
  pickup_location: { label: "" },
  dropoff_location: { label: "" },
  cycle_used_hours: 34,
  departure: "",
  driver_name: "Demo Driver",
  vehicle: "Truck 101 / Trailer 201",
  shipping_doc: "DEMO-001 / General freight",
  carrier: {
    name: "Demo Freight LLC",
    address: "Chicago, IL",
    home_terminal_address: "Chicago, IL",
  },
};
export const sample: TripFormValues = {
  ...defaults,
  current_location: { label: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
  pickup_location: { label: "Dallas, TX", lat: 32.7767, lng: -96.797 },
  dropoff_location: { label: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
};

export function toTripRequest(values: TripFormValues): TripRequest {
  const { departure, ...rest } = values;
  const start = departureWithOffset(departure);
  return tripRequestSchema.parse({ ...rest, ...(start ? { start_time: start } : {}) });
}

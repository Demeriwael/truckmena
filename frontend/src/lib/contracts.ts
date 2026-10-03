import { z } from "zod";

const number = z.number().finite();
const minutes = number.int().nonnegative();
export const locationSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "Enter an address or choose a suggestion.")
      .max(300),
    lat: number.min(-90).max(90).optional(),
    lng: number.min(-180).max(180).optional(),
  })
  .refine(
    (value) => (value.lat === undefined) === (value.lng === undefined),
    "Supply both coordinates.",
  );

export const suggestionSchema = z.object({
  label: z.string(),
  lat: number.min(-90).max(90),
  lng: number.min(-180).max(180),
});
export const suggestionsSchema = z.array(suggestionSchema);
export const dutyStatusSchema = z.enum(["OFF", "SLEEPER", "DRIVING", "ON_DUTY"]);
export const eventTypeSchema = z.enum([
  "start",
  "driving",
  "pickup",
  "dropoff",
  "fuel",
  "break",
  "rest",
  "restart",
]);
const totalsSchema = z.object({
  off: number,
  sleeper: number,
  driving: number,
  on_duty: number,
});
const dutyMinutesSchema = z.object({
  off: minutes,
  sleeper: minutes,
  driving: minutes,
  on_duty: minutes,
});
const segmentSchema = z.object({
  status: dutyStatusSchema,
  start_min_of_day: minutes.max(1440),
  end_min_of_day: minutes.max(1440),
  place: z.string(),
  start_mile_marker: number,
  end_mile_marker: number,
  event_id: z.string().nullable(),
  is_padding: z.boolean(),
});
const eventSchema = z.object({
  id: z.string(),
  type: eventTypeSchema,
  status: dutyStatusSchema,
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  duration_min: minutes,
  lat: number.min(-90).max(90),
  lng: number.min(-180).max(180),
  place: z.string(),
  mile_marker: number,
  end_mile_marker: number,
  note: z.string(),
});
export const tripPlanSchema = z.object({
  route: z.object({
    geometry: z
      .array(z.tuple([number.min(-90).max(90), number.min(-180).max(180)]))
      .min(2),
    total_miles: number.nonnegative(),
    legs: z
      .array(
        z.object({ from: z.string(), to: z.string(), miles: number.nonnegative() }),
      )
      .length(2),
    provider: z.enum(["ors", "osrm"]),
    profile: z.string(),
    provider_duration_hours: number,
    attribution: z.array(z.string()),
  }),
  summary: z.object({
    total_miles: number,
    total_driving_hours: number,
    total_duration_hours: number,
    log_days: minutes,
    fuel_stops: minutes,
    rests: minutes,
    breaks: minutes,
    restarts: minutes,
    cycle_remaining_hours_at_end: number,
  }),
  events: z.array(eventSchema).min(1),
  logs: z
    .array(
      z.object({
        date: z.string(),
        iso_date: z.string(),
        from: z.string(),
        to: z.string(),
        total_miles: number,
        total_mileage_today: number,
        cumulative_trip_miles: number,
        totals: totalsSchema,
        totals_min: dutyMinutesSchema,
        segments: z.array(segmentSchema),
        remarks: z.array(
          z.object({ minute_of_day: minutes, place: z.string(), note: z.string() }),
        ),
        recap: z.object({
          a: number,
          b: number,
          c: number,
          on_duty_today: number,
          cycle_used_min: minutes,
          available_min: minutes,
          last_five_days_on_duty_min: minutes,
          restart_taken: z.boolean(),
          restart_in_progress: z.boolean(),
          notes: z.array(z.string()),
        }),
        driver_name: z.string(),
        carrier_name: z.string(),
        main_office_address: z.string(),
        home_terminal_address: z.string(),
        vehicle: z.string(),
        shipping_doc: z.string(),
        timezone_offset: z.string(),
        period_start: z.string(),
      }),
    )
    .min(1),
  warnings: z.array(z.string()),
  log_generation_available: z.boolean(),
});

export const tripRequestSchema = z.object({
  current_location: locationSchema,
  pickup_location: locationSchema,
  dropoff_location: locationSchema,
  cycle_used_hours: number.min(0, "Use 0 to 70 hours.").max(70, "Use 0 to 70 hours."),
  start_time: z.iso.datetime({ offset: true }).optional(),
  carrier: z.object({
    name: z.string().trim().min(1, "Enter a carrier name.").max(160),
    address: z.string().trim().min(1, "Enter the main office address.").max(300),
    home_terminal_address: z
      .string()
      .trim()
      .min(1, "Enter the home terminal address.")
      .max(300),
  }),
  vehicle: z.string().trim().min(1, "Enter truck or trailer numbers.").max(160),
  shipping_doc: z
    .string()
    .trim()
    .min(1, "Enter a shipping document or commodity.")
    .max(200),
  driver_name: z.string().trim().min(1, "Enter a driver name.").max(160),
});
export type Location = z.infer<typeof locationSchema>;
export type Suggestion = z.infer<typeof suggestionSchema>;
export type TripRequest = z.infer<typeof tripRequestSchema>;
export type TripPlan = z.infer<typeof tripPlanSchema>;
export type TripEvent = z.infer<typeof eventSchema>;
export type DailyLog = TripPlan["logs"][number];
export type DutyStatus = z.infer<typeof dutyStatusSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;

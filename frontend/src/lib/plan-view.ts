import type { DutyStatus, TripEvent } from "./contracts";

export type EventSelection = { id: string; source: "map" | "itinerary" };
export type ResultTab = "summary" | "itinerary" | "logs";
export type ItineraryEntry = {
  key: string;
  event: TripEvent;
  start: string;
  end: string;
  durationMin: number;
  continued: boolean;
  continues: boolean;
};
export type ItineraryDay = { date: string; entries: ItineraryEntry[] };

// Treat the API's wall clock as UTC only for calendar arithmetic. Never convert
// it into the browser's timezone or apply a DST change to the frozen trip offset.
export function itineraryDays(events: TripEvent[]): ItineraryDay[] {
  const days = new Map<string, ItineraryDay>();
  for (const event of events) {
    const first = Date.parse(`${event.start.slice(0, 19)}Z`);
    const finish = Date.parse(`${event.end.slice(0, 19)}Z`);
    const offset = event.start.endsWith("Z") ? "Z" : event.start.slice(-6);
    let cursor = first;
    do {
      const date = new Date(cursor).toISOString().slice(0, 10);
      const midnight = Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000;
      const end = Math.min(finish, midnight);
      const day = days.get(date) ?? { date, entries: [] };
      day.entries.push({
        key: `${event.id}:${date}`,
        event,
        start: new Date(cursor).toISOString().slice(0, 19) + offset,
        end: new Date(end).toISOString().slice(0, 19) + offset,
        durationMin: (end - cursor) / 60000,
        continued: cursor !== first,
        continues: end < finish,
      });
      days.set(date, day);
      cursor = end;
    } while (cursor < finish);
  }
  return [...days.values()];
}

export const dutyOrder: DutyStatus[] = ["OFF", "SLEEPER", "DRIVING", "ON_DUTY"];

// Only scheduled events contribute; the log sheets' OFF padding is display-only.
export function dutyTotals(events: TripEvent[]): Record<DutyStatus, number> {
  const totals = { OFF: 0, SLEEPER: 0, DRIVING: 0, ON_DUTY: 0 };
  for (const event of events) totals[event.status] += event.duration_min;
  return totals;
}

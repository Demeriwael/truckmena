import {
  BedDouble,
  CalendarDays,
  Clock3,
  Coffee,
  Flag,
  Fuel,
  Gauge,
  RotateCcw,
  Route,
  Truck,
} from "lucide-react";
import type { TripPlan } from "@/lib/contracts";
import { durationLabel, eventTime, milesLabel } from "@/lib/format";
import { dutyOrder, dutyTotals } from "@/lib/plan-view";
import { statusLabels } from "@/lib/event-presentation";

export function TripSummary({ plan }: { plan: TripPlan }) {
  const { summary, events } = plan;
  const first = events[0]!;
  const last = events.at(-1)!;
  const totals = dutyTotals(events);
  const totalMinutes = Math.round(summary.total_duration_hours * 60);
  const used = plan.logs.at(-1)!.recap.cycle_used_min;
  const remaining = Math.round(summary.cycle_remaining_hours_at_end * 60);
  const percent = Math.min(100, (used / 4200) * 100);
  const metrics = [
    {
      label: "Total miles",
      value: milesLabel(summary.total_miles),
      unit: "mi",
      icon: Route,
    },
    {
      label: "Driving time",
      value: durationLabel(Math.round(summary.total_driving_hours * 60)),
      icon: Truck,
    },
    { label: "Trip duration", value: durationLabel(totalMinutes), icon: Clock3 },
    {
      label: "Daily logs",
      value: summary.log_days,
      unit: summary.log_days === 1 ? "day" : "days",
      icon: CalendarDays,
    },
    { label: "Fuel stops", value: summary.fuel_stops, icon: Fuel },
    { label: "10-hour rests", value: summary.rests, icon: BedDouble },
    { label: "30-minute breaks", value: summary.breaks, icon: Coffee },
    { label: "34-hour restarts", value: summary.restarts, icon: RotateCcw },
  ];
  return (
    <div className="trip-summary">
      <dl className="summary-stats" aria-label="Trip statistics">
        {metrics.map(({ label, value, unit, icon: Icon }) => (
          <div className="stat-card" key={label}>
            <dt>
              <Icon size={16} aria-hidden="true" />
              {label}
            </dt>
            <dd>
              {value}
              {unit && <span>{unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div className="summary-detail-grid">
        <section className="duty-summary" aria-labelledby="duty-summary-title">
          <span className="eyebrow">EVERY HOUR ACCOUNTED FOR</span>
          <h3 id="duty-summary-title">Your time on the road</h3>
          <div
            className="duty-bar"
            role="img"
            aria-label={`Trip duty timeline: ${dutyOrder.map((status) => `${statusLabels[status]} ${durationLabel(totals[status])}`).join(", ")}.`}
          >
            {events
              .filter((event) => event.duration_min > 0)
              .map((event) => (
                <span
                  key={event.id}
                  className={`duty-fill duty-${event.status}`}
                  style={{ flexGrow: event.duration_min }}
                  title={`${statusLabels[event.status]} · ${durationLabel(event.duration_min)}`}
                />
              ))}
          </div>
          <dl className="duty-totals">
            {dutyOrder.map((status) => (
              <div key={status}>
                <dt>
                  <i className={`duty-fill duty-${status}`} />
                  {statusLabels[status]}
                </dt>
                <dd>{durationLabel(totals[status])}</dd>
              </div>
            ))}
          </dl>
          <p className="duty-caption">
            Departure to delivery completion. Daily log padding is excluded.
          </p>
        </section>
        <section className="cycle-summary" aria-labelledby="cycle-title">
          <div
            className="cycle-ring"
            role="meter"
            aria-labelledby="cycle-title"
            aria-valuemin={0}
            aria-valuemax={70}
            aria-valuenow={Math.min(70, used / 60)}
            aria-valuetext={`${durationLabel(used)} used; ${durationLabel(remaining)} remaining of 70 hours`}
          >
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle className="cycle-track" cx="50" cy="50" r="42" />
              <circle
                className={`cycle-progress ${remaining === 0 ? "cycle-full" : ""}`}
                cx="50"
                cy="50"
                r="42"
                pathLength="100"
                strokeDasharray={`${percent} 100`}
                transform="rotate(-90 50 50)"
              />
            </svg>
            <span>
              <strong>{durationLabel(remaining)}</strong>
              <small>remaining</small>
            </span>
          </div>
          <div>
            <h3 id="cycle-title">
              <Gauge size={15} aria-hidden="true" />
              Cycle at trip end
            </h3>
            <p>
              <strong>{durationLabel(used)}</strong> used of 70h
            </p>
            <small>
              {remaining === 0
                ? "A restart is required before further driving."
                : "Availability after all scheduled work and restarts."}
            </small>
          </div>
        </section>
      </div>
      <div className="trip-endpoints">
        <div>
          <Clock3 size={16} aria-hidden="true" />
          <span>
            Departure<strong>{eventTime(first.start)}</strong>
          </span>
        </div>
        <div>
          <Flag size={16} aria-hidden="true" />
          <span>
            Delivery complete<strong>{eventTime(last.end)}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

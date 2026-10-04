import { useEffect, useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import type { TripPlan } from "@/lib/contracts";
import {
  calendarDay,
  clockTime,
  durationLabel,
  milesLabel,
  tripOffset,
} from "@/lib/format";
import { eventIcons, eventLabels, statusLabels } from "@/lib/event-presentation";
import { itineraryDays, type EventSelection } from "@/lib/plan-view";

export function TripItinerary({
  plan,
  selection,
  hoveredId,
  onSelect,
  onHover,
}: {
  plan: TripPlan;
  selection: EventSelection | null;
  hoveredId: string | null;
  onSelect: (id: string, revealMap: boolean) => void;
  onHover: (id: string | null) => void;
}) {
  const days = useMemo(() => itineraryDays(plan.events), [plan.events]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selection?.source !== "map") return;
    const selected = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-event-id]") ?? []),
    ].find((row) => row.dataset.eventId === selection.id);
    if (selected && list.current) {
      const container = list.current;
      // Scroll only the itinerary viewport, keeping the user's map in place.
      container.scrollTop +=
        selected.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        72;
    }
  }, [selection]);
  return (
    <div className="trip-itinerary">
      <div className="itinerary-intro">
        <p>Every stop, in order. Select an event to see it on the map.</p>
        <span>{tripOffset(plan.events[0]!.start)} · Fixed trip time</span>
      </div>
      <div className="itinerary-scroll" ref={list}>
        {days.map((day, index) => (
          <section
            className="itinerary-day"
            aria-labelledby={`itinerary-day-${day.date}`}
            key={day.date}
          >
            <h3 id={`itinerary-day-${day.date}`}>
              <span>Day {index + 1}</span>
              {" · "}
              {calendarDay(day.date)}
              <small>{day.date.slice(0, 4)}</small>
            </h3>
            <ol>
              {day.entries.map(
                ({ key, event, start, end, durationMin, continued, continues }) => {
                  const Icon = eventIcons[event.type];
                  const active = selection?.id === event.id;
                  return (
                    <li key={key}>
                      <button
                        className={`itinerary-event ${active ? "is-selected" : ""} ${hoveredId === event.id ? "is-hovered" : ""}`}
                        type="button"
                        data-event-id={event.id}
                        aria-pressed={active}
                        aria-label={`Show ${continued ? "full " : ""}${eventLabels[event.type]} event on map: ${event.place}, ${calendarDay(day.date)} ${clockTime(start)}`}
                        onClick={(input) => onSelect(event.id, input.detail !== 0)}
                        onMouseEnter={() => onHover(event.id)}
                        onMouseLeave={() => onHover(null)}
                        onFocus={() => onHover(event.id)}
                        onBlur={() => onHover(null)}
                      >
                        <span className={`itinerary-icon duty-${event.status}`}>
                          <Icon size={17} aria-hidden="true" />
                        </span>
                        <span className="itinerary-event-content">
                          <span className="itinerary-event-heading">
                            <strong>{eventLabels[event.type]}</strong>
                            <span className="duration-chip">
                              {event.type === "start"
                                ? "Departure"
                                : durationLabel(durationMin)}
                            </span>
                          </span>
                          <span className="itinerary-place">{event.place}</span>
                          <span className="itinerary-time">
                            <time dateTime={start}>{clockTime(start)}</time>
                            {durationMin > 0 && (
                              <>
                                {" "}
                                –{" "}
                                <time dateTime={end}>
                                  {end.slice(0, 10) !== day.date
                                    ? "Midnight"
                                    : clockTime(end)}
                                </time>
                              </>
                            )}
                            <span className={`status-chip status-${event.status}`}>
                              {statusLabels[event.status]}
                            </span>
                          </span>
                          {event.note && (
                            <span className="itinerary-note">{event.note}</span>
                          )}
                          {(continued || continues) && (
                            <span className="itinerary-continuation">
                              {continued ? "Continued from previous day. " : ""}
                              {continues ? "Continues into next day. " : ""}Map shows
                              the full event from its original start.
                            </span>
                          )}
                          <span className="itinerary-mile">
                            {milesLabel(event.mile_marker)}
                            {event.end_mile_marker !== event.mile_marker &&
                              ` – ${milesLabel(event.end_mile_marker)}`}{" "}
                            mi on route{continued && " · Full event"}
                          </span>
                        </span>
                        <ArrowUpRight
                          className="itinerary-map-arrow"
                          size={15}
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                },
              )}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

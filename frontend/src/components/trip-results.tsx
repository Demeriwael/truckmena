import { lazy, Suspense, useRef, type KeyboardEvent } from "react";
import { AlertTriangle, FileText, ListOrdered, PieChart } from "lucide-react";
import { LazyMotion, domAnimation, m } from "framer-motion";
import type { TripPlan } from "@/lib/contracts";
import type { EventSelection, ResultTab } from "@/lib/plan-view";
import { TripSummary } from "./trip-summary";
import { TripItinerary } from "./trip-itinerary";

const tabs = ["summary", "itinerary", "logs"] as const;
const TripLogSheets = lazy(() =>
  import("./trip-log-sheets").then((module) => ({ default: module.TripLogSheets })),
);
const tabNames = { summary: "Summary", itinerary: "Itinerary", logs: "Log Sheets" };

export function ResultsSkeleton() {
  return (
    <section
      className="trip-results results-skeleton"
      role="status"
      aria-label="Preparing trip details"
    >
      <p>Preparing trip details…</p>
      <div className="summary-stats" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="stat-skeleton">
            <span />
            <i />
          </div>
        ))}
      </div>
      <div className="duty-skeleton" aria-hidden="true" />
    </section>
  );
}

export function TripResults({
  plan,
  tab,
  onTabChange,
  selection,
  hoveredId,
  onSelect,
  onHover,
  dirty,
  pending,
}: {
  plan: TripPlan;
  tab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
  selection: EventSelection | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  dirty: boolean;
  pending: boolean;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    onTabChange(tabs[next]!);
    buttons.current[next]?.focus();
  }
  return (
    <LazyMotion features={domAnimation} strict>
      <m.section
        className="trip-results"
        aria-label="Trip results"
        aria-busy={pending}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="results-tabs" role="tablist" aria-label="Trip result views">
          {tabs.map((name, index) => (
            <button
              type="button"
              role="tab"
              key={name}
              id={`tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`panel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              onClick={() => onTabChange(name)}
              onKeyDown={(event) => navigate(event, index)}
            >
              {name === "summary" ? (
                <PieChart size={16} aria-hidden="true" />
              ) : name === "itinerary" ? (
                <ListOrdered size={16} aria-hidden="true" />
              ) : (
                <FileText size={16} aria-hidden="true" />
              )}
              {tabNames[name]}
            </button>
          ))}
          <span className="results-day-count">
            {plan.summary.log_days} {plan.summary.log_days === 1 ? "day" : "days"}{" "}
            planned
          </span>
        </div>
        {(pending || dirty) && (
          <p className="results-stale" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            {pending
              ? "Updating your plan. These results show the previous trip."
              : "Trip details changed. Plan again to update these results."}
          </p>
        )}
        <div
          role="tabpanel"
          id="panel-summary"
          aria-labelledby="tab-summary"
          tabIndex={0}
          hidden={tab !== "summary"}
        >
          <TripSummary plan={plan} />
        </div>
        <div
          role="tabpanel"
          id="panel-itinerary"
          aria-labelledby="tab-itinerary"
          tabIndex={0}
          hidden={tab !== "itinerary"}
        >
          <TripItinerary
            plan={plan}
            selection={selection}
            hoveredId={hoveredId}
            onSelect={onSelect}
            onHover={onHover}
          />
        </div>
        <div
          role="tabpanel"
          id="panel-logs"
          aria-labelledby="tab-logs"
          tabIndex={0}
          hidden={tab !== "logs"}
        >
          {tab === "logs" && (
            <Suspense
              fallback={
                <p className="log-loading" role="status">
                  Preparing your log sheets…
                </p>
              }
            >
              <TripLogSheets plan={plan} disabled={dirty || pending} />
            </Suspense>
          )}
        </div>
      </m.section>
    </LazyMotion>
  );
}

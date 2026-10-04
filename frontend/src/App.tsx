import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Map,
  Moon,
  Route,
  Sun,
} from "lucide-react";
import { MotionConfig } from "framer-motion";
import { ApiError, planTrip, type PlanningPhase } from "@/lib/api";
import type { TripPlan, TripRequest } from "@/lib/contracts";
import { useTheme } from "@/hooks/use-theme";
import { TripForm } from "@/components/trip-form";
import { PlanningProgress } from "@/components/planning-progress";
import { Button } from "@/components/ui/button";
import { ResultsSkeleton, TripResults } from "@/components/trip-results";
import type { EventSelection, ResultTab } from "@/lib/plan-view";

const RouteMap = lazy(() =>
  import("@/components/route-map").then((module) => ({ default: module.RouteMap })),
);

export default function App() {
  const { dark, toggle } = useTheme();
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [planningPhase, setPlanningPhase] = useState<PlanningPhase>("planning");
  const [tab, setTab] = useState<ResultTab>("summary");
  const [selection, setSelection] = useState<EventSelection | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const mapView = useRef<HTMLDivElement>(null);
  const selectFromMap = useCallback((id: string) => {
    setSelection({ id, source: "map" });
    setTab("itinerary");
  }, []);
  const controller = useRef<AbortController | null>(null);
  const results = useRef<HTMLDivElement | null>(null);
  const readyNotice = useRef<HTMLDivElement>(null);
  const errorNotice = useRef<HTMLDivElement>(null);
  const focusAfterPlanning = useRef(false);
  const showMobileResults = () => {
    if (window.matchMedia("(max-width: 767px)").matches)
      results.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
  };
  useEffect(() => () => controller.current?.abort(), []);
  const mutation = useMutation({
    mutationFn: (payload: TripRequest) => {
      controller.current?.abort();
      controller.current = new AbortController();
      return planTrip(payload, controller.current.signal, setPlanningPhase);
    },
    retry: false,
    onSuccess: (result) => {
      setPlan(result);
      setDirty(false);
      setTab("summary");
      setSelection(null);
      setHoveredId(null);
      showMobileResults();
    },
    onError: showMobileResults,
  });
  useEffect(() => {
    if (!mutation.isPending) return;
    // If someone navigates elsewhere while waiting, keep their chosen focus.
    const moved = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target !== document.body &&
        !document.getElementById("trip-form")?.contains(event.target)
      )
        focusAfterPlanning.current = false;
    };
    document.addEventListener("focusin", moved);
    return () => document.removeEventListener("focusin", moved);
  }, [mutation.isPending]);
  useEffect(() => {
    if (mutation.isPending || !focusAfterPlanning.current) return;
    const notice = mutation.isError
      ? errorNotice.current
      : mutation.isSuccess
        ? readyNotice.current
        : null;
    if (notice) {
      notice.focus({ preventScroll: true });
      focusAfterPlanning.current = false;
    }
  }, [mutation.isPending, mutation.isError, mutation.isSuccess, plan]);
  const edit = () => {
    if (plan) setDirty(true);
    if (mutation.isError) mutation.reset();
  };
  const isHome = window.location.pathname === "/";
  useEffect(() => {
    document.title = isHome ? "Wayline · ELD Trip Planner" : "Page not found · Wayline";
  }, [isHome]);

  return (
    <MotionConfig reducedMotion="user">
      <a className="skip-link" href="#main-content">
        Skip to trip planner
      </a>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Wayline home">
          <img src="/favicon.svg" width={36} height={36} alt="" />
          <span>
            wayline<span className="brand-caption">ELD TRIP PLANNER</span>
          </span>
        </a>
        <div className="header-nav">
          <span className="nav-active">
            <Map size={16} />
            Trip planner
          </span>
          <span className="workspace-label">A little planning. A better journey.</span>
        </div>
        <div className="header-actions">
          <a className="help-link" href={isHome ? "#planning-notes" : "/"}>
            Planning notes
            <ArrowUpRight size={14} />
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggle}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </Button>
          <span className="driver-avatar" aria-label="Demo driver">
            DD
          </span>
        </div>
      </header>
      {!isHome ? (
        <main id="main-content" className="not-found" tabIndex={-1}>
          <span className="empty-route-icon">
            <Route size={30} />
          </span>
          <span className="eyebrow">404 · OFF THE ROUTE</span>
          <h1>Let’s get you back on the road.</h1>
          <p>This page couldn’t be found. Your next trip starts at the planner.</p>
          <Button asChild>
            <a href="/">
              <ArrowLeft size={16} />
              Back to trip planner
            </a>
          </Button>
        </main>
      ) : (
        <main id="main-content" className="workspace" tabIndex={-1}>
          <div className="workspace-heading">
            <div>
              <div className="breadcrumb">
                WORKSPACE <span aria-hidden="true">/</span> TRIP PLANNER
              </div>
              <h1>Make every mile count.</h1>
              <p>Your route, required stops, and driver logs. All planned ahead.</p>
            </div>
            <span className="rules-badge">
              <CheckCircle2 size={15} />
              70-hour property-carrying rules
            </span>
          </div>
          <div className="planner-layout">
            <TripForm
              pending={mutation.isPending}
              onSubmit={(payload) => {
                focusAfterPlanning.current = true;
                mutation.mutate(payload);
              }}
              onEdit={edit}
            />
            <div className="results-column" ref={results}>
              <PlanningProgress
                key={`${mutation.submittedAt}-${planningPhase}`}
                pending={mutation.isPending}
                phase={planningPhase}
              />
              {mutation.isError && (
                <div
                  className="api-error"
                  role="alert"
                  tabIndex={-1}
                  ref={errorNotice}
                  aria-labelledby="api-error-title"
                >
                  <AlertTriangle size={20} />
                  <div>
                    <strong id="api-error-title">We couldn’t plan this trip</strong>
                    <p>
                      {mutation.error instanceof ApiError
                        ? mutation.error.message
                        : "Please check your trip details and try again."}
                    </p>
                    {mutation.error instanceof ApiError &&
                      Object.values(mutation.error.fields).length > 0 && (
                        <ul>
                          {Object.values(mutation.error.fields).map(
                            (message, index) => (
                              <li key={index}>{message}</li>
                            ),
                          )}
                        </ul>
                      )}
                    <Button type="submit" form="trip-form" variant="outline" size="sm">
                      Try again
                    </Button>
                  </div>
                </div>
              )}
              {plan && !mutation.isPending && !mutation.isError && !dirty && (
                <div
                  className="plan-ready"
                  role="status"
                  tabIndex={-1}
                  ref={readyNotice}
                  aria-labelledby="plan-ready-title"
                >
                  <CheckCircle2 size={18} />
                  <div>
                    <strong id="plan-ready-title">Your route is ready</strong>
                    <span>
                      {plan.route.total_miles.toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })}{" "}
                      miles · {plan.summary.log_days} daily logs prepared
                    </span>
                  </div>
                </div>
              )}
              {plan?.warnings.map((warning, index) => (
                <div className="provider-warning" role="status" key={index}>
                  <AlertTriangle size={18} />
                  <p>{warning}</p>
                </div>
              ))}
              <div ref={mapView} className="map-view">
                <Suspense
                  fallback={
                    <div className="map-skeleton" role="status">
                      <Map size={28} />
                      <span>Preparing your map…</span>
                    </div>
                  }
                >
                  <RouteMap
                    plan={plan}
                    dirty={dirty}
                    pending={mutation.isPending}
                    selection={selection}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                    onSelect={selectFromMap}
                  />
                </Suspense>
              </div>
              {!plan && mutation.isPending && <ResultsSkeleton />}
              {plan && (
                <TripResults
                  plan={plan}
                  tab={tab}
                  onTabChange={setTab}
                  selection={selection}
                  hoveredId={hoveredId}
                  onHover={setHoveredId}
                  onSelect={(id, revealMap) => {
                    setSelection({ id, source: "itinerary" });
                    if (revealMap)
                      mapView.current?.scrollIntoView({
                        behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                          .matches
                          ? "instant"
                          : "smooth",
                        block: "start",
                      });
                  }}
                  dirty={dirty}
                  pending={mutation.isPending}
                />
              )}
            </div>
          </div>
          <footer className="workspace-footer">
            <span>Thoughtful planning, from start to delivery.</span>
            <span>Planning estimates · Verify before driving</span>
          </footer>
        </main>
      )}
    </MotionConfig>
  );
}

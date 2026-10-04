import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { PlanningPhase } from "@/lib/api";

export function PlanningProgress({
  pending,
  phase = "planning",
}: {
  pending: boolean;
  phase?: PlanningPhase;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const start = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);
  if (!pending) return null;
  // One server request performs every stage; do not claim a stage has completed.
  return (
    <div
      className="planning-progress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <LoaderCircle size={20} className="spin" aria-hidden="true" />
      <div>
        <strong>
          {phase === "connecting"
            ? elapsed >= 12000
              ? "Waiting for the server…"
              : "Connecting to the planning service…"
            : elapsed >= 12000
              ? "Still planning your trip…"
              : "Planning your trip…"}
        </strong>
        <span>
          {phase === "connecting"
            ? elapsed >= 12000
              ? "The server may be waking up. This can take about a minute; please keep this page open."
              : "Checking that the server is ready before submitting your trip."
            : "Finding a route, applying HOS rules, and preparing daily logs."}
        </span>
      </div>
    </div>
  );
}

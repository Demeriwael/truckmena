import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

export function PlanningProgress({ pending }: { pending: boolean }) {
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
    <div className="planning-progress" role="status">
      <LoaderCircle size={20} className="spin" />
      <div>
        <strong>
          {elapsed >= 12000 ? "Still planning your trip…" : "Planning your trip…"}
        </strong>
        <span>
          {elapsed >= 12000
            ? "The service may be waking up. Your route is still being prepared."
            : "Finding a route, applying HOS rules, and preparing daily logs."}
        </span>
      </div>
    </div>
  );
}

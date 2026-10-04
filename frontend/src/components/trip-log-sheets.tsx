import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  LoaderCircle,
  Maximize2,
} from "lucide-react";
import type { TripPlan } from "@/lib/contracts";
import { durationLabel } from "@/lib/format";
import { logClock, logRows } from "@/lib/log-sheet";
import type { LogDownload } from "@/lib/log-export";
import { Button } from "./ui/button";
import { DailyLogSheet } from "./daily-log-sheet";

export function TripLogSheets({
  plan,
  disabled,
}: {
  plan: TripPlan;
  disabled: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [complete, setComplete] = useState("");
  const controller = useRef<AbortController | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const announcement = useRef<HTMLDivElement>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const focusAfterDownload = useRef(false);
  const downloading = !!progress;
  useEffect(() => {
    if (!downloading) return;
    const moved = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== document.body)
        focusAfterDownload.current = false;
    };
    document.addEventListener("focusin", moved);
    return () => document.removeEventListener("focusin", moved);
  }, [downloading]);
  useEffect(() => {
    if (downloading || !focusAfterDownload.current) return;
    const notice = error ? errorNotice.current : complete ? announcement.current : null;
    if (notice) {
      notice.focus({ preventScroll: true });
      focusAfterDownload.current = false;
    }
  }, [downloading, error, complete]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (disabled && controller.current) {
      controller.current.abort();
      controller.current = null;
      setProgress(null);
    }
  }, [disabled]);
  const day = Math.min(index, plan.logs.length - 1);
  const log = plan.logs[day]!;
  function changeDay(next: number) {
    setIndex(next);
    setError(false);
    setComplete("");
    if (viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
  }
  async function download(format: LogDownload, all = false) {
    if (disabled || controller.current) return;
    const abort = new AbortController();
    focusAfterDownload.current = true;
    controller.current = abort;
    setError(false);
    setComplete("");
    setProgress("Preparing download…");
    try {
      const { downloadLogs } = await import("@/lib/log-export");
      await downloadLogs({
        logs: all ? plan.logs : [log],
        warnings: plan.warnings,
        format,
        firstDay: all ? 1 : day + 1,
        totalDays: plan.logs.length,
        signal: abort.signal,
        onProgress: (completed, total) => {
          if (!abort.signal.aborted)
            setProgress(`Preparing sheet ${completed} of ${total}…`);
        },
      });
      if (!abort.signal.aborted)
        setComplete(
          all
            ? `Downloaded ${plan.logs.length} sheets in one PDF.`
            : `Downloaded ${log.date} as ${format.toUpperCase()}.`,
        );
    } catch {
      if (!abort.signal.aborted) setError(true);
    } finally {
      if (!abort.signal.aborted) {
        controller.current = null;
        setProgress(null);
      }
    }
  }
  return (
    <section
      className="log-sheets"
      aria-label="Daily log sheets"
      aria-busy={!!progress}
    >
      <div className="log-toolbar">
        <div>
          <span className="eyebrow">YOUR DAILY RECORD</span>
          <h2>Every day, accounted for.</h2>
          <p>24 hours per sheet · Trip time UTC{log.timezone_offset}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !!progress}
          onClick={() => void download("pdf", true)}
        >
          <FileDown size={16} aria-hidden="true" />
          Download all ({plan.logs.length})
        </Button>
      </div>
      <div className="log-page-controls">
        <div className="log-pager" role="group" aria-label="Log sheet pages">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous log day"
            disabled={day === 0 || !!progress}
            onClick={() => changeDay(day - 1)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </Button>
          <label className="log-date-picker">
            <span>
              Day {day + 1} of {plan.logs.length}
            </span>
            <select
              aria-label="Choose log day"
              value={day}
              disabled={!!progress}
              onChange={(event) => changeDay(Number(event.target.value))}
            >
              {plan.logs.map((entry, position) => (
                <option key={entry.iso_date} value={position}>
                  {entry.date}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next log day"
            disabled={day === plan.logs.length - 1 || !!progress}
            onClick={() => changeDay(day + 1)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </div>
        <div className="log-download-buttons">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={enlarged}
            onClick={() => setEnlarged(!enlarged)}
          >
            <Maximize2 size={15} aria-hidden="true" />
            {enlarged ? "Fit to width" : "Enlarge"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Download PNG for ${log.date}`}
            disabled={disabled || !!progress}
            onClick={() => void download("png")}
          >
            <Download size={15} aria-hidden="true" />
            PNG
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Download PDF for ${log.date}`}
            disabled={disabled || !!progress}
            onClick={() => void download("pdf")}
          >
            <Download size={15} aria-hidden="true" />
            PDF
          </Button>
        </div>
      </div>
      <div
        className="log-announcement"
        role="status"
        aria-label="Log download status"
        ref={announcement}
        tabIndex={-1}
        aria-live="polite"
        aria-atomic="true"
      >
        {progress ? (
          <>
            <LoaderCircle className="spinner" size={16} aria-hidden="true" />
            {progress}
          </>
        ) : (
          complete ||
          `Showing day ${day + 1} of ${plan.logs.length}. Downloads include the full sheet.`
        )}
      </div>
      {error && (
        <p className="log-export-error" role="alert" ref={errorNotice} tabIndex={-1}>
          We couldn’t create the download. Try again.
        </p>
      )}
      <div
        className={`log-paper-viewport${enlarged ? " is-enlarged" : ""}`}
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="Log sheet preview. Enlarge for more detail, then scroll to explore."
      >
        <div className="log-paper">
          <DailyLogSheet
            log={log}
            day={day + 1}
            count={plan.logs.length}
            warnings={plan.warnings}
          />
        </div>
      </div>
      <details className="log-text-details">
        <summary>View log details as text</summary>
        <div className="log-details-heading">
          <strong>
            {log.date} · {log.driver_name}
          </strong>
          <span>
            {log.total_miles.toFixed(2)} miles driven · {log.carrier_name}
          </span>
        </div>
        <dl className="log-metadata">
          {[
            ["From", log.from],
            ["To", log.to],
            ["Main office", log.main_office_address],
            ["Home terminal", log.home_terminal_address],
            ["Vehicle numbers", log.vehicle],
            [
              "Time standard",
              `UTC${log.timezone_offset}, period starts ${log.period_start}`,
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <dl className="log-duty-totals">
          {logRows.map((row) => (
            <div key={row.status}>
              <dt>{row.label.join(" ")}</dt>
              <dd>
                {log.totals[row.key].toFixed(2)} hours{" "}
                <span>({durationLabel(log.totals_min[row.key])})</span>
              </dd>
            </div>
          ))}
        </dl>
        <ol className="log-text-remarks">
          {log.remarks.map((remark, i) => (
            <li key={i}>
              <time>{logClock(remark.minute_of_day)}</time>
              <div>
                <strong>{remark.place}</strong>
                <p>{remark.note}</p>
              </div>
            </li>
          ))}
        </ol>
        <p>
          <strong>Shipping documents:</strong> {log.shipping_doc}
        </p>
        <p>
          <strong>Planning recap:</strong> A {log.recap.a.toFixed(2)} hours · B{" "}
          {log.recap.b.toFixed(2)} hours · C {log.recap.c.toFixed(2)} hours.
        </p>
        {log.recap.notes.map((note, i) => (
          <p key={i}>{note}</p>
        ))}
      </details>
      <p className="log-footnote">
        Planning estimates · Unsigned · Review the full sheet before use. Download all
        creates one PDF with a page for each day.
      </p>
    </section>
  );
}

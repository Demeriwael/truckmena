import { renderToStaticMarkup } from "react-dom/server";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import type { DailyLog } from "./contracts";
import { logSheetLayout, sheetWidth } from "./log-sheet";
import { DailyLogSheet } from "@/components/daily-log-sheet";

export type LogDownload = "png" | "pdf";

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
}

function saveFile(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

// A single fixed-size node is rendered at a time, independently of the visible
// pager, dark theme, mobile viewport, and map tiles. Never export a hidden panel.
export async function downloadLogs({
  logs,
  warnings,
  format,
  signal,
  onProgress,
  firstDay,
  totalDays,
}: {
  logs: DailyLog[];
  warnings: string[];
  format: LogDownload;
  signal: AbortSignal;
  firstDay: number;
  totalDays: number;
  onProgress: (completed: number, total: number) => void;
}) {
  checkCancelled(signal);
  if (!logs.length || (format === "png" && logs.length !== 1))
    throw new Error("Choose one sheet for PNG or all sheets for PDF.");
  let pdf: jsPDF | undefined;
  let png = "";
  for (const [index, log] of logs.entries()) {
    checkCancelled(signal);
    const height = logSheetLayout(log, warnings).height;
    const node = document.createElement("div");
    node.setAttribute("aria-hidden", "true");
    node.inert = true;
    node.style.cssText = `position:fixed;left:-20000px;top:0;width:${sheetWidth}px;height:${height}px;background:white;pointer-events:none;`;
    // Markup comes exclusively from React's escaped SVG component, never raw
    // provider/user HTML. Reuse exactly the same renderer as the on-screen sheet.
    node.innerHTML = renderToStaticMarkup(
      <DailyLogSheet
        log={log}
        day={index + firstDay}
        count={totalDays}
        warnings={warnings}
      />,
    );
    document.body.append(node);
    try {
      png = await toPng(node, {
        width: sheetWidth,
        height,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        skipFonts: true,
        style: {
          position: "static",
          left: "auto",
          top: "auto",
          margin: "0",
          transform: "none",
        },
      });
    } finally {
      node.remove();
    }
    checkCancelled(signal);
    if (format === "pdf") {
      // Keep the type size fixed on Letter-width pages. Lengthy remarks extend
      // the page height instead of shrinking or clipping the complete sheet.
      const pageWidth = 792;
      const imageWidth = pageWidth - 40;
      const imageHeight = (height * imageWidth) / sheetWidth;
      const pageHeight = Math.max(612, imageHeight + 40);
      const orientation = pageHeight > pageWidth ? "portrait" : "landscape";
      if (!pdf)
        pdf = new jsPDF({
          orientation,
          unit: "pt",
          format: [pageWidth, pageHeight],
          compress: true,
        });
      else pdf.addPage([pageWidth, pageHeight], orientation);
      pdf.addImage(png, "PNG", 20, 20, imageWidth, imageHeight, undefined, "FAST");
    }
    onProgress(index + 1, logs.length);
    // Let the progress announcement and cancellation reach the screen between
    // sheets. The final file is saved only after every requested page succeeds.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  checkCancelled(signal);
  const first = logs[0]!.iso_date;
  if (format === "png") saveFile(png, `wayline-log-${first}.png`);
  else {
    pdf!.setProperties({
      title: "Wayline daily trip logs",
      creator: "Wayline ELD Trip Planner",
    });
    const url = URL.createObjectURL(pdf!.output("blob"));
    const filename =
      logs.length === 1
        ? `wayline-log-${first}.pdf`
        : `wayline-logs-${first}-to-${logs.at(-1)!.iso_date}.pdf`;
    try {
      saveFile(url, filename);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }
}

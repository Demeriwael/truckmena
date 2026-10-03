import type { DailyLog, DutyStatus } from "./contracts";

export const sheetWidth = 1200;
export const logGrid = { x: 184, width: 864, rowHeight: 40 };
export const logRows: {
  status: DutyStatus;
  key: keyof DailyLog["totals"];
  label: string[];
}[] = [
  { status: "OFF", key: "off", label: ["1. OFF DUTY"] },
  { status: "SLEEPER", key: "sleeper", label: ["2. SLEEPER", "BERTH"] },
  { status: "DRIVING", key: "driving", label: ["3. DRIVING"] },
  { status: "ON_DUTY", key: "on_duty", label: ["4. ON DUTY", "(NOT DRIVING)"] },
];

export function minuteToX(minute: number): number {
  if (!Number.isFinite(minute) || minute < 0 || minute > 1440)
    throw new RangeError("Log minutes must be within one calendar day.");
  return logGrid.x + (minute / 1440) * logGrid.width;
}

// Keep the backend's minute boundaries, including OFF display padding. Adjacent
// events in the same status do not create an artificial vertical duty change.
export function mapLogSegments(segments: DailyLog["segments"], top: number) {
  const points: [number, number][] = [];
  const changes: { x: number; y: number; minute: number }[] = [];
  let cursor = 0;
  let previous: DutyStatus | undefined;
  for (const segment of segments) {
    const start = segment.start_min_of_day;
    const end = segment.end_min_of_day;
    if (
      start !== cursor ||
      end <= start ||
      !Number.isInteger(start) ||
      !Number.isInteger(end)
    )
      throw new RangeError(
        "Log segments must cover 24 hours without gaps or overlaps.",
      );
    const row = logRows.findIndex(({ status }) => status === segment.status);
    const y = top + (row + 0.5) * logGrid.rowHeight;
    const x = minuteToX(start);
    if (previous !== segment.status) {
      points.push([x, y]);
      if (previous !== undefined) changes.push({ x, y, minute: start });
    }
    points.push([minuteToX(end), y]);
    cursor = end;
    previous = segment.status;
  }
  if (cursor !== 1440)
    throw new RangeError("Log segments must cover 24 hours without gaps or overlaps.");
  return { points: points.map(([x, y]) => `${x},${y}`).join(" "), changes };
}

// Conservative character widths keep ordinary and unbroken long input inside
// its field. Preserve every character; React escapes the resulting SVG text.
export function wrapLogText(text: string, width: number, fontSize = 14): string[] {
  const measure = (value: string) =>
    Array.from(value).reduce(
      (total, character) =>
        total +
        fontSize *
          (/[^\x20-\x7e]/.test(character) ? 1.1 : /[MW@%]/.test(character) ? 1 : 0.68),
      0,
    );
  const limit = Math.max(fontSize * 1.1, width);
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const characters = Array.from(word);
    while (measure(characters.join("")) > limit) {
      if (line) {
        lines.push(line);
        line = "";
      }
      let length = 1;
      while (
        length < characters.length &&
        measure(characters.slice(0, length + 1).join("")) <= limit
      )
        length++;
      lines.push(characters.splice(0, length).join(""));
    }
    const remainder = characters.join("");
    if (line && measure(`${line} ${remainder}`) > limit) {
      lines.push(line);
      line = remainder;
    } else line = line ? `${line} ${remainder}` : remainder;
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["-"];
}

export function logClock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function compactLogPlace(place: string): string {
  const text = Array.from(place);
  return text.length <= 32 ? place : `${text.slice(0, 29).join("")}...`;
}

export function logSheetLayout(log: DailyLog, warnings: string[] = []) {
  const fields = [
    [
      { label: "FROM", value: log.from, width: 552 },
      { label: "TO", value: log.to, width: 552 },
    ],
    [
      {
        label: "TOTAL MILES DRIVING TODAY",
        value: log.total_miles.toFixed(2),
        width: 256,
      },
      {
        label: "TOTAL MILEAGE TODAY",
        value: log.total_mileage_today.toFixed(2),
        width: 256,
      },
      { label: "TRUCK / TRACTOR AND TRAILER NUMBERS", value: log.vehicle, width: 568 },
    ],
    [
      { label: "NAME OF CARRIER OR CARRIERS", value: log.carrier_name, width: 552 },
      { label: "DRIVER NAME (UNSIGNED)", value: log.driver_name, width: 552 },
    ],
    [
      { label: "MAIN OFFICE ADDRESS", value: log.main_office_address, width: 552 },
      { label: "HOME TERMINAL ADDRESS", value: log.home_terminal_address, width: 552 },
    ],
  ];
  let y = 90;
  const headers = fields
    .map((row) => {
      let x = 32;
      const height = Math.max(
        52,
        ...row.map(
          (field) => 28 + wrapLogText(field.value, field.width - 20, 15).length * 19,
        ),
      );
      const entries = row.map((field) => {
        const entry = {
          ...field,
          x,
          y,
          lines: wrapLogText(field.value, field.width - 20, 15),
          height,
        };
        x += field.width + 32;
        return entry;
      });
      y += height + 8;
      return entries;
    })
    .flat();
  const gridTop = y + 36;
  const remarksTop = gridTop + 4 * logGrid.rowHeight + 42;
  const remarksBands = Math.max(1, Math.ceil(log.remarks.length / 10));
  y = remarksTop + remarksBands * 130 + 12;
  const remarkRows = [];
  for (let i = 0; i < log.remarks.length; i += 2) {
    const entries = log.remarks.slice(i, i + 2).map((remark, column) => ({
      ...remark,
      index: i + column + 1,
      x: 32 + column * 584,
      y,
      placeLines: wrapLogText(remark.place, 500, 13),
      noteLines: wrapLogText(remark.note, 500, 12),
    }));
    const height = Math.max(
      ...entries.map(
        (entry) => 20 + (entry.placeLines.length + entry.noteLines.length) * 16,
      ),
    );
    remarkRows.push(...entries);
    y += height + 12;
  }
  const shippingY = y + 8;
  const shippingLines = wrapLogText(log.shipping_doc, 1100, 14);
  const recapY = shippingY + 34 + shippingLines.length * 18;
  const notes = [
    `On duty today (rows 3 + 4): ${log.recap.on_duty_today.toFixed(2)} hours.`,
    ...log.recap.notes,
    ...warnings,
  ];
  const noteLines = notes.flatMap((note) => wrapLogText(note, 1100, 12));
  const footerY = recapY + 138 + noteLines.length * 16 + 26;
  return {
    headers,
    gridTop,
    remarksTop,
    remarksBands,
    remarkRows,
    shippingY,
    shippingLines,
    recapY,
    noteLines,
    footerY,
    height: footerY + 30,
  };
}

import { useId } from "react";
import type { DailyLog } from "@/lib/contracts";
import {
  compactLogPlace,
  logClock,
  logGrid,
  logRows,
  logSheetLayout,
  mapLogSegments,
  minuteToX,
  sheetWidth,
  wrapLogText,
} from "@/lib/log-sheet";

function TextLines({
  x,
  y,
  lines,
  size = 14,
  lineHeight = 18,
  bold = false,
}: {
  x: number;
  y: number;
  lines: string[];
  size?: number;
  lineHeight?: number;
  bold?: boolean;
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={bold ? 700 : 400}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index ? lineHeight : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function HourLabels({ y }: { y: number }) {
  return (
    <g fontSize={11} textAnchor="middle">
      {Array.from({ length: 25 }, (_, hour) =>
        hour === 0 || hour === 24 ? (
          <text key={hour} x={minuteToX(hour * 60)} y={y - 6}>
            MID-
            <tspan x={minuteToX(hour * 60)} dy={12}>
              NIGHT
            </tspan>
          </text>
        ) : (
          <text key={hour} x={minuteToX(hour * 60)} y={y}>
            {hour === 12 ? "NOON" : hour % 12}
          </text>
        ),
      )}
    </g>
  );
}

// All geometry is in a fixed coordinate system. Screen width, browser timezone,
// theme, and export pixel ratio cannot change the authoritative minute clocks.
export function DailyLogSheet({
  log,
  day,
  count,
  warnings = [],
}: {
  log: DailyLog;
  day: number;
  count: number;
  warnings?: string[];
}) {
  const id = useId();
  const layout = logSheetLayout(log, warnings);
  const duty = mapLogSegments(log.segments, layout.gridTop);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${sheetWidth} ${layout.height}`}
      width={sheetWidth}
      height={layout.height}
      role="img"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      style={{
        display: "block",
        width: "100%",
        height: "auto",
        background: "#fff",
        color: "#16202a",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
      fill="#16202a"
    >
      <title id={`${id}-title`}>
        {`Driver's Daily Log - ${log.date} - Day ${day} of ${count}`}
      </title>
      <desc id={`${id}-description`}>
        24-hour duty graph in UTC{log.timezone_offset}. Off duty{" "}
        {log.totals.off.toFixed(2)}, sleeper berth {log.totals.sleeper.toFixed(2)},
        driving {log.totals.driving.toFixed(2)}, on duty {log.totals.on_duty.toFixed(2)}{" "}
        hours. Total 24.00 hours. {log.total_miles.toFixed(2)} miles driven. Full
        details follow the sheet.
      </desc>
      <rect width={sheetWidth} height={layout.height} fill="#fff" />
      <text x={32} y={42} fontSize={27} fontWeight={700}>
        DRIVER&apos;S DAILY LOG
      </text>
      <text x={32} y={63} fontSize={12}>
        ONE CALENDAR DAY - 24 HOURS
      </text>
      <text x={620} y={42} fontSize={25} fontWeight={700} textAnchor="middle">
        {log.date}
      </text>
      <text x={620} y={63} fontSize={11} textAnchor="middle">
        MONTH / DAY / YEAR
      </text>
      <text x={1168} y={31} textAnchor="end" fontSize={11}>
        Original - File at home terminal
      </text>
      <text x={1168} y={49} textAnchor="end" fontSize={11}>
        Duplicate - Driver retains for 8 days
      </text>
      <text x={1168} y={67} textAnchor="end" fontSize={11}>
        Trip time: UTC{log.timezone_offset} | Period starts {log.period_start}
      </text>
      {layout.headers.map((field) => (
        <g key={field.label}>
          <rect
            x={field.x}
            y={field.y}
            width={field.width}
            height={field.height}
            fill="none"
            stroke="#87929a"
            strokeWidth={0.8}
          />
          <text x={field.x + 10} y={field.y + 16} fontSize={10.5} fill="#46535f">
            {field.label}
          </text>
          <TextLines
            x={field.x + 10}
            y={field.y + 36}
            lines={field.lines}
            size={15}
            lineHeight={19}
            bold
          />
        </g>
      ))}
      <HourLabels y={layout.gridTop - 16} />
      <TextLines
        x={1085}
        y={layout.gridTop - 26}
        lines={["TOTAL", "HOURS"]}
        size={11}
        lineHeight={13}
        bold
      />
      <g stroke="#596672" fill="none">
        <rect
          x={logGrid.x}
          y={layout.gridTop}
          width={logGrid.width}
          height={160}
          strokeWidth={1.2}
        />
        {Array.from({ length: 23 }, (_, i) => (
          <line
            key={`hour-${i}`}
            x1={minuteToX((i + 1) * 60)}
            x2={minuteToX((i + 1) * 60)}
            y1={layout.gridTop}
            y2={layout.gridTop + 160}
            strokeWidth={0.65}
          />
        ))}
        {logRows.map((row, index) => (
          <g key={row.status}>
            <line
              x1={logGrid.x}
              x2={logGrid.x + logGrid.width}
              y1={layout.gridTop + index * 40}
              y2={layout.gridTop + index * 40}
              strokeWidth={0.9}
            />
            {Array.from({ length: 95 }, (_, i) =>
              i % 4 === 3 ? null : (
                <line
                  key={i}
                  x1={minuteToX((i + 1) * 15)}
                  x2={minuteToX((i + 1) * 15)}
                  y1={layout.gridTop + index * 40}
                  y2={layout.gridTop + index * 40 + ((i + 1) % 2 === 0 ? 13 : 7)}
                  strokeWidth={0.6}
                />
              ),
            )}
            <rect
              x={1070}
              y={layout.gridTop + index * 40}
              width={88}
              height={40}
              strokeWidth={0.8}
            />
          </g>
        ))}
      </g>
      {logRows.map((row, index) => (
        <g key={row.status}>
          <TextLines
            x={32}
            y={layout.gridTop + index * 40 + (row.label.length === 1 ? 25 : 18)}
            lines={row.label}
            size={12}
            lineHeight={14}
            bold
          />
          <text
            x={1114}
            y={layout.gridTop + index * 40 + 26}
            textAnchor="middle"
            fontSize={19}
            fontWeight={700}
          >
            {log.totals[row.key].toFixed(2)}
          </text>
        </g>
      ))}
      <polyline
        data-duty-line="true"
        points={duty.points}
        fill="none"
        stroke="#162f46"
        strokeWidth={3.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {duty.changes.map(({ x, y, minute }) => (
        <circle key={minute} cx={x} cy={y} r={3.4} fill="#162f46" />
      ))}
      <text
        x={1114}
        y={layout.gridTop + 182}
        textAnchor="middle"
        fontSize={15}
        fontWeight={700}
      >
        24.00
      </text>
      <text x={32} y={layout.remarksTop} fontSize={13} fontWeight={700}>
        REMARKS
      </text>
      <HourLabels y={layout.remarksTop - 2} />
      {log.remarks.map((remark, index) => {
        const band = Math.floor(index / 10);
        const entriesInBand = Math.min(10, log.remarks.length - band * 10);
        const slot =
          194 +
          (entriesInBand === 1 ? 390 : ((index % 10) / (entriesInBand - 1)) * 790);
        const top = layout.remarksTop + 16 + band * 130;
        const lines = wrapLogText(
          `${index + 1}. ${compactLogPlace(remark.place)}`,
          150,
          11,
        );
        return (
          <g key={index}>
            <path
              d={`M ${minuteToX(remark.minute_of_day)} ${layout.remarksTop + 10} V ${top + 12} L ${slot} ${top + 22} V ${top + 29}`}
              stroke="#66747f"
              strokeWidth={0.8}
              fill="none"
            />
            <g transform={`translate(${slot + 3} ${top + 34}) rotate(52)`}>
              <TextLines x={0} y={0} lines={lines} size={11} lineHeight={13} />
            </g>
          </g>
        );
      })}
      {!log.remarks.length && (
        <text x={194} y={layout.remarksTop + 56} fontSize={13}>
          No duty changes during this calendar day.
        </text>
      )}
      {layout.remarkRows.map((remark) => (
        <g key={remark.index}>
          <text x={remark.x} y={remark.y} fontSize={11} fontWeight={700}>
            {remark.index}. {logClock(remark.minute_of_day)}
          </text>
          <TextLines
            x={remark.x + 72}
            y={remark.y}
            lines={remark.placeLines}
            size={13}
            lineHeight={16}
            bold
          />
          <TextLines
            x={remark.x + 72}
            y={remark.y + remark.placeLines.length * 16 + 3}
            lines={remark.noteLines}
            size={12}
            lineHeight={16}
          />
        </g>
      ))}
      <text x={32} y={layout.shippingY} fontSize={11} fontWeight={700}>
        SHIPPING DOCUMENTS - B/L OR MANIFEST NO. / SHIPPER &amp; COMMODITY
      </text>
      <TextLines
        x={32}
        y={layout.shippingY + 24}
        lines={layout.shippingLines}
        size={14}
        bold
      />
      <g transform={`translate(32 ${layout.recapY})`}>
        <rect
          width={1136}
          height={114}
          stroke="#596672"
          strokeWidth={0.8}
          fill="none"
        />
        <text x={12} y={22} fontSize={13} fontWeight={700}>
          PLANNING RECAP - 70 HOUR / 8 DAY DRIVER
        </text>
        <line x1={0} x2={1136} y1={34} y2={34} stroke="#596672" strokeWidth={0.8} />
        {[
          {
            title: "A. ON DUTY IN CURRENT CYCLE",
            detail: "Includes supplied prior hours",
            value: log.recap.a,
          },
          {
            title: "B. HOURS AVAILABLE TOMORROW",
            detail: "70 hours minus A; minimum zero",
            value: log.recap.b,
          },
          {
            title: "C. ON DUTY IN LAST FIVE TRIP DAYS",
            detail: "Trip days only, including today",
            value: log.recap.c,
          },
        ].map((cell, index) => (
          <g key={cell.title} transform={`translate(${(index * 1136) / 3} 0)`}>
            {index > 0 && (
              <line x1={0} x2={0} y1={34} y2={114} stroke="#596672" strokeWidth={0.8} />
            )}
            <text x={12} y={54} fontSize={10.5} fontWeight={700}>
              {cell.title}
            </text>
            <text x={12} y={70} fontSize={11}>
              {cell.detail}
            </text>
            <text x={12} y={101} fontSize={24} fontWeight={700}>
              {cell.value.toFixed(2)}{" "}
              <tspan fontSize={12} fontWeight={400}>
                hours
              </tspan>
            </text>
          </g>
        ))}
      </g>
      <TextLines
        x={32}
        y={layout.recapY + 138}
        lines={layout.noteLines}
        size={12}
        lineHeight={16}
      />
      <line
        x1={32}
        x2={1168}
        y1={layout.footerY - 16}
        y2={layout.footerY - 16}
        stroke="#a8b1b8"
        strokeWidth={0.8}
      />
      <text x={32} y={layout.footerY} fontSize={11}>
        Wayline | Planning estimate - not signed or certified
      </text>
      <text x={1168} y={layout.footerY} textAnchor="end" fontSize={11}>
        Day {day} of {count} | {log.iso_date}
      </text>
    </svg>
  );
}

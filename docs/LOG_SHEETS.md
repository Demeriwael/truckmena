# Wayline log sheets

Daily log sheets show the planned trip as full calendar days, with exact duty minutes, mileage, remarks, and a planning recap. They are unsigned planning estimates.

## Building calendar-day sheets

`build_daily_logs(schedule, start, metadata=..., places=...)` in the [log builder](../backend/trips/services/log_builder.py) is a pure function returning immutable sheets. It performs no network, filesystem, Django, or database I/O. The planner passes already enriched event labels; driving continuations can use a computed `Mile N on route` label.

Every positive engine interval is split at fixed-offset midnight. Each sheet covers minute 0 through 1440 with no zero-length segments, gaps, or overlaps. An exact midnight finish creates no empty next day.

Only time before departure and after final delivery is filled as OFF. These segments have `is_padding: true`, contribute no mileage, and do not reset the scheduler's actual cycle state. They do not establish what the driver actually did outside the planned trip.

| Fields                                                        | Meaning                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `date`, `iso_date`                                            | Printed `MM/DD/YYYY` date and sortable ISO calendar date.                                                                     |
| `from`, `to`                                                  | Places at the beginning and end of that day's planned portion.                                                                |
| `total_miles`, `total_mileage_today`, `cumulative_trip_miles` | Daily routed mileage and cumulative trip mileage. No odometer or other vehicle mileage is invented.                           |
| `segments`                                                    | Duty status, minute-of-day bounds, place, source `event_id`, mile-marker bounds, and padding flag.                            |
| `remarks`                                                     | Full work/stop notes, midnight continuations, and restart completion.                                                         |
| `totals_min`, `totals`, `recap`                               | Exact duty minutes, printed duty hours, and planning recap.                                                                   |
| Metadata                                                      | Driver, carrier, office/terminal addresses, vehicle, shipping document, fixed `timezone_offset`, and midnight `period_start`. |

A restart-completion remark at minute 1440 belongs to the ending sheet. This keeps an exact midnight completion on the day whose duty interval just ended.

## Totals and mileage

Mileage is allocated proportionally to minutes within each driving interval using exact fractions. Daily mileage sums exactly to provider mileage internally; JSON exposes numeric values without rounding daily mileage to a fixed decimal precision.

`totals_min` contains integer minutes for `off`, `sleeper`, `driving`, and `on_duty`, summing to 1440. `totals` contains display hours to two decimal places. Largest-remainder rounding distributes hundredths so the four displayed rows always sum to **24.00**, rather than independently producing 23.99 or 24.01. Use minutes for calculations and decimal hours for printing.

Both mileage header boxes use the day's routed driving mileage. Neither represents an odometer reading.

## Planning recap A/B/C

Only initial cycle usage is supplied; prior daily records are unavailable. The recap follows the scheduler's assumption that no historical hours drop off.

| Field | Calculation                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Initial cycle minutes plus scheduled on-duty minutes until a completed restart; afterward, scheduled on-duty minutes since that reset. |
| B     | `max(0, 70 hours - A)`. Unknown rolling history does not create availability.                                                          |
| C     | On-duty time in the last five trip calendar dates, including today. Pre-trip history is excluded.                                      |

A resets only at the scheduled completion of a 34-hour restart, including an exact midnight boundary. An unfinished restart retains the old cycle value. `restart_in_progress` and `restart_taken` distinguish these cases; the completion date includes “34-hour restart taken.”

Permitted non-driving work can take A above 70 hours; B remains zero while driving is prohibited. C retains observed duty before a restart if it is still inside the five-date window. This five-trip-day definition is explicitly labeled **Planning recap**, rather than reconstructing a carrier's historical rolling recap or the paper form's eight-day C.

Recap A/B/C and `on_duty_today` are display hours. Companion integer-minute fields preserve cycle and five-day calculations. Recap notes explain the missing history. See [HOS boundary decisions](HOS_RULES.md#boundary-decisions).

## Time and header metadata

Real records use the home terminal's time standard and total 24 hours under [49 CFR 395.8(f)(8) and (11)](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-395/subpart-A/section-395.8).

Wayline uses the supplied departure offset or the start location's current offset as its terminal-time proxy. The offset is frozen across daylight-saving transitions so every grid contains 1440 minutes. Terminal addresses are header text, not a separate timezone input.

An optional departure entered in the frontend uses the browser's offset at that date. Leaving it blank lets the API infer the start location's offset offline. Map popups, itinerary rows, and log sheets retain the returned trip offset rather than converting to the viewer's zone.

Optional driver, carrier, terminal, vehicle, and freight fields populate the headers. The filled driver name remains unsigned. These headers and planned intervals do not certify historical records.

## Preview and exports

**Log Sheets** provides a date picker and Previous/Next buttons. **PNG** and **PDF** export the selected sheet; **Download all (N)** creates one PDF in calendar order. **Enlarge** keeps the original-width grid in a scrollable preview; **Fit to width** restores the responsive preview. **View log details as text** exposes readable headers, duty totals, exact-minute durations, and full remarks.

Edited or updating plans retain the old preview but disable downloads until a new plan succeeds.

- The SVG includes filled headers, a 24-hour grid, four duty rows, quarter-hour ticks, a stepped duty line, change dots, totals, and angled location callouts. The renderer uses API minute boundaries and display totals; it does not recompute HOS rules or round duty changes to quarter-hours.
- Long header values and full numbered remarks wrap without truncation. Angled callouts may shorten a place while its full value remains in the corresponding numbered remark.
- Browser-local `html-to-image` captures one fixed 1,200-pixel-wide SVG at 2× resolution, independently of preview width, theme, map tiles, and pager state.
- `jsPDF` embeds the capture on an 11-inch-wide page. Page height grows to retain long content at a consistent type size. Choose **Fit to page** when printing on standard paper. PDF pages contain raster images; readable text remains available in the UI.
- Whole-trip exports render one sheet at a time and save only after all requested pages succeed. Leaving Log Sheets or changing the plan cancels unfinished work. Provider fallback warnings and recap assumptions remain in downloads.

The [SVG renderer](../frontend/src/components/daily-log-sheet.tsx), [layout helpers](../frontend/src/lib/log-sheet.ts), and [export implementation](../frontend/src/lib/log-export.tsx) share the same sheet content.

## Summary and itinerary

The summary's trip bar counts scheduled events, excluding log-sheet OFF padding. **Delivery complete** includes the final hour of unloading; the delivery marker indicates arrival before unloading.

The cycle gauge uses the final log's exact `cycle_used_min` and the summary's remaining cycle time, including completed restarts. If permitted work finishes above 70 hours, the gauge fills at 70 while its text shows actual use and zero availability. It does not infer historical rolling-hour dropoff.

Overnight itinerary rows retain the original event identity and map position. See [result navigation](ACCESSIBILITY.md#results-and-map-synchronization).

## Verification

[Log-builder tests](../backend/trips/tests/test_log_builder.py) reconstruct schedules from fragments and independently derive end-of-day cycles. Cases cover midnight crossings, full off-duty days, fractional mileage, year rollover, exhausted cycles, completed/pending restarts, display rounding, and half-hour/quarter-hour offsets. API tests cover the rendered contract and custom headers.

Frontend tests cover minute-to-SVG mapping, contiguous segments, same-status boundaries, long text, escaping, pagination, stale-plan controls, cancellation, and saving only after every page succeeds. Run automated checks using [Contributing](CONTRIBUTING.md#quality-checks).

For browser review, plan the sample and navigate every day. Check a rest crossing midnight and a completed restart, enlarge the grid, read text details, and export one-day PNG/PDF plus the whole-trip PDF. Repeat in dark theme and a narrow viewport; include long custom headers. Completed browser evidence belongs in the dated [deployment verification record](DEPLOYMENT.md#verification-record).

[Back to README](../README.md)

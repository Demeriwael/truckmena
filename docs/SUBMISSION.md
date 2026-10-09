# Wayline submission and walkthrough

## Reviewer walkthrough

Open [Wayline](https://wayline.demeri.dev/), choose
**Use sample trip**, and press **Plan trip**.
The cross-country sample includes coordinates to make routing easy to try.
Confirm the provider warning if the route uses OSRM. View **Summary**, select an
event in **Itinerary** to open its map popup, then browse **Log Sheets** and click
**Download all (N)** to export the whole-trip PDF. The separate **PDF** button
exports the displayed day. Every day totals 24.00 hours, including off-duty padding
outside the planned trip.

The [backend health URL](https://truckmena-api.onrender.com/api/health) returns
the service status without making provider requests. The free backend can take
time to wake before the first plan. Dated API, browser, export, and local-check
results are preserved in the [deployment verification record](DEPLOYMENT.md#verification-record).

## Submission links

| Item           | Link / status                                                |
| -------------- | ------------------------------------------------------------ |
| Frontend       | [Wayline trip planner](https://wayline.demeri.dev/)          |
| Backend health | [API health](https://truckmena-api.onrender.com/api/health)  |
| Repository     | [GitHub repository](https://github.com/Demeriwael/truckmena) |
| Loom           | Recording pending; use the four-minute outline below         |

## 4-minute Loom talk track

| Time      | Screen / action                                | Talking points                                                                                                                                                         |
| --------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:45 | Sample trip, route, and Summary                | “Wayline turns a truck trip and current cycle usage into a route, required stops, and daily logs.” Identify distance, trip duration, and provider/fallback warning.    |
| 0:45–1:25 | Itinerary → selected map event                 | Explain 8-hour driving breaks, 11-hour driving allowance, the running 14-hour window, 70-hour cycle, 10-hour rests, 34-hour restart, and fuel at 1,000-mile gaps.      |
| 1:25–2:05 | Log Sheets, next day, Download all (N)         | Show midnight splitting, four duty rows, totals summing to 24.00, remarks, restart recap, and one exported page per day. These are planned sheets, not signed records. |
| 2:05–2:55 | Architecture diagram and backend services      | Pure minute-based HOS functions; no I/O in the engine/log builder. Provider mileage drives scheduling at 55 mph. One ORS truck-routing request uses all three points.  |
| 2:55–3:30 | Tests and representative boundary cases        | Exact limits, independent schedule replay, property-style invariants, full-day coverage, frontend contract checks, keyboard focus, and bounded service wake-up.        |
| 3:30–4:00 | GitHub merged PRs/CI, deployment configuration | Small feature branches and reviewed merges; Conventional Commits, hooks, and CI. Server-only credentials, Vercel/Render separation, documented trade-offs.             |

Useful source files to open before recording:

- [HOS engine](../backend/trips/services/hos_engine.py): clocks and binding-limit decisions.
- [HOS tests](../backend/trips/tests/test_hos_engine.py): exact limits and independent replay.
- [Log builder](../backend/trips/services/log_builder.py): midnight splitting and exact totals.
- [Daily log renderer](../frontend/src/components/daily-log-sheet.tsx): SVG rendering.
- [Export implementation](../frontend/src/lib/log-export.tsx): complete sequential PDF/PNG capture.
- [Production settings](../backend/config/production_settings.py) and [Render Blueprint](../render.yaml): deployment boundary.
- [README](../README.md): architecture, HOS table, assumptions, and setup.

Record using a demo driver, not confidential shipment details. Open the backend
health endpoint before recording to allow a sleeping free instance to wake.
Keep the talk under five minutes; show one clear event and two log days rather
than narrating every stop. Finish by opening the downloaded PDF.

## Trade-offs to state plainly

- The only historical input is cycle usage. No unknown hours roll out of the
  cycle during the trip; a restart restores it. Historical recaps cannot be
  reconstructed from that scalar.
- Truck mileage comes from the route provider; driving time uses the planner's
  55 mph planning speed. Provider duration is a reference, not an HOS clock.
- Logs freeze the departure offset across the trip, including DST. OFF padding
  is a display assumption. Split sleeper, team drivers, adverse extensions, and
  short-haul exceptions are outside scope.
- OSRM fallback uses a car profile and displays a truck-restriction warning.
  Public Nominatim is disabled; it is never used for autocomplete.
- One backend process keeps caches and pacing consistent for a small demo.
  More instances need shared coordination. The free backend can sleep.
- Automated HTML/ARIA checks and browser keyboard/reflow/contrast checks do not
  substitute for a dedicated NVDA or VoiceOver audit.

## Submission checklist

- Share the frontend, API health, repository, and recording links above. Confirm
  the production frontend opens without a login gate.
- Add the public Loom URL to the [README walkthrough](../README.md#walkthrough)
  and the links table after recording.
- Keep the real images in the [README screenshots](../README.md#screenshots)
  representative of the current product and below the repository file-size limit.
- Link the dated [verification record](DEPLOYMENT.md#verification-record), and
  record new deployment checks separately from historical results.
- Preserve ignored secret files and review public changes using the
  [contributing checklist](CONTRIBUTING.md). Never include credentials in shared output.
- Reference the published annotated `v1.0.0` tag when discussing the original
  submission. Later changes should not move existing release tags.

Detailed assumptions: [HOS rules](HOS_RULES.md), [log sheets](LOG_SHEETS.md),
[providers](PROVIDERS.md), and [accessibility](ACCESSIBILITY.md).

[Back to README](../README.md)

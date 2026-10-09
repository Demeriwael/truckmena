# Deploy Wayline with Render and Vercel

Use the repository's `main` branch for both services and deploy changes after CI
passes. These steps create a demo deployment on Render's Free service and Vercel; no database,
disk, migrations, or user accounts are needed by the application.

The service names below are project labels. Hosting platforms choose the actual
public domains. Copy the domain shown in each dashboard rather than assuming
that the name is available. Never paste a secret into a Git command or a chat.

## Current production deployment

| Setting                                      | Current value                                               |
| -------------------------------------------- | ----------------------------------------------------------- |
| Frontend                                     | [Wayline](https://wayline.demeri.dev/)                      |
| Default Vercel domain                        | [Vercel alias](https://truckmena-frontend.vercel.app/)      |
| Backend health                               | [API health](https://truckmena-api.onrender.com/api/health) |
| Vercel project / root / preset               | `truckmena-frontend` / `frontend` / Vite                    |
| Render service / root                        | `truckmena-api` / `backend`                                 |
| Vercel Production `VITE_API_BASE_URL`        | `https://truckmena-api.onrender.com`                        |
| Render `CORS_ALLOWED_ORIGINS` primary origin | `https://wayline.demeri.dev`                                |

These two environment values are public origins. The ORS and Django credentials
are supplied through Render's secret environment fields. Local `.env` files are
not uploaded to either host.

Include the default Vercel origin in `CORS_ALLOWED_ORIGINS` only if it should also
be able to call the API. This table identifies the current primary frontend;
the dated verification record below identifies the domain used for those checks.

## 1. Create the Render backend

1. Open [Render](https://dashboard.render.com/), sign in, and connect the GitHub
   repository containing this app.
2. Choose **New → Blueprint**, select the repository, select **main**, and use
   `render.yaml` at the repository root. Name the Blueprint **truckmena**.
3. Review the proposed **truckmena-api** web service. Confirm the plan is **Free**
   before applying; this Blueprint creates no paid resources or database.
4. Supply the three prompted variables:
   - `DJANGO_SECRET_KEY`: generate it using the commands below, then paste the
     complete value into Render's secret field without quotes.
   - `ORS_API_KEY`: your existing ORS key, entered only in Render's secret field.
   - `CORS_ALLOWED_ORIGINS`: if the Vercel project already exists, enter its exact
     HTTPS production origin. Otherwise enter `https://deployment-pending.invalid`
     temporarily. This deliberately allows no real frontend until step 3 below.
5. Apply the Blueprint and wait for a successful build. Copy the public service
   URL shown by Render, without a trailing slash. This is the **API origin**.
6. Open that URL followed by `/api/health` in a browser. It must return:

```json
{ "status": "ok", "service": "eld-trip-planner" }
```

Generate `DJANGO_SECRET_KEY` once with Python's cryptographically secure generator.
After local setup, run this command from the repository root in Bash; it prints
the value for you to copy directly into Render's secret field:

```bash
.venv/bin/python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Windows PowerShell alternative, which copies the value without displaying it:

```powershell
./.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(64))" | Set-Clipboard
```

Both commands generate an 86-character value. Paste it only into Render's
`DJANGO_SECRET_KEY` value field. Django's deployment check requires at least 50
characters and adequate randomness. The Blueprint prompts for this secret with
`sync: false`; the build rejects inadequate secrets. The Python command avoids
depending on a hosting platform's default generated-key length.
For an existing service, edit its environment variable manually and choose
**Save, rebuild, and deploy**; Blueprint updates do not prompt for `sync: false`
values or replace an existing secret.

The Blueprint supplies these settings:

| Setting                  | Value / purpose                                                        |
| ------------------------ | ---------------------------------------------------------------------- |
| Branch / root directory  | `main` / `backend`                                                     |
| Runtime                  | Python `3.12.14`, pinned in `render.yaml`                              |
| Build command            | `bash build.sh`                                                        |
| Start command            | `python -m gunicorn config.wsgi:application --config gunicorn.conf.py` |
| Health check             | `/api/health`                                                          |
| Auto deploy              | `checksPass`, deploy after the linked branch's CI succeeds             |
| `DJANGO_SETTINGS_MODULE` | `config.production_settings`                                           |
| `DJANGO_DEBUG`           | `false`                                                                |
| `DJANGO_SECRET_KEY`      | An 86-character secret generated using the command above               |
| `DJANGO_TRUST_PROXY`     | `true`, for Render's managed HTTPS ingress                             |
| `NOMINATIM_ENABLED`      | `false`                                                                |
| `ORS_API_KEY`            | Server-only provider secret; never a frontend variable                 |
| `CORS_ALLOWED_ORIGINS`   | Exact frontend HTTPS origins, comma-separated, no paths or final slash |

`RENDER_EXTERNAL_HOSTNAME` is supplied by Render and becomes an allowed host.
If you add a custom backend domain, also set `DJANGO_ALLOWED_HOSTS` to that
hostname, such as `api.your-domain.example`, without `https://`, paths, or ports.
The Render hostname remains allowed. Wildcards and domain-wide host suffixes
are rejected by production settings.

If you prefer manual service creation, choose **New → Web Service**, select the
same repository and branch, set language **Python 3**, root **backend**, plan
**Free**, and enter the table's commands and variables. Generate the secret key
using the Python command above. Set the health path and auto-deploy behavior
under the service's settings. Do not run migrations for this stateless app.

## 2. Create the Vercel frontend

1. Open [Vercel](https://vercel.com/new), sign in, and import the same repository.
2. Set project name **truckmena-frontend**, framework preset **Vite**, and **Root Directory**
   to **frontend**. The config file is `frontend/vercel.json`, relative to that root.
   If the importer initially selects **Services** from `render.yaml`, select the
   **frontend** root and **Vite** preset before deploying.
3. Confirm install command **npm ci**, build command **npm run build**, and output
   directory **dist**. Use Node **22.x**; `frontend/package.json` constrains it to
   the tested major version.
4. Add `VITE_API_BASE_URL` with the **API origin** copied from Render. Select
   **Production**. Example format: `https://your-service.onrender.com`; substitute
   your actual URL. Do not append `/api`, quotes, whitespace, or a final slash.
5. Deploy. Copy the stable production domain shown in the project dashboard,
   such as `https://your-project.vercel.app`. This is the **frontend origin**.
6. Open the frontend. Its assets and 404 view should load. Planning works after
   the CORS update below.

The frontend build fails if its API origin is missing, malformed, contains
credentials or a path, or uses non-local HTTP. Vite embeds this public value in
the build. Changing it requires a new deployment: open **Deployments**, select
the production deployment's menu, then **Redeploy**. An environment edit alone
does not update already built JavaScript.

The SPA rewrite serves `index.html` for deep links so the application can display
its own 404 screen. Django runs separately; Vercel has no API proxy or ORS key.

For a custom frontend domain, add it under the Vercel project's domain settings
and apply the DNS records shown there. The current primary domain is
`wayline.demeri.dev`. Use its exact HTTPS origin in the backend CORS settings;
changing the frontend domain does not change `VITE_API_BASE_URL`.

## 3. Connect the two origins

1. In **Render → truckmena-api → Environment**, replace the temporary
   `CORS_ALLOWED_ORIGINS` value with the exact **frontend origin**.
2. Save with a rebuild/deploy and wait until the service is live.
3. Open the frontend, press **Use sample trip**, then **Plan trip**. Confirm that
   the route, summary, itinerary, and daily sheets load. The sample has coordinates
   and can exercise OSRM fallback if ORS is unavailable.
4. Test an address suggestion too. A coordinate sample working alone does not
   prove that the ORS geocoding key is valid.

For multiple approved frontend domains, use a comma-separated list. Add each
custom production domain explicitly. Never allow every `*.vercel.app` domain.
Preview URLs change between deployments: enable `VITE_API_BASE_URL` for Preview
only when you also approve that preview's exact origin in Render. An unapproved
preview intentionally cannot call the API.

CORS controls browser access; these anonymous endpoints remain publicly
accessible outside browsers. Their per-process throttles are appropriate for a
small demo. Production scaling requires a shared limiter/cache and
provider-capacity planning.

## 4. Verify the live deployment

Perform these checks using the actual production domains:

- Backend `/api/health`: HTTP 200 with the JSON above and no provider request.
- Sample trip: full route and positioned pickup, fuel, breaks, rests, and delivery;
  select a map marker and a timeline event to verify synchronization.
- Provider: a working ORS key should produce `route.provider = "ors"` and
  `route.profile = "driving-hgv"`. If it says `osrm`, check the visible truck
  restrictions warning and investigate the server-side ORS configuration.
- Logs: inspect every day and its 24.00-hour totals. The **PNG** and **PDF** buttons
  export the displayed day. **Download all (N)** creates the whole-trip PDF;
  confirm that it has one complete page per log day.
- Refresh a URL such as `/missing-page`; confirm the application's 404 screen.
- Test the production URL in a private browser window to detect any deployment
  protection/login gate that would prevent a hiring reviewer from opening it.
- At 390px and desktop width, check both themes, keyboard navigation, and focus
  after planning. Check the browser console for CORS/mixed-content errors.
- Inspect browser network requests: they should target Django and map tiles,
  never include `ORS_API_KEY`, and never call ORS directly.

Keep public frontend/API URLs and the Loom recording with the submission.
Date verification results and identify any checks that were not performed.

## Verification record

### October 4, 2026 — release verification

These checks used `https://truckmena-frontend.vercel.app` and the Render API,
following the deployment-secret fix. The later custom frontend domain is not a
claim that the full browser/export review was repeated there.

| Check                            | Result / evidence                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend health and CORS          | HTTP 200; expected service JSON; `Access-Control-Allow-Origin` exactly matches the production frontend                                                            |
| Real ORS truck route             | Sample API request returned `provider: ors`, `profile: driving-hgv`, two route legs, and no fallback warnings                                                     |
| Sample schedule                  | 2,398.817 provider miles; 43.65 driving hours; five log days for the checked-in October 3, 08:00 departure; full-day coverage and contiguous events verified      |
| Address autocomplete             | Submitted Chicago search returned five suggestions                                                                                                                |
| Private-window access            | Reported working in a private browser window                                                                                                                      |
| Browser PDF exports              | Supplied single-day PDF and complete October 4–9 six-page PDF were visually inspected with no visible clipping; daily totals are 24.00 hours                      |
| Browser PNG export               | The app reported a completed download; the supplied, opened October 4 PNG was visually inspected, including its header, graph, remarks, totals, recap, and footer |
| Restart display                  | Full-trip PDF shows a 34-hour restart across October 7–8 and the recap reset on completion                                                                        |
| Deployed sample planner          | Browser completed the ORS sample plan, showing 2,398.8 miles, six daily logs, and 11 positioned stops                                                             |
| Desktop/mobile themes            | Both themes inspected at 1440×1000 and 390×844; page widths matched their scroll widths, with no horizontal page overflow                                         |
| Keyboard and map synchronization | Arrow keys switched results tabs with visible focus; Enter selected the Dallas pickup event, opened its map popup, and marked it selected                         |
| Mobile log controls              | Day selection, fit/enlarge controls, and keyboard scrolling of the enlarged sheet worked                                                                          |
| Refreshed 404                    | `/missing-page` displayed the application 404 after refresh; Back to trip planner returned to the working planner                                                 |
| Browser requests and console     | Observed four health requests followed by one planning POST to the Render API; no direct ORS request or console error/warning appeared                            |
| Environment-file hygiene         | Recorded tracked-file check listed only `backend/.env.example` and `frontend/.env.example`; both real `.env` paths matched ignore rules                           |
| Main branch CI                   | Repository hygiene, frontend quality/tests/build, and backend quality/tests passed for documentation merge `26782ef`                                              |
| Controlled idle-start check      | Not performed; no controlled 20-minute idle-start result is claimed                                                                                               |

The API sample and browser export use different departure times, so five versus
six calendar-day sheets is expected. This record preserves the results of those
specific checks; it does not replace verification after future deployments.

The browser checks above passed on a cellular connection. Local simulated
wake-up and cancellation checks passed earlier, and the deployed browser
completed planning after health retries. Those observations do not establish a
controlled 20-minute idle-start result. That check was not performed and is not
reported as passed.

### Local verification recorded with the release

The release README also recorded **112 frontend tests passing** and **205 backend
tests passing**, with one Gunicorn application-load check skipped on Windows and
run in Linux CI. These are historical results, not current test-count targets.

Production settings were checked in fresh interpreters for health responses,
static-file serving, HTTPS redirects/headers, explicit hosts, exact CORS origins,
and startup rejection for invalid configuration. Cold-start tests covered retry
deadlines, cancellation, and a single planning POST. A local production preview
exercised simulated wake-up followed by a real Django sample request. Frontend
builds correctly rejected missing API origins and origins containing `/api`.

### Published release

The annotated `v1.0.0` tag was published on **October 4, 2026**, pointing to
`33894ced41d85d43199b3b200c13383e65dda7e8`. It identifies the submitted release;
later documentation and tooling changes do not alter that snapshot. Preserve
the existing `v0.1.0`, `v0.2.0`, and `v1.0.0` tags.

Use the [submission outline](SUBMISSION.md) for a walkthrough recording.

## Cold starts and keeping the demo ready

Render's Free web services currently sleep after 15 minutes without inbound
traffic and usually take about one minute to restart. See
[Render's free-service limitations](https://render.com/docs/free).
The hosted planner first checks `/api/health`, waiting at most 90 seconds.
Connection failures, server errors, and incomplete health responses are retried
with a 2-second gap and a 10-second per-attempt ceiling; other HTTP errors stop
the wait. The UI explains that the server may be waking up after
12 seconds. Once ready, exactly one planning POST has its separate 65-second
timeout; it is never automatically replayed. Unmounting cancels active requests
and retry delays. Local Vite proxy development skips the hosted health gate.

Before a demo or recording, open the actual backend `/api/health` once, wait for
its JSON, then plan the sample. No background keep-warm polling is installed.
For a service that must stay available, choose an always-on paid instance after
reviewing the hosting cost. This free configuration is for demo use.
The in-memory cache is lost on sleep/restart/deploy, so the first route afterward
may also need fresh provider requests.

## HTTPS and process choices

Production settings require debug off and explicit hostnames, allow only HTTPS
CORS origins, redirect HTTP, and add security headers. They trust the forwarded
protocol header only when `DJANGO_TRUST_PROXY=true`. Enable this only behind a
proxy that overwrites that header; Render provides the managed HTTPS ingress.
Other hosts must meet the same requirement before using these settings.

HSTS lasts one hour and deliberately excludes subdomains and browser preload.
Production settings silence only `security.W005` and `security.W021` for those
choices, plus `security.W003` because these anonymous JSON endpoints have no
cookie/session authentication. The build's `check --deploy --fail-level WARNING`
rejects other deployment warnings.
Add CSRF middleware before introducing cookie-authenticated endpoints.

Gunicorn uses one process, four threads, a 120-second worker timeout, and Render's
`PORT`. This preserves per-process caches and public-provider pacing while
allowing health checks alongside slow provider I/O. HTTP access logs are disabled
to avoid logging address-search query strings. WhiteNoise handles collected
backend static assets; frontend assets are served by Vercel. No Gunicorn command
runs on Windows; local development uses Django's `runserver`.

## Troubleshooting

| Symptom                               | Check                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Build fails with `security.W009`      | Replace `DJANGO_SECRET_KEY` with the Python-generated value above, then **Save, rebuild, and deploy**  |
| Frontend build says API origin absent | Set Production `VITE_API_BASE_URL`, then redeploy; confirm root directory is `frontend`                |
| Health returns 400                    | Check the actual hostname and `RENDER_EXTERNAL_HOSTNAME` / custom `DJANGO_ALLOWED_HOSTS`               |
| Redirect loop                         | Verify the trusted proxy's forwarded HTTPS header and `DJANGO_TRUST_PROXY`                             |
| CORS error                            | Compare the browser's exact origin with Render's comma-separated `CORS_ALLOWED_ORIGINS`                |
| Sample works but autocomplete fails   | Verify the server-only ORS key, geocoding access/quota, and provider availability                      |
| Route warning shows OSRM              | ORS routing is unavailable; OSRM uses car routes and cannot check truck restrictions                   |
| Server remains unavailable            | Check Render logs, suspension/usage limits, and `/api/health`; the UI stops waiting after its deadline |
| Static 404 is hosted by Vercel        | Confirm `frontend/vercel.json` is in the selected root and its SPA rewrite is applied                  |

Official references:
[Render Blueprint fields](https://render.com/docs/blueprint-spec),
[Render Python versions](https://render.com/docs/python-version),
[Render web-service ingress](https://render.com/tutorials/web-service-vs-static-site/web-services),
[Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite),
[Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/),
[Django secret-key check](https://docs.djangoproject.com/en/5.2/ref/checks/#security).

See also [provider policies and scaling limits](PROVIDERS.md), [log/export
assumptions](LOG_SHEETS.md), and [contributing checks](CONTRIBUTING.md).

[Back to README](../README.md)

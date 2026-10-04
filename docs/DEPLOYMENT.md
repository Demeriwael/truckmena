# Deploy Wayline with Render and Vercel

Deploy after the `chore/deploy` pull request is merged and `main` CI is green.
Use the repository's `main` branch for both services. These steps create an
assessment/demo deployment on Render's Free service and Vercel; no database,
disk, migrations, or user accounts are needed by the application.

The service names below are project labels. Hosting platforms choose the actual
public domains. Copy the domain shown in each dashboard rather than assuming
that the name is available. Never paste a secret into a Git command or a chat.

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
From the repository root in Windows PowerShell, run this command unchanged; it
copies the new value to your clipboard without printing it:

```powershell
./.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(64))" | Set-Clipboard
```

In bash/zsh, this equivalent command prints the value for you to copy:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Both commands generate an 86-character value. Paste it only into Render's
`DJANGO_SECRET_KEY` value field. Render's built-in generator creates a base64
encoding of 32 random bytes, which is 44 characters long; Django's deployment
check requires at least 50 characters. The Blueprint therefore prompts for this
secret with `sync: false`. The build continues to reject inadequate secrets.
For an existing service, edit its environment variable manually and choose
**Save, rebuild, and deploy**; Blueprint updates do not prompt for `sync: false`
values or replace an existing secret.

The Blueprint supplies these settings:

| Setting                  | Value / purpose                                                        |
| ------------------------ | ---------------------------------------------------------------------- |
| Branch / root directory  | `main` / `backend`                                                     |
| Runtime                  | Python `3.12.14`, matching the locally verified runtime                |
| Build command            | `bash build.sh`                                                        |
| Start command            | `python -m gunicorn config.wsgi:application --config gunicorn.conf.py` |
| Health check             | `/api/health`                                                          |
| Auto deploy              | `checksPass`, deploy after the linked branch's CI succeeds             |
| `DJANGO_SETTINGS_MODULE` | `config.production_settings`                                           |
| `DJANGO_DEBUG`           | `false`                                                                |
| `DJANGO_SECRET_KEY`      | Owner-generated 86-character secret using the command above            |
| `DJANGO_TRUST_PROXY`     | `true`, for Render's managed HTTPS ingress                             |
| `NOMINATIM_ENABLED`      | `false`                                                                |
| `ORS_API_KEY`            | Owner-supplied server secret; never a frontend variable                |
| `CORS_ALLOWED_ORIGINS`   | Exact Vercel HTTPS origin(s), comma-separated, no paths or final slash |

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
2. Set project name **truckmena**, framework preset **Vite**, and **Root Directory**
   to **frontend**. The config file is `frontend/vercel.json`, relative to that root.
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
small assessment demo. Production scaling requires a shared limiter/cache and
provider-capacity planning.

## 4. Verify the live deployment

Perform these checks using the actual production domains:

- Backend `/api/health`: HTTP 200 with the JSON above and no provider request.
- Sample trip: full route and positioned pickup, fuel, breaks, rests, and delivery;
  select a map marker and a timeline event to verify synchronization.
- Provider: a working ORS key should produce `route.provider = "ors"` and
  `route.profile = "driving-hgv"`. If it says `osrm`, check the visible truck
  restrictions warning and investigate the server-side ORS configuration.
- Logs: inspect every day and its 24.00-hour totals. Download a PNG and the
  whole-trip PDF; confirm that the PDF has one complete page per log day.
- Refresh a URL such as `/missing-page`; confirm the application's 404 screen.
- Test the production URL in a private browser window to detect any deployment
  protection/login gate that would prevent a hiring reviewer from opening it.
- At 390px and desktop width, check both themes, keyboard navigation, and focus
  after planning. Check the browser console for CORS/mixed-content errors.
- Inspect browser network requests: they should target Django and map tiles,
  never include `ORS_API_KEY`, and never call ORS directly.

Keep public frontend/API URLs and the Loom recording with the submission.
Do not describe the app as live or tag the final release until these checks pass.

## Cold starts and keeping the demo ready

Render's Free web services currently sleep after 15 minutes without inbound
traffic and usually take about one minute to restart. See
[Render's free-service limitations](https://render.com/docs/free).
The hosted planner first checks `/api/health`, waiting at most 90 seconds. Failed
or incomplete health responses are retried with a 2-second gap and a 10-second
per-attempt ceiling. The UI explains that the server may be waking up after
12 seconds. Once ready, exactly one planning POST has its separate 65-second
timeout; it is never automatically replayed. Unmounting cancels active requests
and retry delays. Local Vite proxy development skips the hosted health gate.

Before a demo or recording, open the actual backend `/api/health` once, wait for
its JSON, then plan the sample. No background keep-warm polling is installed.
For a service that must stay available, choose an always-on paid instance after
reviewing the hosting cost. This free configuration is for assessment use.
The in-memory cache is lost on sleep/restart/deploy, so the first route afterward
may also need fresh provider requests.

## HTTPS and process choices

Production settings require debug off and explicit hostnames, allow only HTTPS
CORS origins, redirect HTTP, and add security headers. They trust the forwarded
protocol header only when `DJANGO_TRUST_PROXY=true`. Enable this only behind a
proxy that overwrites that header; Render provides the managed HTTPS ingress.
Other hosts must meet the same requirement before using these settings.

HSTS lasts one hour and deliberately excludes subdomains and browser preload.
`check --deploy` silences only `security.W005` and `security.W021` for those
choices, plus `security.W003` because these anonymous JSON endpoints have no
cookie/session authentication. All other deployment warnings fail the build.
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

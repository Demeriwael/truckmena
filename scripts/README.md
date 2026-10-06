# Development commands

Run these commands from the repository root with Python 3.12 and Node 22.13–22.x.
On Windows PowerShell, use `npm.cmd` in place of `npm` if script execution is restricted.
Stop existing development servers before setup; Windows can lock loaded native
dependencies while `npm ci` replaces them.

| Command                | Purpose                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run setup`        | Create `.venv` if absent, install pinned root/backend/frontend dependencies, and copy missing `.env` examples. Existing environments and `.env` files are preserved. |
| `npm run dev`          | Start Django at `http://127.0.0.1:8000` and Vite at `http://localhost:5173`. Ctrl+C stops both servers, including the Django reloader.                               |
| `npm test`             | Run tooling, backend, and frontend tests once. No external provider calls are required.                                                                              |
| `npm run check`        | Run tests, Python dependency checks, Django checks, lint, formatting, TypeScript checks, and a frontend verification build.                                          |
| `npm run build`        | Build the frontend using your configured public `VITE_API_BASE_URL`. The existing Vite validation applies.                                                           |
| `npm run build:local`  | Build the frontend with `http://127.0.0.1:8000` as its API origin for a local preview.                                                                               |
| `npm run test:tooling` | Test setup safety, command failure handling, and development process cleanup.                                                                                        |
| `npm run format`       | Apply repository formatting.                                                                                                                                         |

`check` explicitly uses `https://api.example.invalid` for its build and makes no API
requests. It does not change `.env` files or configure a production deployment.
For an actual deployment, set the frontend's public API origin in the hosting
environment or `frontend/.env`, then use `build`.
The frontend preview server uses port 4173. If previewing a local build, add
`http://localhost:4173` to the backend's `CORS_ALLOWED_ORIGINS` configuration;
the normal development server uses port 5173.

Setup does not install Git hooks or run Git commands. Existing commit hooks and CI
continue to scan for secrets independently of `check`.
Root test commands and frontend CI run Vitest files sequentially to limit resource
usage on development machines. Test assertions and timeouts are unchanged.
Formatting excludes dependency, cache, and build directories before traversing
them, so an inaccessible ignored cache does not prevent a source formatting check.

Python 3.12 must be discoverable as `python3.12`, `python3`, or `python`, or through
`py -3.12` on Windows. An existing `.venv` must also use Python 3.12. Setup reports
an incompatible environment instead of replacing it. Installations require network
access to the Python and npm package registries; all checks use installed packages.

Local sample planning can use the OSRM fallback without an ORS key. Address search
and ORS truck routing require `ORS_API_KEY` in the ignored `backend/.env` file.
Keep `frontend/.env` blank for local Vite proxy development. See the
[main README](../README.md) for provider limitations and hosting configuration.

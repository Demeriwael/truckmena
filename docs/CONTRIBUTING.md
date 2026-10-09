# Contributing to Wayline

Use Python 3.12 and Node 22.13–22.x. Start with the [README quick start](../README.md#quick-start); run the commands below from the repository root. Additional development and build commands are documented in [scripts](../scripts/README.md).

## Quality checks

Bash — macOS / Linux:

```bash
npm run check
```

Windows PowerShell:

```powershell
npm.cmd run check
```

`check` runs tooling, backend, and frontend tests, Python dependency consistency, Django test configuration checks, Ruff, Black, Prettier, ESLint, TypeScript checks, and a frontend verification build. The build uses `https://api.example.invalid` and makes no API requests. Automated tests use mocked providers and need no API key.

Use `npm test` for tests alone, or `npm.cmd test` in PowerShell. Frontend test files run sequentially through the root tooling to limit resource usage. The Gunicorn application-load test runs on Linux and is skipped on Windows.

`npm run format` applies repository formatting; use `npm.cmd run format` in PowerShell. Python formatting uses Black. The root format command prunes dependency, cache, and build directories before traversal so inaccessible ignored caches do not block a source check.

## Commit hooks

Setup does not install hooks. Installation is opt-in and writes hook files into the checkout. After setup, use these commands to validate the configuration, install the hook, and check files:

Bash — macOS / Linux:

```bash
.venv/bin/python -m pre_commit validate-config
.venv/bin/python -m pre_commit install
.venv/bin/python -m pre_commit run --all-files
```

Windows PowerShell:

```powershell
./.venv/Scripts/python.exe -m pre_commit validate-config
./.venv/Scripts/python.exe -m pre_commit install
./.venv/Scripts/python.exe -m pre_commit run --all-files
```

The first hook run downloads pinned hook environments and may need network access. Hooks check whitespace, final newlines, added file size, merge markers, private keys, YAML/JSON/TOML syntax, secrets, Ruff, Black, Prettier, and frontend ESLint. Supported source types determine which hooks run. See the [hook configuration](../.pre-commit-config.yaml) and [pre-commit documentation](https://pre-commit.com/).

The file-size hook uses a **500 KiB maximum**. Keep real README screenshots under that limit. Do not commit dependency folders, generated builds, or review/download artifacts.

Some hygiene hooks fix files. Review their changes, repeat the checks, and include the resulting file versions in the commit.

## Secret scanning

The pinned Gitleaks hook scans **staged changes** during commits. Running hooks with `--all-files` does not turn that staged scan into a scan of every unstaged file or all history. CI separately invokes the history-scanning hook with a full-history checkout.

Root `check` verifies application quality; it does not replace either secret scan. Hook installation and hook runs are separate from the setup and quality scripts.

- Real `.env` files are ignored; only empty `.env.example` files belong in source control. Keep ORS and Django secrets on the backend.
- Review the exact files and full staged diff before committing. Check ignore rules for any newly introduced local configuration or generated output.
- If a secret enters history, rotate it. Deleting the current copy does not undo exposure.

Configuration references: [ignore rules](../.gitignore), [backend environment example](../backend/.env.example), [frontend environment example](../frontend/.env.example), and [Gitleaks v8.24.2](https://github.com/gitleaks/gitleaks/tree/v8.24.2).

## CI and review scope

[CI](../.github/workflows/ci.yml) runs on pushes and pull requests with three jobs:

| Job                                | Checks                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Repository hygiene                 | Root tooling tests, file hygiene, formatting, and history secret scanning.   |
| Backend quality and tests          | Ruff, Black, Django configuration, and backend tests.                        |
| Frontend quality, tests, and build | ESLint, TypeScript, Vitest, and a build with a non-live verification origin. |

Use short-lived branches and Conventional Commits, such as `docs(logs): clarify planning recap assumptions`. Keep changes small enough to review and describe the problem, resulting behavior, and validation. Preserve the published `v1.0.0` tag when preparing later changes.

HOS and API behavior must agree with the documented contract. Cover a confirmed behavior fix with a meaningful boundary or regression check; do not change the [HOS rules](HOS_RULES.md) or public API incidentally during documentation work.

For UI changes, follow the [accessibility review procedure](ACCESSIBILITY.md#manual-review-procedure). For log/export changes, check the [log invariants and browser review](LOG_SHEETS.md#verification). Provider-policy details belong in [Providers](PROVIDERS.md); hosting configuration and dated live verification belong in [Deployment](DEPLOYMENT.md).

[Back to README](../README.md)

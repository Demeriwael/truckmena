import { spawn, spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const localOrigin = "http://127.0.0.1:8000";

export function supportsNode(version) {
  const [major, minor] = version.split(".").map(Number);
  return major === 22 && minor >= 13;
}

export async function copyEnvironmentExamples(directory) {
  for (const app of ["backend", "frontend"]) {
    try {
      await copyFile(
        path.join(directory, app, ".env.example"),
        path.join(directory, app, ".env"),
        constants.COPYFILE_EXCL,
      );
      console.log(`Created ${app}/.env from its empty example.`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.log(`Kept existing ${app}/.env.`);
    }
  }
}

function start(step, options = {}) {
  console.log(`\n${step.label}`);
  const child = spawn(step.command, step.args ?? [], {
    cwd: step.cwd ?? options.cwd ?? root,
    env: { ...process.env, ...step.env },
    stdio: options.stdio ?? "inherit",
    // A separate process group lets POSIX shutdown include reloader children.
    detached: options.service && !windows,
    windowsHide: true,
  });
  const finished = new Promise((resolve) => {
    child.once("error", () => {
      console.error(`Could not start ${step.label}. Check setup and your PATH.`);
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal === "SIGINT" ? 130 : 143));
    });
  });
  return { child, finished };
}

export async function runSteps(steps, options) {
  for (const step of steps) {
    const code = await start(step, options).finished;
    if (code !== 0) return code;
  }
  return 0;
}

async function stopService(service) {
  const { child, finished } = service;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const terminate = (signal) => {
    try {
      if (windows) {
        // Only terminate the process tree started by this command.
        const taskkill = path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "taskkill.exe",
        );
        const result = spawnSync(taskkill, ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
        if (result.error || result.status !== 0) {
          console.error(
            `Windows denied process-tree shutdown for PID ${child.pid}. Stopping its main process; check for remaining child processes.`,
          );
          child.kill();
        }
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  terminate("SIGTERM");
  const timer = setTimeout(() => terminate("SIGKILL"), 3000);
  timer.unref();
  await finished;
  clearTimeout(timer);
}

export async function runServices(steps, options = {}) {
  let cancel;
  const cancelled = new Promise((resolve) => {
    cancel = () => resolve(130);
  });
  const terminate = () => cancel();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", terminate);
  options.signal?.addEventListener("abort", cancel, { once: true });
  const services = steps.map((step) => start(step, { ...options, service: true }));
  if (options.signal?.aborted) cancel();
  try {
    // An unexpected service exit also stops its companion server.
    return await Promise.race([
      cancelled,
      ...services.map(({ finished }) => finished.then((code) => code || 1)),
    ]);
  } finally {
    await Promise.all(services.map(stopService));
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", terminate);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function pythonVersion(command, args = []) {
  const probe = spawnSync(
    command,
    [
      ...args,
      "-c",
      "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return probe.status === 0 && probe.stdout.trim() === "3.12";
}

function environmentPython() {
  const executable = path.join(
    root,
    ".venv",
    ...(windows ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
  if (!existsSync(executable) || !pythonVersion(executable)) {
    throw new Error(
      "A Python 3.12 virtual environment is required. Run npm run setup.",
    );
  }
  return executable;
}

async function setup(npm) {
  if (!existsSync(path.join(root, ".venv"))) {
    const candidates = [
      ...(windows ? [["py", ["-3.12"]]] : []),
      ["python3.12", []],
      ["python3", []],
      ["python", []],
    ];
    const python = candidates.find(([command, args]) => pythonVersion(command, args));
    if (!python)
      throw new Error("Install Python 3.12 and put it on PATH, then run setup again.");
    const code = await runSteps([
      {
        label: "Create Python 3.12 environment",
        command: python[0],
        args: [...python[1], "-m", "venv", ".venv"],
      },
    ]);
    if (code) return code;
  }
  const python = environmentPython();
  const code = await runSteps([
    { label: "Install repository tools", command: process.execPath, args: [npm, "ci"] },
    {
      label: "Install backend and Python tools",
      command: python,
      args: ["-m", "pip", "install", "-r", "backend/requirements-dev.txt"],
    },
    {
      label: "Install frontend dependencies",
      command: process.execPath,
      args: [npm, "ci", "--prefix", "frontend"],
    },
  ]);
  if (code) return code;
  await copyEnvironmentExamples(root);
  console.log("\nSetup complete. Run npm run dev, then open http://localhost:5173.");
  return 0;
}

async function main() {
  if (!supportsNode(process.versions.node)) {
    throw new Error("Use Node 22.13 or later within Node 22 (22.x).");
  }
  const [task, ...extra] = process.argv.slice(2);
  const npm = process.env.npm_execpath;
  if (!npm || extra.length)
    throw new Error("Use the documented root npm scripts without extra arguments.");
  const npmStep = (label, args, env) => ({
    label,
    command: process.execPath,
    args: [npm, ...args],
    env,
  });
  const frontend = (name, env) =>
    npmStep(
      `Frontend ${name}`,
      [
        "run",
        name,
        "--prefix",
        "frontend",
        ...(name === "test" ? ["--", "--run", "--maxWorkers=1"] : []),
      ],
      env,
    );
  if (task === "setup") return setup(npm);
  if (task === "build" || task === "build:local") {
    const env = task === "build:local" ? { VITE_API_BASE_URL: localOrigin } : undefined;
    if (env) console.log(`Local preview build: API origin ${localOrigin}.`);
    return runSteps([frontend("build", env)]);
  }
  const python = environmentPython();
  const py = (label, args) => ({
    label,
    command: python,
    args: ["-X", "utf8", ...args],
  });
  if (task === "dev") {
    console.log(
      "Wayline: http://localhost:5173 | API: http://127.0.0.1:8000\nPress Ctrl+C to stop both servers.",
    );
    return runServices([
      py("Django development server", [
        "backend/manage.py",
        "runserver",
        "127.0.0.1:8000",
      ]),
      {
        label: "Vite development server",
        command: process.execPath,
        args: [
          path.join(root, "frontend/node_modules/vite/bin/vite.js"),
          "--host",
          "localhost",
          "--port",
          "5173",
          "--strictPort",
        ],
        cwd: path.join(root, "frontend"),
      },
    ]);
  }
  const tests = [
    npmStep("Development tooling tests", ["run", "test:tooling"]),
    py("Backend tests", ["-m", "pytest"]),
    frontend("test"),
  ];
  if (task === "test") return runSteps(tests);
  if (task === "check") {
    console.log(
      "Build verification uses https://api.example.invalid; it makes no API requests.",
    );
    return runSteps([
      ...tests,
      py("Python dependency consistency", ["-m", "pip", "check"]),
      py("Django configuration", [
        "backend/manage.py",
        "check",
        "--settings=config.test_settings",
      ]),
      py("Python lint", ["-m", "ruff", "check", "backend"]),
      py("Python formatting", ["-m", "black", "--check", "backend"]),
      npmStep("Repository formatting", ["run", "format:check"]),
      frontend("lint"),
      frontend("typecheck"),
      frontend("build", { VITE_API_BASE_URL: "https://api.example.invalid" }),
    ]);
  }
  throw new Error(
    `Unknown task: ${task}. Use setup, dev, test, check, build, or build:local.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}

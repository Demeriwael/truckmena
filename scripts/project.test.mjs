import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  copyEnvironmentExamples,
  runServices,
  runSteps,
  supportsNode,
} from "./project.mjs";

async function temporaryDirectory(t) {
  const prefix = path.join(os.tmpdir(), "wayline-tooling-");
  const directory = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

const step = (label, code, extra = {}) => ({
  label,
  command: process.execPath,
  args: ["-e", code],
  ...extra,
});

async function waitForFile(file) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(50);
  }
  throw new Error("Test child did not start within five seconds.");
}

function assertStopped(pid) {
  assert.throws(() => process.kill(Number(pid), 0), { code: "ESRCH" });
}

test("runtime requirement accepts supported Node 22 releases only", () => {
  assert.equal(supportsNode("22.13.0"), true);
  assert.equal(supportsNode("22.22.2"), true);
  for (const version of ["20.19.0", "22.12.0", "23.0.0", "25.2.0"]) {
    assert.equal(supportsNode(version), false);
  }
});

test("setup creates missing examples and preserves existing environment files on repeated runs", async (t) => {
  const directory = await temporaryDirectory(t);
  for (const app of ["backend", "frontend"]) {
    await mkdir(path.join(directory, app));
    await writeFile(path.join(directory, app, ".env.example"), "EMPTY_VALUE=\n");
  }
  const backend = path.join(directory, "backend", ".env");
  const frontend = path.join(directory, "frontend", ".env");
  await writeFile(backend, "Existing local configuration\n");
  await copyEnvironmentExamples(directory);
  assert.equal(await readFile(backend, "utf8"), "Existing local configuration\n");
  assert.equal(await readFile(frontend, "utf8"), "EMPTY_VALUE=\n");
  await writeFile(frontend, "Updated local configuration\n");
  await copyEnvironmentExamples(directory);
  assert.equal(await readFile(frontend, "utf8"), "Updated local configuration\n");
});

test("checks run in order and stop at the first failure", async (t) => {
  const directory = await temporaryDirectory(t);
  const code = await runSteps(
    [
      step("First command", "require('node:fs').writeFileSync('order.txt', 'first')"),
      step(
        "Failing command",
        "require('node:fs').appendFileSync('order.txt', ',second'); process.exit(17)",
      ),
      step("Must not run", "require('node:fs').appendFileSync('order.txt', ',third')"),
    ],
    { cwd: directory, stdio: "ignore" },
  );
  assert.equal(code, 17);
  assert.equal(
    await readFile(path.join(directory, "order.txt"), "utf8"),
    "first,second",
  );
});

test("each command uses its own working directory and build environment", async (t) => {
  const directory = await temporaryDirectory(t);
  const frontend = path.join(directory, "frontend");
  await mkdir(frontend);
  const code = await runSteps(
    [
      step(
        "Public build configuration",
        "require('node:fs').writeFileSync('origin.txt', process.env.VITE_API_BASE_URL)",
        {
          cwd: frontend,
          env: { VITE_API_BASE_URL: "http://127.0.0.1:8000" },
        },
      ),
    ],
    { cwd: directory, stdio: "ignore" },
  );
  assert.equal(code, 0);
  assert.equal(
    await readFile(path.join(frontend, "origin.txt"), "utf8"),
    "http://127.0.0.1:8000",
  );
});

test("a missing command fails without running subsequent checks", async (t) => {
  const directory = await temporaryDirectory(t);
  const code = await runSteps(
    [
      {
        label: "Missing executable",
        command: path.join(directory, "absent-executable"),
      },
      step("Must not run", "require('node:fs').writeFileSync('unexpected.txt', '')"),
    ],
    { cwd: directory, stdio: "ignore" },
  );
  assert.equal(code, 1);
  await assert.rejects(readFile(path.join(directory, "unexpected.txt")), {
    code: "ENOENT",
  });
});

test("cancelling development shuts down both server processes", async (t) => {
  const directory = await temporaryDirectory(t);
  const controller = new AbortController();
  const running = runServices(
    ["backend", "frontend"].map((name) =>
      step(
        name,
        `require('node:fs').writeFileSync('${name}.pid', String(process.pid)); setInterval(() => {}, 1000)`,
      ),
    ),
    { cwd: directory, stdio: "ignore", signal: controller.signal },
  );
  const pids = await Promise.all(
    ["backend", "frontend"].map((name) =>
      waitForFile(path.join(directory, `${name}.pid`)),
    ),
  );
  controller.abort();
  assert.equal(await running, 130);
  pids.forEach(assertStopped);
});

test("a failed server shuts down its companion and returns its failure code", async (t) => {
  const directory = await temporaryDirectory(t);
  const code = await runServices(
    [
      step(
        "Companion",
        "require('node:fs').writeFileSync('companion.pid', String(process.pid)); setInterval(() => {}, 1000)",
      ),
      step(
        "Failed server",
        "const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync('companion.pid')) { clearInterval(timer); process.exit(23); } }, 20)",
      ),
    ],
    { cwd: directory, stdio: "ignore" },
  );
  assert.equal(code, 23);
  assertStopped(await readFile(path.join(directory, "companion.pid"), "utf8"));
});

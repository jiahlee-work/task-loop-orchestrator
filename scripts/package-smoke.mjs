#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "task-loop-package-smoke-"));
  const packDir = join(tempRoot, "pack");
  const installDir = join(tempRoot, "install");
  const projectDir = join(tempRoot, "project");

  try {
    await mkdir(packDir);
    await mkdir(projectDir);
    await run("npm", ["pack", "--pack-destination", packDir], { cwd: repoRoot });
    const tarballPath = await findTarball(packDir);
    await run("npm", ["install", "--prefix", installDir, tarballPath], { cwd: repoRoot });

    const bin = process.platform === "win32"
      ? join(installDir, "node_modules", ".bin", "task-loop-orchestrator.cmd")
      : join(installDir, "node_modules", ".bin", "task-loop-orchestrator");

    const help = await run(bin, ["--help"], { cwd: projectDir });
    assertIncludes(help.stdout, "task-loop-orchestrator init", "help output should include init usage");
    assertIncludes(help.stdout, "task-loop-orchestrator doctor", "help output should include doctor usage");

    const preInitDoctor = await run(bin, ["doctor", "--json"], { cwd: projectDir });
    assertDoctorReport(parseJson(preInitDoctor), "warn", "doctor before init should warn");

    await run("git", ["init"], { cwd: projectDir });
    const firstInit = await run(bin, ["init", "--json"], { cwd: projectDir });
    assertInitReport(parseJson(firstInit), {
      configStatus: "created",
      gitignoreStatus: "created",
      label: "first init"
    });

    const secondInit = await run(bin, ["init", "--json"], { cwd: projectDir });
    assertInitReport(parseJson(secondInit), {
      configStatus: "skipped",
      gitignoreStatus: "skipped",
      label: "second init"
    });

    const postInitDoctor = await run(bin, ["doctor", "--json"], { cwd: projectDir });
    assertDoctorReport(parseJson(postInitDoctor), "pass", "doctor after init should pass");

    const loop = await run(bin, ["run", "Smoke task", "--max-iterations", "1", "--json"], { cwd: projectDir });
    const loopReport = parseJson(loop);
    assertRunReport(loopReport, "run", {
      status: "completed",
      completedCount: 1,
      runIdIncludes: "run_"
    });

    const resume = await run(bin, ["resume", loopReport.runId, "--max-iterations", "1", "--json"], { cwd: projectDir });
    assertRunReport(parseJson(resume), "resume", { runId: loopReport.runId });

    const statusJson = await run(bin, ["status", "--json"], { cwd: projectDir });
    assertRunReport(parseJson(statusJson), "status", { runId: loopReport.runId, completedCount: 1 });

    const explicitStatusJson = await run(bin, ["status", loopReport.runId, "--json"], { cwd: projectDir });
    assertRunReport(parseJson(explicitStatusJson), "status", { runId: loopReport.runId });

    const rawStatusJson = await run(bin, ["status", loopReport.runId, "--json", "--raw"], { cwd: projectDir });
    assertRawStatusReport(parseJson(rawStatusJson), loopReport.runId);

    const checkpoint = await run(bin, ["checkpoint", loopReport.runId, "--json"], { cwd: projectDir });
    assertCheckpointReport(parseJson(checkpoint), loopReport.runId);

    const prPlan = await run(bin, ["pr-plan", loopReport.runId, "--json"], { cwd: projectDir });
    assertPrPlanReport(parseJson(prPlan), loopReport.runId);

    const prExec = await run(bin, ["pr-exec", loopReport.runId, "--json"], { cwd: projectDir });
    assertPrExecReport(parseJson(prExec), loopReport.runId);

    const approval = await run(bin, ["approve-pr", loopReport.runId, "--approved-by", "package-smoke", "--json"], {
      cwd: projectDir
    });
    assertApprovalReport(parseJson(approval), loopReport.runId);

    const checks = await run(bin, ["checks", "HEAD", "--json"], { cwd: projectDir });
    assertChecksReport(parseJson(checks));

    const status = await run(bin, ["status"], { cwd: projectDir });
    assertIncludes(status.stdout, "Smoke task", "plain status output should show the smoke task");

    console.log("Package smoke passed:");
    console.log(`- tarball: ${tarballPath}`);
    console.log("- help output includes init usage");
    console.log("- doctor reports pre-init warnings and post-init readiness");
    console.log("- init creates config and .gitignore");
    console.log("- init is idempotent on second run");
    console.log("- all JSON smoke commands include schema metadata");
    console.log("- run/resume/status JSON and plain status work through the installed binary");
    console.log("- checkpoint/pr-plan/pr-exec/approve-pr JSON fields work through the installed binary");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function findTarball(packDir) {
  const entries = await readdir(packDir);
  const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));

  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${packDir}, found ${tarballs.length}.`);
  }

  return join(packDir, tarballs[0]);
}

async function run(command, args, options) {
  const commandText = formatCommand(command, args);
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 10
    });
    return {
      ...result,
      commandText,
      cwd: options.cwd
    };
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const exitCode = typeof error?.code === "number" || typeof error?.code === "string" ? String(error.code) : "unknown";
    throw new Error(
      [
        `Command failed: ${commandText}`,
        `cwd: ${options.cwd}`,
        `exit code: ${exitCode}`,
        formatOutput("stdout", stdout),
        formatOutput("stderr", stderr)
      ].filter(Boolean).join("\n")
    );
  }
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Failed to parse JSON output from: ${result.commandText}`,
        `cwd: ${result.cwd}`,
        `parse error: ${detail}`,
        formatOutput("stdout", result.stdout),
        formatOutput("stderr", result.stderr)
      ].filter(Boolean).join("\n")
    );
  }
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function formatOutput(label, value) {
  const trimmed = value.trim();
  return trimmed ? `${label}:\n${truncate(trimmed)}` : "";
}

function truncate(value, maxLength = 2000) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n... truncated ${value.length - maxLength} chars`;
}

function assertDoctorReport(report, expectedStatus, message) {
  assertEnvelope(report, "doctor");
  assertEqual(report.status, expectedStatus, message);
}

function assertInitReport(report, expected) {
  assertEnvelope(report, "init");
  assertEqual(report.files.config.status, expected.configStatus, `${expected.label} should set config status`);
  assertEqual(report.files.gitignore.status, expected.gitignoreStatus, `${expected.label} should set gitignore status`);
}

function assertRunReport(report, command, expected) {
  assertEnvelope(report, command);

  if (expected.runId) {
    assertEqual(report.runId, expected.runId, `${command} JSON should use the expected run id`);
  }

  if (expected.runIdIncludes) {
    assertIncludes(report.runId, expected.runIdIncludes, `${command} JSON should include a run id`);
  }

  if (expected.status) {
    assertEqual(report.status, expected.status, `${command} JSON should include expected status`);
  }

  if (typeof expected.completedCount === "number") {
    assertEqual(report.counts.completed, expected.completedCount, `${command} JSON should include subtask counts`);
  }

  assertIncludes(report.savedPath, report.runId, `${command} JSON should include saved path`);
}

function assertRawStatusReport(report, runId) {
  assertEnvelope(report, "status");
  assertEqual(report.id, runId, "raw status JSON should preserve the LoopRun shape");
}

function assertCheckpointReport(report, runId) {
  assertEnvelope(report, "checkpoint");
  assertString(report.id, "checkpoint JSON should include id");
  assertEqual(report.runId, runId, "checkpoint JSON should preserve run id");
  assertString(report.status, "checkpoint JSON should include status");
  assertObject(report.ciCheck, "checkpoint JSON should include ciCheck");
  assertArray(report.maintainerActionCandidates, "checkpoint JSON should include maintainerActionCandidates");
}

function assertPrPlanReport(report, runId) {
  assertEnvelope(report, "pr-plan");
  assertString(report.id, "pr-plan JSON should include id");
  assertEqual(report.runId, runId, "pr-plan JSON should preserve run id");
  assertArray(report.commandCandidates, "pr-plan JSON should include commandCandidates");
}

function assertPrExecReport(report, runId) {
  assertEnvelope(report, "pr-exec");
  assertString(report.id, "pr-exec JSON should include id");
  assertString(report.planId, "pr-exec JSON should include planId");
  assertEqual(report.runId, runId, "pr-exec JSON should preserve run id");
  assertString(report.status, "pr-exec JSON should include status");
  assertArray(report.executedCommands, "pr-exec JSON should include executedCommands");
}

function assertApprovalReport(report, runId) {
  assertEnvelope(report, "approve-pr");
  assertString(report.id, "approve-pr JSON should include id");
  assertEqual(report.scope, "pr_execution", "approve-pr JSON should include approval scope");
  assertString(report.planId, "approve-pr JSON should include planId");
  assertEqual(report.runId, runId, "approve-pr JSON should preserve run id");
  assertEqual(report.status, "approved", "approve-pr JSON should persist approved status");
}

function assertChecksReport(report) {
  assertEnvelope(report, "checks");
  assertEqual(report.source, "github", "checks JSON should preserve provider source");
}

function assertIncludes(value, expected, message) {
  if (!value.includes(expected)) {
    throw new Error(`${message}. Expected to find ${JSON.stringify(expected)} in:\n${value}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function assertString(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${message}. Expected a non-empty string, got ${JSON.stringify(value)}.`);
  }
}

function assertArray(value, message) {
  if (!Array.isArray(value)) {
    throw new Error(`${message}. Expected an array, got ${JSON.stringify(value)}.`);
  }
}

function assertObject(value, message) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${message}. Expected an object, got ${JSON.stringify(value)}.`);
  }
}

function assertEnvelope(value, command) {
  assertEqual(value.schemaVersion, 1, `${command} JSON should include schemaVersion`);
  assertEqual(value.command, command, `${command} JSON should include command`);
  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) {
    throw new Error(`${command} JSON should include createdAt.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

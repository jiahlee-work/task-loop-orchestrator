#!/usr/bin/env node
// Verifies the packed tarball the same way a user would consume it: install into a
// temporary project, run the installed binary, and check the core JSON workflows.
// Failures are wrapped with step labels plus command/cwd/output excerpts; this
// script never creates branches, pushes, PRs, merges, releases, or publishes.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  const packageVersion = await readPackageVersion();
  let tarballPath = "";
  let bin = "";
  let loopReport;

  try {
    await runStep("pack and install", async () => {
      await mkdir(packDir);
      await mkdir(projectDir);
      await run("npm", ["pack", "--pack-destination", packDir], { cwd: repoRoot });
      tarballPath = await findTarball(packDir);
      await run("npm", ["install", "--prefix", installDir, tarballPath], { cwd: repoRoot });

      bin = process.platform === "win32"
        ? join(installDir, "node_modules", ".bin", "task-loop-orchestrator.cmd")
        : join(installDir, "node_modules", ".bin", "task-loop-orchestrator");
    });

    await runStep("help", async () => {
      const help = await run(bin, ["--help"], { cwd: projectDir });
      assertIncludes(help.stdout, "task-loop-orchestrator init", "help output should include init usage");
      assertIncludes(help.stdout, "task-loop-orchestrator doctor", "help output should include doctor usage");
      assertIncludes(help.stdout, "task-loop-orchestrator execution-audit", "help output should include execution-audit usage");
      assertIncludes(help.stdout, "task-loop-orchestrator --version", "help output should include version usage");
    });

    await runStep("version", async () => {
      const version = await run(bin, ["--version"], { cwd: projectDir });
      assertEqual(
        version.stdout.trim(),
        `task-loop-orchestrator ${packageVersion}`,
        "installed binary --version should match package.json"
      );

      const shortVersion = await run(bin, ["-v"], { cwd: projectDir });
      assertEqual(shortVersion.stdout.trim(), version.stdout.trim(), "installed binary -v should match --version");
    });

    await runStep("pre-init doctor", async () => {
      const preInitDoctor = await run(bin, ["doctor", "--json"], { cwd: projectDir });
      assertDoctorReport(parseJson(preInitDoctor), "warn", "doctor before init should warn");
    });

    await runStep("init idempotency", async () => {
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
    });

    await runStep("post-init doctor", async () => {
      const postInitDoctor = await run(bin, ["doctor", "--json"], { cwd: projectDir });
      assertDoctorReport(parseJson(postInitDoctor), "pass", "doctor after init should pass");
    });

    await runStep("run/resume/status json", async () => {
      const loop = await run(bin, ["run", "Smoke task", "--max-iterations", "1", "--json"], { cwd: projectDir });
      loopReport = parseJson(loop);
      assertRunReport(loopReport, "run", {
        status: "completed",
        completedCount: 1,
        runIdIncludes: "run_"
      });

      const resume = await run(bin, ["resume", loopReport.runId, "--max-iterations", "1", "--json"], {
        cwd: projectDir
      });
      assertRunReport(parseJson(resume), "resume", { runId: loopReport.runId });

      const statusJson = await run(bin, ["status", "--json"], { cwd: projectDir });
      assertRunReport(parseJson(statusJson), "status", { runId: loopReport.runId, completedCount: 1 });

      const explicitStatusJson = await run(bin, ["status", loopReport.runId, "--json"], { cwd: projectDir });
      assertRunReport(parseJson(explicitStatusJson), "status", { runId: loopReport.runId });

      const rawStatusJson = await run(bin, ["status", loopReport.runId, "--json", "--raw"], { cwd: projectDir });
      assertRawStatusReport(parseJson(rawStatusJson), loopReport.runId);
    });

    await runStep("checkpoint/pr-plan/pr-exec/approve-pr json", async () => {
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
    });

    await runStep("execution audit json", async () => {
      const fixture = await writeExecutionAuditFixture(projectDir);
      const audit = await run(bin, ["execution-audit", "--intent", fixture.intentId, "--json"], { cwd: projectDir });
      assertExecutionAuditReport(parseJson(audit), fixture.intentId);

      const missingAudit = await run(bin, ["execution-audit", "--intent", "intent_missing", "--json"], {
        cwd: projectDir
      });
      assertExecutionAuditErrorReport(parseJson(missingAudit), {
        status: "not_found",
        errorCode: "execution_intent_not_found",
        intentId: "intent_missing"
      });

      const missingIntent = await run(bin, ["execution-audit", "--json"], { cwd: projectDir });
      assertExecutionAuditErrorReport(parseJson(missingIntent), {
        status: "error",
        errorCode: "execution_audit_missing_intent"
      });

      const allDeferred = await run(bin, ["execution-audit", "--all", "--json"], { cwd: projectDir });
      assertExecutionAuditErrorReport(parseJson(allDeferred), {
        status: "error",
        errorCode: "execution_audit_all_deferred"
      });
    });

    await runStep("checks json", async () => {
      const checks = await run(bin, ["checks", "HEAD", "--json"], { cwd: projectDir });
      assertChecksReport(parseJson(checks));
    });

    await runStep("plain status", async () => {
      const status = await run(bin, ["status"], { cwd: projectDir });
      assertIncludes(status.stdout, "Smoke task", "plain status output should show the smoke task");
    });

    console.log("Package smoke passed:");
    console.log(`- tarball: ${tarballPath}`);
    console.log("- help output includes init, execution-audit, and version usage");
    console.log("- installed binary version matches package.json");
    console.log("- doctor reports pre-init warnings and post-init readiness");
    console.log("- init creates config and .gitignore");
    console.log("- init is idempotent on second run");
    console.log("- all JSON smoke commands include schema metadata");
    console.log("- run/resume/status JSON and plain status work through the installed binary");
    console.log("- checkpoint/pr-plan/pr-exec/approve-pr JSON fields work through the installed binary");
    console.log("- execution-audit JSON reads fixtures and returns stable error envelopes through the installed binary");
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

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("package.json must include a version string.");
  }

  return packageJson.version;
}

async function writeExecutionAuditFixture(projectDir) {
  const intentId = "intent_package_smoke";
  const createdAt = "2026-06-22T00:00:00.000Z";
  const intent = {
    id: intentId,
    runId: "run_package_smoke",
    planId: "prplan_package_smoke",
    planFingerprint: "fingerprint_package_smoke",
    checkpointId: "checkpoint_package_smoke",
    approvalId: "approval_package_smoke",
    actor: "package-smoke",
    reason: "Package smoke audit fixture.",
    createdAt,
    expiresAt: "2026-06-23T00:00:00.000Z",
    targetRef: "orchestrator/package-smoke",
    baseBranch: "main",
    sourceBranch: "orchestrator/package-smoke",
    permissionMode: "maintainer",
    policyVersion: "write-execution-intent/v1",
    commandCandidates: [
      {
        action: "create_branch",
        command: ["git", "switch", "-c", "orchestrator/package-smoke"],
        reason: "Create package smoke branch candidate.",
        decisionReady: true
      }
    ],
    status: "created",
    blockedReasons: []
  };
  const trace = {
    id: "trace_package_smoke",
    intentId,
    runId: intent.runId,
    planId: intent.planId,
    approvalId: intent.approvalId,
    checkpointId: intent.checkpointId,
    commandCandidate: {
      action: "create_branch",
      argv: ["git", "switch", "-c", "orchestrator/package-smoke"],
      reason: "Create package smoke branch candidate."
    },
    status: "planned",
    policyVersion: intent.policyVersion,
    policyDecision: "dry_run_planned",
    blockedReasons: [],
    createdAt,
    executionEnabled: false,
    writeExecution: "disabled"
  };
  const intentDir = join(projectDir, ".orchestrator", "execution-intents");
  const traceDir = join(projectDir, ".orchestrator", "execution-traces");

  await mkdir(intentDir, { recursive: true });
  await mkdir(traceDir, { recursive: true });
  await writeFile(join(intentDir, `${intent.id}.json`), `${JSON.stringify(intent, null, 2)}\n`);
  await writeFile(join(traceDir, `${trace.id}.json`), `${JSON.stringify(trace, null, 2)}\n`);

  return { intentId };
}

async function runStep(label, fn) {
  try {
    return await fn();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Package smoke step failed: ${label}\n${detail}`);
  }
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

function assertExecutionAuditReport(report, intentId) {
  assertEnvelope(report, "execution-audit");
  assertObject(report.intent, "execution-audit JSON should include intent");
  assertEqual(report.intent.id, intentId, "execution-audit JSON should preserve intent id");
  assertArray(report.traces, "execution-audit JSON should include traces");
  assertEqual(report.traceCount, 1, "execution-audit JSON should include matching trace count");
  assertEqual(report.plannedTraceCount, 1, "execution-audit JSON should include planned trace count");
  assertEqual(report.blockedTraceCount, 0, "execution-audit JSON should include blocked trace count");
  assertEqual(report.executionEnabled, false, "execution-audit JSON should keep execution disabled");
  assertEqual(report.writeExecution, "disabled", "execution-audit JSON should keep write execution disabled");
  assertEqual(report.hasExecutionResults, false, "execution-audit JSON should not expose execution results");
  assertNoExecutionResultFields(report);
}

function assertExecutionAuditErrorReport(report, expected) {
  assertEnvelope(report, "execution-audit");
  assertEqual(report.status, expected.status, "execution-audit error JSON should include expected status");
  assertEqual(report.errorCode, expected.errorCode, "execution-audit error JSON should include expected errorCode");
  assertString(report.message, "execution-audit error JSON should include message");
  if (expected.intentId) {
    assertEqual(report.intentId, expected.intentId, "execution-audit error JSON should preserve intent id");
  }
  assertEqual(report.intent, null, "execution-audit error JSON should set intent to null");
  assertEqual(report.executionEnabled, false, "execution-audit error JSON should keep execution disabled");
  assertEqual(report.writeExecution, "disabled", "execution-audit error JSON should keep write execution disabled");
  assertEqual(report.hasExecutionResults, false, "execution-audit error JSON should not expose execution results");
  assertNoExecutionResultFields(report);
}

function assertChecksReport(report) {
  assertEnvelope(report, "checks");
  assertEqual(report.source, "github", "checks JSON should preserve provider source");
}

function assertNoExecutionResultFields(value) {
  const forbiddenFields = ["executedCommands", "stdout", "stderr", "exitCode"];

  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoExecutionResultFields(item);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const field of forbiddenFields) {
    if (field in value) {
      throw new Error(`execution-audit JSON should not include ${field}.`);
    }
  }

  for (const nestedValue of Object.values(value)) {
    assertNoExecutionResultFields(nestedValue);
  }
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

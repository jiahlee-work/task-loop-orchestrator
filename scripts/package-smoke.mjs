#!/usr/bin/env node
// Verifies the packed tarball the same way a user would consume it: install into a
// temporary project, run the installed binary, and check the core JSON workflows.
// Failures are wrapped with step labels plus command/cwd/output excerpts; this
// script never creates branches, pushes, PRs, merges, releases, or publishes.
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  const fakeBinDir = join(tempRoot, "bin");
  const packageVersion = await readPackageVersion();
  let tarballPath = "";
  let bin = "";
  let shortBin = "";
  let loopReport;

  try {
    await runStep("pack and install", async () => {
      await mkdir(packDir);
      await mkdir(projectDir);
      await mkdir(fakeBinDir);
      await run("npm", ["pack", "--pack-destination", packDir], { cwd: repoRoot });
      tarballPath = await findTarball(packDir);
      await run("npm", ["install", "--prefix", installDir, tarballPath], { cwd: repoRoot });
      await writeFakeJiraBinary(fakeBinDir);

      bin = process.platform === "win32"
        ? join(installDir, "node_modules", ".bin", "task-loop-orchestrator.cmd")
        : join(installDir, "node_modules", ".bin", "task-loop-orchestrator");
      shortBin = process.platform === "win32"
        ? join(installDir, "node_modules", ".bin", "tlo.cmd")
        : join(installDir, "node_modules", ".bin", "tlo");
    });

    await runStep("help", async () => {
      const help = await run(bin, ["--help"], { cwd: projectDir });
      assertIncludes(help.stdout, "task-loop-orchestrator init", "help output should include init usage");
      assertIncludes(help.stdout, "task-loop-orchestrator setup jira", "help output should include setup jira usage");
      assertIncludes(help.stdout, "task-loop-orchestrator setup gemini", "help output should include setup gemini usage");
      assertIncludes(help.stdout, "task-loop-orchestrator doctor", "help output should include doctor usage");
      assertIncludes(help.stdout, "tlo setup", "help output should include tlo setup wizard alias usage");
      assertIncludes(help.stdout, "tlo setup jira", "help output should include tlo setup alias usage");
      assertIncludes(help.stdout, "task-loop-orchestrator execution-audit", "help output should include execution-audit usage");
      assertIncludes(help.stdout, "task-loop-orchestrator write-readiness", "help output should include write-readiness usage");
      assertIncludes(help.stdout, "task-loop-orchestrator write-runner", "help output should include write-runner usage");
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

      const aliasVersion = await run(shortBin, ["--version"], { cwd: projectDir });
      assertEqual(aliasVersion.stdout.trim(), version.stdout.trim(), "installed tlo alias --version should match package.json");
    });

    await runStep("pre-init doctor", async () => {
      const preInitDoctor = await run(bin, ["doctor", "--json"], { cwd: projectDir });
      assertDoctorReport(parseJson(preInitDoctor), "warn", "doctor before init should warn", {
        checks: {
          git_repository: "warn",
          config: "warn",
          gitignore: "warn",
          store_path: "pass",
          github: "pass"
        },
        suggestions: {
          config: ["tlo", "init"],
          gitignore: ["tlo", "init"]
        }
      });
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
        label: "second init",
        configReasonIncludes: "already exists",
        gitignoreReasonIncludes: "already ignored"
      });
    });

    await runStep("post-init doctor", async () => {
      const postInitDoctor = await run(bin, ["doctor", "--json"], { cwd: projectDir });
      assertDoctorReport(parseJson(postInitDoctor), ["pass", "warn"], "doctor after init should pass or warn only on optional provider readiness", {
        checks: {
          git_repository: "pass",
          config: "pass",
          gitignore: "pass",
          store_path: "pass",
          github: "pass"
        }
      });
    });

    await runStep("mvp first-run json", async () => {
      const emptyStatus = await run(bin, ["status", "--json"], { cwd: projectDir });
      assertStatusNotFoundReport(parseJson(emptyStatus));

      const missingResume = await runAllowFailure(bin, ["resume", "run_missing", "--max-iterations", "1", "--json"], {
        cwd: projectDir
      });
      assertEqual(missingResume.exitCode, "1", "resume missing run should exit non-zero");
      assertResumeNotFoundReport(parseJson(missingResume), "run_missing");

      const missingGemini = await runAllowFailure(bin, ["run", "Smoke task", "--json"], { cwd: projectDir });
      assertEqual(missingGemini.exitCode, "1", "default Gemini run without setup should exit non-zero");
      assertRunPreflightFailureReport(parseJson(missingGemini), {
        errorCode: "gemini_setup_required",
        provider: "gemini",
        nextCommand: "tlo setup gemini"
      });

      const loop = await run(
        bin,
        ["run", "Smoke task", "--planner", "mock", "--executor", "mock", "--reviewer", "mock", "--max-iterations", "1", "--json"],
        { cwd: projectDir }
      );
      loopReport = parseJson(loop);
      assertRunReport(loopReport, "run", {
        status: "completed",
        completedCount: 1,
        runIdIncludes: "run_",
        taskTitle: "Smoke task"
      });
      await assertRunDirectoryArtifacts(loopReport, "Smoke task");

      const statusJson = await run(bin, ["status", "--json"], { cwd: projectDir });
      const latestStatusReport = parseJson(statusJson);
      assertRunReport(latestStatusReport, "status", {
        runId: loopReport.runId,
        completedCount: 1,
        taskTitle: "Smoke task"
      });

      const resume = await run(bin, ["resume", loopReport.runId, "--max-iterations", "1", "--json"], {
        cwd: projectDir
      });
      const resumeReport = parseJson(resume);
      assertRunReport(resumeReport, "resume", {
        runId: loopReport.runId,
        completedCount: 1,
        taskTitle: "Smoke task"
      });

      const explicitStatusJson = await run(bin, ["status", loopReport.runId, "--json"], { cwd: projectDir });
      const explicitStatusReport = parseJson(explicitStatusJson);
      assertRunReport(explicitStatusReport, "status", {
        runId: loopReport.runId,
        completedCount: 1,
        taskTitle: "Smoke task"
      });
      assertEqual(
        explicitStatusReport.status,
        resumeReport.status,
        "status <runId> JSON should match resume status after resume"
      );
      assertEqual(
        JSON.stringify(explicitStatusReport.counts),
        JSON.stringify(resumeReport.counts),
        "status <runId> JSON should match resume subtask counts after resume"
      );

      const rawStatusJson = await run(bin, ["status", loopReport.runId, "--json", "--raw"], { cwd: projectDir });
      assertRawStatusReport(parseJson(rawStatusJson), loopReport.runId);
    });

    await runStep("jira issue run json", async () => {
      const jiraRun = await run(
        shortBin,
        [
          "run",
          "ABC-123",
          "--note",
          "Include package smoke note.",
          "--planner",
          "mock",
          "--executor",
          "mock",
          "--reviewer",
          "mock",
          "--max-iterations",
          "1",
          "--json"
        ],
        {
          cwd: projectDir,
          env: prependPath(fakeBinDir)
        }
      );
      const jiraRunReport = parseJson(jiraRun);
      assertRunReport(jiraRunReport, "run", {
        status: "completed",
        completedCount: 1,
        runIdIncludes: "run_",
        taskTitle: "ABC-123: Package smoke Jira task"
      });
      await assertRunDirectoryArtifacts(jiraRunReport, "ABC-123: Package smoke Jira task");
      assertIncludes(
        jiraRunReport.run.spec.description,
        "Jira: https://jira.example.com/browse/ABC-123",
        "Jira run should preserve issue URL in the task description"
      );
      assertIncludes(
        jiraRunReport.run.spec.description,
        "Package smoke issue description.",
        "Jira run should preserve issue description"
      );
      assertIncludes(
        jiraRunReport.run.spec.description,
        "User note:\nInclude package smoke note.",
        "Jira run should preserve user note in the task description"
      );
      assertEqual(
        JSON.stringify(jiraRunReport.run.spec.acceptanceCriteria),
        JSON.stringify(["Provider reads issue JSON", "Run flow uses Jira TaskSpec"]),
        "Jira run should use issue acceptance criteria"
      );
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

    await runStep("advanced read-only audit/write-runner json", async () => {
      const emptyAuditList = await run(bin, ["execution-audit", "--all", "--json"], { cwd: projectDir });
      assertExecutionAuditListReport(parseJson(emptyAuditList), {
        bundleCount: 0,
        intentIds: []
      });

      const fixture = await writeExecutionAuditFixture(projectDir);
      const audit = await run(bin, ["execution-audit", "--intent", fixture.intentId, "--json"], { cwd: projectDir });
      assertExecutionAuditReport(parseJson(audit), fixture.intentId);

      const readiness = await run(bin, ["write-readiness", "--intent", fixture.intentId, "--json"], { cwd: projectDir });
      assertWriteReadinessReport(parseJson(readiness), fixture.intentId);

      const preflight = await writeReadinessPreflightFixtures(projectDir);
      const readinessWithPreflight = await run(
        bin,
        ["write-readiness", "--intent", fixture.intentId, "--preflight", preflight.validPath, "--json"],
        { cwd: projectDir }
      );
      assertWriteReadinessReport(parseJson(readinessWithPreflight), fixture.intentId, {
        readinessStatus: "ready",
        ready: true,
        preflight: "available"
      });

      const invalidPreflightJson = await run(
        bin,
        ["write-readiness", "--intent", fixture.intentId, "--preflight", preflight.invalidJsonPath, "--json"],
        { cwd: projectDir }
      );
      assertWriteReadinessErrorReport(parseJson(invalidPreflightJson), {
        status: "error",
        errorCode: "write_readiness_preflight_invalid_json",
        intentId: fixture.intentId,
        detailsKind: "preflight",
        forbiddenText: preflight.secret
      });

      const invalidPreflightSchema = await run(
        bin,
        ["write-readiness", "--intent", fixture.intentId, "--preflight", preflight.invalidSchemaPath, "--json"],
        { cwd: projectDir }
      );
      assertWriteReadinessErrorReport(parseJson(invalidPreflightSchema), {
        status: "error",
        errorCode: "write_readiness_preflight_invalid_schema",
        intentId: fixture.intentId,
        detailsKind: "preflight",
        forbiddenText: preflight.secret
      });

      const missingPreflightValue = await run(
        bin,
        ["write-readiness", "--intent", fixture.intentId, "--preflight", "--json"],
        { cwd: projectDir }
      );
      assertWriteReadinessErrorReport(parseJson(missingPreflightValue), {
        status: "error",
        errorCode: "write_readiness_preflight_missing_path",
        intentId: fixture.intentId,
        detailsKind: "preflight"
      });

      const missingPreflightFilePath = join(projectDir, ".orchestrator", "preflight-fixtures", "missing-preflight-secret.json");
      const missingPreflightFile = await run(
        bin,
        ["write-readiness", "--intent", fixture.intentId, "--preflight", missingPreflightFilePath, "--json"],
        { cwd: projectDir }
      );
      assertWriteReadinessErrorReport(parseJson(missingPreflightFile), {
        status: "error",
        errorCode: "write_readiness_preflight_file_not_found",
        intentId: fixture.intentId,
        detailsKind: "preflight",
        forbiddenText: missingPreflightFilePath
      });

      const plainReadiness = await run(bin, ["write-readiness", "--intent", fixture.intentId], { cwd: projectDir });
      assertWriteReadinessPlainOutput(plainReadiness.stdout, fixture.intentId);

      const plainReadinessWithPreflight = await run(
        bin,
        ["write-readiness", "--intent", fixture.intentId, "--preflight", preflight.validPath],
        { cwd: projectDir }
      );
      assertWriteReadinessPlainOutput(plainReadinessWithPreflight.stdout, fixture.intentId, {
        readinessStatus: "ready",
        ready: "yes",
        preflight: "available"
      });

      const plainInvalidPreflightJson = await runAllowFailure(
        bin,
        ["write-readiness", "--intent", fixture.intentId, "--preflight", preflight.invalidJsonPath],
        { cwd: projectDir }
      );
      assertEqual(plainInvalidPreflightJson.exitCode, "1", "write-readiness plain invalid preflight should exit non-zero");
      assertWriteReadinessPlainErrorOutput(plainInvalidPreflightJson.stdout, {
        errorCode: "write_readiness_preflight_invalid_json",
        forbiddenText: preflight.secret
      });

      const plainAudit = await run(bin, ["execution-audit", "--intent", fixture.intentId], { cwd: projectDir });
      assertExecutionAuditPlainOutput(plainAudit.stdout, fixture.intentId);

      const auditList = await run(bin, ["execution-audit", "--all", "--json"], { cwd: projectDir });
      assertExecutionAuditListReport(parseJson(auditList), {
        bundleCount: 1,
        intentIds: [fixture.intentId]
      });

      const plainAuditList = await run(bin, ["execution-audit", "--all"], { cwd: projectDir });
      assertExecutionAuditPlainListOutput(plainAuditList.stdout, {
        bundleCount: 1,
        intentIds: [fixture.intentId]
      });

      const blockedDryRun = await run(bin, ["write-runner", "--intent", fixture.intentId, "--json"], { cwd: projectDir });
      assertWriteRunnerDryRunReport(parseJson(blockedDryRun), fixture.intentId, {
        status: "blocked",
        readinessStatus: "unknown",
        ready: false,
        localTracePersistence: "skipped"
      });

      const readyDryRun = await run(
        bin,
        ["write-runner", "--intent", fixture.intentId, "--preflight", preflight.validPath, "--json"],
        { cwd: projectDir }
      );
      assertWriteRunnerDryRunReport(parseJson(readyDryRun), fixture.intentId, {
        status: "planned",
        readinessStatus: "ready",
        ready: true,
        localTracePersistence: "saved"
      });

      const simulatedRun = await run(
        bin,
        ["write-runner", "--intent", fixture.intentId, "--preflight", preflight.validPath, "--simulate", "--json"],
        { cwd: projectDir }
      );
      assertWriteRunnerDryRunReport(parseJson(simulatedRun), fixture.intentId, {
        status: "simulated",
        readinessStatus: "ready",
        ready: true,
        localTracePersistence: "saved",
        mode: "simulate",
        simulationResultCount: 1
      });

      const disabledExecuteRun = await run(
        bin,
        ["write-runner", "--intent", fixture.intentId, "--preflight", preflight.validPath, "--execute", "--json"],
        { cwd: projectDir }
      );
      assertWriteRunnerDryRunReport(parseJson(disabledExecuteRun), fixture.intentId, {
        status: "disabled",
        readinessStatus: "ready",
        ready: true,
        localTracePersistence: "skipped",
        mode: "execute_disabled",
        simulationResultCount: 0
      });

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

      const missingReadinessIntent = await run(bin, ["write-readiness", "--json"], { cwd: projectDir });
      assertWriteReadinessErrorReport(parseJson(missingReadinessIntent), {
        status: "error",
        errorCode: "write_readiness_missing_intent"
      });
      const plainMissingReadinessIntent = await runAllowFailure(bin, ["write-readiness"], { cwd: projectDir });
      assertEqual(plainMissingReadinessIntent.exitCode, "1", "write-readiness plain missing selector should exit non-zero");
      assertWriteReadinessPlainErrorOutput(plainMissingReadinessIntent.stdout, {
        errorCode: "write_readiness_missing_intent"
      });

      const missingReadiness = await run(bin, ["write-readiness", "--intent", "intent_missing", "--json"], {
        cwd: projectDir
      });
      assertWriteReadinessErrorReport(parseJson(missingReadiness), {
        status: "not_found",
        errorCode: "write_readiness_intent_not_found",
        intentId: "intent_missing"
      });

      const plainMissingIntent = await runAllowFailure(bin, ["execution-audit"], { cwd: projectDir });
      assertEqual(plainMissingIntent.exitCode, "1", "execution-audit plain missing selector should exit non-zero");
      assertExecutionAuditPlainErrorOutput(plainMissingIntent.stdout, {
        errorCode: "execution_audit_missing_intent"
      });

      const invalidIntent = await writeInvalidExecutionIntentFixture(projectDir);
      const invalidIntentResult = await run(bin, ["execution-audit", "--intent", invalidIntent.intentId, "--json"], {
        cwd: projectDir
      });
      assertExecutionAuditErrorReport(parseJson(invalidIntentResult), {
        status: "error",
        errorCode: "invalid_execution_intent_file",
        intentId: invalidIntent.intentId,
        detailsKind: "execution_intent",
        forbiddenText: invalidIntent.secret
      });
      const invalidReadinessIntentResult = await run(
        bin,
        ["write-readiness", "--intent", invalidIntent.intentId, "--json"],
        { cwd: projectDir }
      );
      assertWriteReadinessErrorReport(parseJson(invalidReadinessIntentResult), {
        status: "error",
        errorCode: "invalid_execution_intent_file",
        intentId: invalidIntent.intentId,
        detailsKind: "execution_intent",
        forbiddenText: invalidIntent.secret
      });
      const invalidIntentPlainResult = await runAllowFailure(
        bin,
        ["execution-audit", "--intent", invalidIntent.intentId],
        { cwd: projectDir }
      );
      assertEqual(invalidIntentPlainResult.exitCode, "1", "execution-audit plain invalid intent should exit non-zero");
      assertExecutionAuditPlainErrorOutput(invalidIntentPlainResult.stdout, {
        errorCode: "invalid_execution_intent_file",
        forbiddenText: invalidIntent.secret
      });
      const invalidIntentListResult = await run(bin, ["execution-audit", "--all", "--json"], { cwd: projectDir });
      assertExecutionAuditErrorReport(parseJson(invalidIntentListResult), {
        status: "error",
        errorCode: "invalid_execution_intent_file",
        detailsKind: "execution_intent",
        forbiddenText: invalidIntent.secret
      });
      await rm(invalidIntent.path, { force: true });

      const invalidTrace = await writeInvalidExecutionTraceFixture(projectDir);
      const invalidTraceResult = await run(bin, ["execution-audit", "--intent", fixture.intentId, "--json"], {
        cwd: projectDir
      });
      assertExecutionAuditErrorReport(parseJson(invalidTraceResult), {
        status: "error",
        errorCode: "invalid_execution_trace_file",
        intentId: fixture.intentId,
        detailsKind: "execution_trace",
        forbiddenText: invalidTrace.secret
      });
      const invalidReadinessTraceResult = await run(bin, ["write-readiness", "--intent", fixture.intentId, "--json"], {
        cwd: projectDir
      });
      assertWriteReadinessErrorReport(parseJson(invalidReadinessTraceResult), {
        status: "error",
        errorCode: "invalid_execution_trace_file",
        intentId: fixture.intentId,
        detailsKind: "execution_trace",
        forbiddenText: invalidTrace.secret
      });
      const invalidTraceListResult = await run(bin, ["execution-audit", "--all", "--json"], { cwd: projectDir });
      assertExecutionAuditErrorReport(parseJson(invalidTraceListResult), {
        status: "error",
        errorCode: "invalid_execution_trace_file",
        detailsKind: "execution_trace",
        forbiddenText: invalidTrace.secret
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
    console.log("- help output includes init, setup jira, execution-audit, and version usage");
    console.log("- installed binary version matches package.json");
    console.log("- doctor reports pre-init warnings and post-init readiness");
    console.log("- init creates config and .gitignore");
    console.log("- init is idempotent on second run");
    console.log("- all JSON smoke commands include schema metadata");
    console.log("- default Gemini run fails before saving a run when Gemini setup is missing");
    console.log(
      "- MVP first-run flow init/doctor/run/status/resume/status works through the installed binary with the actual runId"
    );
    console.log("- Jira issue read provider feeds issue data into the installed tlo run flow");
    console.log("- status no-run and resume missing-run JSON guidance work through the installed binary");
    console.log("- checkpoint/pr-plan/pr-exec/approve-pr JSON fields work through the installed binary");
    console.log(
      "- execution-audit JSON and plain output read fixtures, list bundles, and return safe errors through the installed binary"
    );
    console.log(
      "- write-readiness JSON and plain output read audit fixtures, preflight evidence, and return safe errors through the installed binary"
    );
    console.log(
      "- write-runner JSON dry-run and simulate output block unknown readiness, keep actual execution disabled, and save local trace artifacts for ready preflight"
    );
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

async function writeFakeJiraBinary(fakeBinDir) {
  const path = join(fakeBinDir, process.platform === "win32" ? "jira.cmd" : "jira");
  const script =
    process.platform === "win32"
      ? `@echo off
node -e "console.log(JSON.stringify({key:'ABC-123',self:'https://jira.example.com/browse/ABC-123',fields:{summary:'Package smoke Jira task',description:'Package smoke issue description.',status:{name:'To Do'},issuetype:{name:'Task'},labels:['package-smoke'],acceptanceCriteria:'- Provider reads issue JSON\\n- Run flow uses Jira TaskSpec'}}))"
`
      : `#!/usr/bin/env node
console.log(JSON.stringify({
  key: "ABC-123",
  self: "https://jira.example.com/browse/ABC-123",
  fields: {
    summary: "Package smoke Jira task",
    description: "Package smoke issue description.",
    status: { name: "To Do" },
    issuetype: { name: "Task" },
    labels: ["package-smoke"],
    acceptanceCriteria: "- Provider reads issue JSON\\n- Run flow uses Jira TaskSpec"
  }
}));
`;
  await writeFile(path, script, "utf8");
  if (process.platform !== "win32") {
    await chmod(path, 0o755);
  }
}

function prependPath(dir) {
  return {
    ...process.env,
    PATH: `${dir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`
  };
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

async function writeReadinessPreflightFixtures(projectDir) {
  const secret = "top-secret-preflight-fixture";
  const preflightDir = join(projectDir, ".orchestrator", "preflight-fixtures");
  const validPath = join(preflightDir, "passing-preflight.json");
  const invalidJsonPath = join(preflightDir, "invalid-json.json");
  const invalidSchemaPath = join(preflightDir, "invalid-schema.json");

  await mkdir(preflightDir, { recursive: true });
  await writeFile(validPath, `${JSON.stringify(passingWriteReadinessPreflightFixture(), null, 2)}\n`);
  await writeFile(invalidJsonPath, `{ "${secret}": `);
  await writeFile(
    invalidSchemaPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        checks: [
          {
            category: "ci",
            status: "unexpected",
            code: "ci_policy_passed",
            message: secret,
            source: "preflight",
            stdout: secret,
            stderr: secret,
            exitCode: 1,
            executedCommands: ["git", "push"],
            stack: secret,
            argv: ["git", "push"]
          }
        ]
      },
      null,
      2
    )}\n`
  );

  return { validPath, invalidJsonPath, invalidSchemaPath, secret };
}

function passingWriteReadinessPreflightFixture() {
  return {
    schemaVersion: 1,
    metadata: {
      createdAt: "2026-06-22T02:00:00.000Z",
      tool: "package-smoke"
    },
    checks: [
      preflightCheck("approval", "approval_freshness_passed", "Approval freshness is verified."),
      preflightCheck("approval", "approval_expiration_passed", "Approval is not expired."),
      preflightCheck("policy", "plan_fingerprint_passed", "Plan fingerprint matches the approved plan."),
      preflightCheck("precondition", "checkpoint_match_passed", "Latest checkpoint matches the approved checkpoint."),
      preflightCheck("repo_state", "repo_cleanliness_passed", "Repository cleanliness satisfies policy."),
      preflightCheck("repo_state", "diff_verification_passed", "Diff verification passed."),
      preflightCheck("policy", "ref_policy_passed", "Target ref and branch policy are satisfied."),
      preflightCheck("ci", "ci_policy_passed", "CI/check policy is satisfied."),
      preflightCheck("permission", "permission_gate_passed", "Permission gate allows the approved action."),
      preflightCheck("policy", "command_runner_passed", "Command runner write configuration is available.")
    ]
  };
}

function preflightCheck(category, code, message) {
  return {
    category,
    status: "pass",
    code,
    message,
    source: "preflight"
  };
}

async function writeInvalidExecutionIntentFixture(projectDir) {
  const intentId = "intent_invalid_package_smoke";
  const secret = "top-secret-invalid-intent-fixture";
  const intentDir = join(projectDir, ".orchestrator", "execution-intents");

  await mkdir(intentDir, { recursive: true });
  await writeFile(join(intentDir, `${intentId}.json`), `${JSON.stringify({ id: "", secret }, null, 2)}\n`);

  return { intentId, secret, path: join(intentDir, `${intentId}.json`) };
}

async function writeInvalidExecutionTraceFixture(projectDir) {
  const secret = "top-secret-invalid-trace-fixture";
  const traceDir = join(projectDir, ".orchestrator", "execution-traces");

  await mkdir(traceDir, { recursive: true });
  const path = join(traceDir, "trace_invalid_package_smoke.json");
  await writeFile(path, `${JSON.stringify({ id: "", secret }, null, 2)}\n`);

  return { secret, path };
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
      env: options.env,
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

async function runAllowFailure(command, args, options) {
  const commandText = formatCommand(command, args);
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: 1024 * 1024 * 10
    });
    return {
      ...result,
      commandText,
      cwd: options.cwd,
      exitCode: "0"
    };
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const exitCode = typeof error?.code === "number" || typeof error?.code === "string" ? String(error.code) : "unknown";
    return {
      stdout,
      stderr,
      commandText,
      cwd: options.cwd,
      exitCode
    };
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

function assertDoctorReport(report, expectedStatus, message, expected = {}) {
  assertEnvelope(report, "doctor");
  if (Array.isArray(expectedStatus)) {
    if (!expectedStatus.includes(report.status)) {
      throw new Error(`${message}: expected one of ${expectedStatus.join(", ")}, got ${report.status}`);
    }
  } else {
    assertEqual(report.status, expectedStatus, message);
  }
  assertArray(report.checks, "doctor JSON should include checks");

  for (const [id, status] of Object.entries(expected.checks ?? {})) {
    const check = findDoctorCheck(report, id);
    assertEqual(check.status, status, `doctor JSON should mark ${id} as ${status}`);
    assertString(check.summary, `doctor JSON should include ${id} summary`);
  }

  for (const [id, command] of Object.entries(expected.suggestions ?? {})) {
    const check = findDoctorCheck(report, id);
    const commands = (check.suggestions ?? []).map((suggestion) => JSON.stringify(suggestion.command));
    if (!commands.includes(JSON.stringify(command))) {
      throw new Error(`doctor JSON should suggest ${command.join(" ")} for ${id}`);
    }
  }
}

function assertInitReport(report, expected) {
  assertEnvelope(report, "init");
  assertEqual(report.files.config.status, expected.configStatus, `${expected.label} should set config status`);
  assertEqual(report.files.gitignore.status, expected.gitignoreStatus, `${expected.label} should set gitignore status`);

  if (expected.configReasonIncludes) {
    assertIncludes(report.files.config.reason, expected.configReasonIncludes, `${expected.label} should explain config status`);
  }

  if (expected.gitignoreReasonIncludes) {
    assertIncludes(
      report.files.gitignore.reason,
      expected.gitignoreReasonIncludes,
      `${expected.label} should explain gitignore status`
    );
  }
}

function findDoctorCheck(report, id) {
  const check = report.checks.find((item) => item.id === id);
  if (!check) {
    throw new Error(`doctor JSON should include ${id} check`);
  }

  return check;
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

  if (expected.taskTitle) {
    assertEqual(report.task.title, expected.taskTitle, `${command} JSON should include task title`);
    assertEqual(report.run.spec.title, expected.taskTitle, `${command} JSON should include raw run task title`);
  }

  assertString(report.status, `${command} JSON should include status`);
  assertNumber(report.iterations, `${command} JSON should include iterations`);
  assertObject(report.counts, `${command} JSON should include counts`);
  assertNumber(report.counts.total, `${command} JSON should include total subtask count`);
  assertObject(report.task, `${command} JSON should include task summary`);
  assertObject(report.run, `${command} JSON should include raw run`);
  assertIncludes(report.savedPath, report.runId, `${command} JSON should include saved path`);
}

async function assertRunDirectoryArtifacts(report, expectedTaskTitle) {
  const entries = await readdir(report.savedPath);
  for (const expectedEntry of ["root-contract.json", "task-tree.json", "state.json", "summary.md", "loop-run.json"]) {
    if (!entries.includes(expectedEntry)) {
      throw new Error(`run directory should include ${expectedEntry}`);
    }
  }

  const rootContract = parseJson({ stdout: await readFile(join(report.savedPath, "root-contract.json"), "utf8") });
  const taskTree = parseJson({ stdout: await readFile(join(report.savedPath, "task-tree.json"), "utf8") });
  const state = parseJson({ stdout: await readFile(join(report.savedPath, "state.json"), "utf8") });
  const summary = await readFile(join(report.savedPath, "summary.md"), "utf8");

  assertEqual(rootContract.runId, report.runId, "root contract should belong to the run");
  assertEqual(rootContract.goal, expectedTaskTitle, "root contract should keep the task goal");
  assertEqual(taskTree.runId, report.runId, "task tree should belong to the run");
  assertArray(taskTree.tasks, "task tree should include tasks");
  assertEqual(state.runId, report.runId, "state should belong to the run");
  assertEqual(state.status, report.status, "state should match run status");
  assertIncludes(summary, expectedTaskTitle, "summary should include the task title");
}

function assertRunPreflightFailureReport(report, expected) {
  assertEnvelope(report, "run");
  assertEqual(report.status, "failed", "run preflight JSON should report failed");
  assertEqual(report.errorCode, expected.errorCode, "run preflight JSON should include the expected error code");
  assertEqual(report.provider, expected.provider, "run preflight JSON should include the blocked provider");
  assertArray(report.reasons, "run preflight JSON should include reasons");
  assertArray(report.next, "run preflight JSON should include next actions");
  const nextCommands = report.next.map((item) => item.command).filter(Boolean);
  if (!nextCommands.includes(expected.nextCommand)) {
    throw new Error(`run preflight JSON should suggest ${expected.nextCommand}`);
  }
}

function assertStatusNotFoundReport(report) {
  assertEnvelope(report, "status");
  assertEqual(report.status, "not_found", "empty status JSON should report not_found");
  assertEqual(report.run, null, "empty status JSON should set run to null");
  assertIncludes(report.message, 'tlo run "task instruction" --json', "empty status JSON should suggest starting a run");
}

function assertResumeNotFoundReport(report, runId) {
  assertEnvelope(report, "resume");
  assertEqual(report.status, "not_found", "missing resume JSON should report not_found");
  assertEqual(report.runId, runId, "missing resume JSON should preserve requested runId");
  assertEqual(report.run, null, "missing resume JSON should set run to null");
  assertIncludes(report.message, "status --json", "missing resume JSON should suggest checking status");
  assertIncludes(report.message, 'tlo run "task instruction" --json', "missing resume JSON should suggest starting a run");
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

function assertExecutionAuditListReport(report, expected) {
  assertEnvelope(report, "execution-audit");
  assertEqual(report.status, "ok", "execution-audit list JSON should include ok status");
  assertEqual(report.bundleCount, expected.bundleCount, "execution-audit list JSON should include bundle count");
  assertArray(report.bundles, "execution-audit list JSON should include bundles");
  assertEqual(report.bundles.length, expected.bundleCount, "execution-audit list JSON bundle count should match array length");
  assertEqual(report.executionEnabled, false, "execution-audit list JSON should keep execution disabled");
  assertEqual(report.writeExecution, "disabled", "execution-audit list JSON should keep write execution disabled");
  assertEqual(report.hasExecutionResults, false, "execution-audit list JSON should not expose execution results");
  assertEqual(
    JSON.stringify(report.bundles.map((bundle) => bundle.intent?.id)),
    JSON.stringify(expected.intentIds),
    "execution-audit list JSON should preserve ordered intent ids"
  );
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
  if (expected.detailsKind) {
    assertEqual(report.details?.kind, expected.detailsKind, "execution-audit error JSON should include safe details kind");
  }
  if (expected.forbiddenText) {
    assertNotIncludes(JSON.stringify(report), expected.forbiddenText, "execution-audit error JSON should not expose raw persisted file content");
  }
  assertEqual(report.intent, null, "execution-audit error JSON should set intent to null");
  assertEqual(report.executionEnabled, false, "execution-audit error JSON should keep execution disabled");
  assertEqual(report.writeExecution, "disabled", "execution-audit error JSON should keep write execution disabled");
  assertEqual(report.hasExecutionResults, false, "execution-audit error JSON should not expose execution results");
  assertNoExecutionResultFields(report);
}

function assertWriteReadinessReport(
  report,
  intentId,
  expected = {
    readinessStatus: "unknown",
    ready: false,
    preflight: "missing"
  }
) {
  assertEnvelope(report, "write-readiness");
  assertEqual(report.intentId, intentId, "write-readiness JSON should preserve intent id");
  assertString(report.runId, "write-readiness JSON should include run id");
  assertString(report.planId, "write-readiness JSON should include plan id");
  assertString(report.approvalId, "write-readiness JSON should include approval id");
  assertEqual(report.readinessStatus, expected.readinessStatus, "write-readiness JSON should include expected readiness status");
  assertEqual(report.ready, expected.ready, "write-readiness JSON should include expected readiness boolean");
  assertArray(report.blockers, "write-readiness JSON should include blockers");
  assertArray(report.checks, "write-readiness JSON should include checks");
  assertObject(report.inputs, "write-readiness JSON should include inputs");
  assertEqual(report.inputs.auditBundle, "available", "write-readiness JSON should include audit bundle input status");
  assertEqual(report.inputs.preflight, expected.preflight, "write-readiness JSON should include expected preflight input status");
  assertEqual(report.executionEnabled, false, "write-readiness JSON should keep execution disabled");
  assertEqual(report.writeExecution, "disabled", "write-readiness JSON should keep write execution disabled");
  assertEqual(report.hasExecutionResults, false, "write-readiness JSON should not expose execution results");
  assertNoExecutionResultFields(report);
}

function assertWriteReadinessErrorReport(report, expected) {
  assertEnvelope(report, "write-readiness");
  assertEqual(report.status, expected.status, "write-readiness error JSON should include expected status");
  assertEqual(report.errorCode, expected.errorCode, "write-readiness error JSON should include expected errorCode");
  assertString(report.message, "write-readiness error JSON should include message");
  if (expected.intentId) {
    assertEqual(report.intentId, expected.intentId, "write-readiness error JSON should preserve intent id");
  }
  if (expected.detailsKind) {
    assertEqual(report.details?.kind, expected.detailsKind, "write-readiness error JSON should include safe details kind");
  }
  if (expected.forbiddenText) {
    assertNotIncludes(JSON.stringify(report), expected.forbiddenText, "write-readiness error JSON should not expose raw persisted file content");
  }
  assertEqual(report.readiness, null, "write-readiness error JSON should set readiness to null");
  assertEqual(report.executionEnabled, false, "write-readiness error JSON should keep execution disabled");
  assertEqual(report.writeExecution, "disabled", "write-readiness error JSON should keep write execution disabled");
  assertEqual(report.hasExecutionResults, false, "write-readiness error JSON should not expose execution results");
  assertNoExecutionResultFields(report);
}

function assertWriteRunnerDryRunReport(report, intentId, expected) {
  assertEnvelope(report, "write-runner");
  assertEqual(report.intentId, intentId, "write-runner JSON should preserve intent id");
  assertString(report.runId, "write-runner JSON should include run id");
  assertString(report.planId, "write-runner JSON should include plan id");
  assertString(report.approvalId, "write-runner JSON should include approval id");
  assertEqual(report.status, expected.status, "write-runner JSON should include expected dry-run status");
  assertEqual(report.readinessStatus, expected.readinessStatus, "write-runner JSON should include readiness status");
  assertEqual(report.ready, expected.ready, "write-runner JSON should include ready boolean");
  assertNumber(report.planItemCount, "write-runner JSON should include plan item count");
  assertArray(report.planItems, "write-runner JSON should include plan items");
  assertNumber(report.traceCount, "write-runner JSON should include trace count");
  assertArray(report.traceIds, "write-runner JSON should include trace ids");
  assertEqual(
    report.localTracePersistence,
    expected.localTracePersistence,
    "write-runner JSON should include expected local trace persistence"
  );
  assertObject(report.policy, "write-runner JSON should include execution policy");
  if (expected.mode) {
    assertEqual(report.policy.mode, expected.mode, "write-runner JSON should include expected policy mode");
  }
  assertEqual(report.policy.actualExecutionEnabled, false, "write-runner policy should keep actual execution disabled");
  assertEqual(report.policy.executionEnabled, false, "write-runner policy should keep execution disabled");
  assertEqual(report.policy.writeExecution, "disabled", "write-runner policy should keep write execution disabled");
  assertNumber(report.simulationResultCount, "write-runner JSON should include simulation result count");
  assertArray(report.simulationResults, "write-runner JSON should include simulation results");
  if (typeof expected.simulationResultCount === "number") {
    assertEqual(
      report.simulationResultCount,
      expected.simulationResultCount,
      "write-runner JSON should include expected simulation result count"
    );
  }
  assertNumber(report.blockedReasonCount, "write-runner JSON should include blocked reason count");
  assertArray(report.blockedReasons, "write-runner JSON should include blocked reasons");
  assertEqual(report.executionEnabled, false, "write-runner JSON should keep execution disabled");
  assertEqual(report.writeExecution, "disabled", "write-runner JSON should keep write execution disabled");
  assertEqual(report.hasExecutionResults, false, "write-runner JSON should not expose execution results");
  assertNoExecutionResultFields(report);
  assertNotIncludes(JSON.stringify(report), "\"argv\"", "write-runner JSON should not expose raw command argv");
}

function assertWriteReadinessPlainOutput(
  output,
  intentId,
  expected = {
    readinessStatus: "unknown",
    ready: "unknown",
    preflight: "missing"
  }
) {
  assertIncludes(output, `Write execution readiness: ${intentId}`, "write-readiness plain output should include intent header");
  assertIncludes(output, `Status: ${expected.readinessStatus}`, "write-readiness plain output should include readiness status");
  assertIncludes(output, `Ready: ${expected.ready}`, "write-readiness plain output should include ready state");
  assertIncludes(output, "Execution: disabled", "write-readiness plain output should keep execution disabled");
  assertIncludes(output, "Write execution: disabled", "write-readiness plain output should keep write execution disabled");
  assertIncludes(
    output,
    `Inputs: auditBundle=available, preflight=${expected.preflight}`,
    "write-readiness plain output should include expected preflight state"
  );
  assertIncludes(output, "Checks:", "write-readiness plain output should include checks");
  assertIncludes(output, "Use --json for the stable automation contract.", "write-readiness plain output should recommend JSON for automation");
  assertNoUnsafePlainExecutionOutput(output);
}

function assertWriteReadinessPlainErrorOutput(output, expected) {
  assertIncludes(output, "Write readiness error:", "write-readiness plain error should include header");
  assertIncludes(output, `Code: ${expected.errorCode}`, "write-readiness plain error should include error code");
  assertIncludes(
    output,
    "Re-run with --json for machine-readable error details.",
    "write-readiness plain error should recommend JSON for automation"
  );
  if (expected.forbiddenText) {
    assertNotIncludes(
      output,
      expected.forbiddenText,
      "write-readiness plain error should not expose raw persisted file content"
    );
  }
  assertNoUnsafePlainExecutionOutput(output);
}

function assertExecutionAuditPlainOutput(output, intentId) {
  assertIncludes(output, `Execution audit: ${intentId}`, "execution-audit plain output should include intent header");
  assertIncludes(output, "Execution: disabled", "execution-audit plain output should keep execution disabled");
  assertIncludes(output, "Write execution: disabled", "execution-audit plain output should keep write execution disabled");
  assertIncludes(
    output,
    "Dry-run traces: 1 total, 1 planned, 0 blocked",
    "execution-audit plain output should include trace counts"
  );
  assertIncludes(output, "Trace summary:", "execution-audit plain output should include trace summary");
  assertNoUnsafePlainExecutionOutput(output);
}

function assertExecutionAuditPlainListOutput(output, expected) {
  assertIncludes(output, "Execution audit bundles", "execution-audit plain list should include header");
  assertIncludes(output, `Bundles: ${expected.bundleCount}`, "execution-audit plain list should include bundle count");
  assertIncludes(output, "Execution: disabled", "execution-audit plain list should keep execution disabled");
  assertIncludes(output, "Write execution: disabled", "execution-audit plain list should keep write execution disabled");
  assertIncludes(
    output,
    "Order: newest first by execution intent createdAt",
    "execution-audit plain list should include ordering note"
  );
  for (const intentId of expected.intentIds) {
    assertIncludes(output, `- ${intentId}`, "execution-audit plain list should include intent summary");
  }
  assertNoUnsafePlainExecutionOutput(output);
}

function assertExecutionAuditPlainErrorOutput(output, expected) {
  assertIncludes(output, "Execution audit error:", "execution-audit plain error should include header");
  assertIncludes(output, `Code: ${expected.errorCode}`, "execution-audit plain error should include error code");
  assertIncludes(
    output,
    "Re-run with --json for machine-readable error details.",
    "execution-audit plain error should recommend JSON for automation"
  );
  if (expected.forbiddenText) {
    assertNotIncludes(
      output,
      expected.forbiddenText,
      "execution-audit plain error should not expose raw persisted file content"
    );
  }
  assertNoUnsafePlainExecutionOutput(output);
}

function assertChecksReport(report) {
  assertEnvelope(report, "checks");
  assertEqual(report.source, "github", "checks JSON should preserve provider source");
}

function assertNoUnsafePlainExecutionOutput(output) {
  for (const fragment of ["executedCommands", "stdout", "stderr", "exitCode", "stack"]) {
    assertNotIncludes(output, fragment, "execution-audit plain output should not expose execution result fields");
  }
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

function assertNotIncludes(value, expected, message) {
  if (value.includes(expected)) {
    throw new Error(`${message}. Did not expect to find ${JSON.stringify(expected)} in:\n${value}`);
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

function assertNumber(value, message) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${message}. Expected a finite number, got ${JSON.stringify(value)}.`);
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

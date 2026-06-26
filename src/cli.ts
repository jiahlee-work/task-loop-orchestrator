#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { appendEvent } from "./audit.js";
import { createPullRequestApproval, preparePullRequestExecution } from "./approval.js";
import {
  type JiraConfig,
  loadOrchestratorConfig,
  normalizeExecutorMode,
  normalizeGitHubProviderMode,
  normalizePermissionMode,
  normalizeReviewerMode
} from "./config.js";
import { createCliJsonReport, type CliJsonCommand } from "./cli-json.js";
import type {
  ExecutionAuditErrorReport,
  ExecutorMode,
  GitHubProviderMode,
  PermissionMode,
  ReviewerMode,
  WriteReadinessErrorReport,
  WriteRunnerErrorReport
} from "./domain.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { CodexCliExecutor } from "./executors.js";
import {
  formatExecutionAuditBundle,
  formatExecutionAuditError,
  formatExecutionAuditList
} from "./execution-audit-format.js";
import {
  summarizeExecutionAuditBundle,
  summarizeExecutionAuditBundles,
  summarizeExecutionAuditList
} from "./execution-intents.js";
import { initProject } from "./init.js";
import { createIntegrationCheckpoint } from "./integration.js";
import { loadJiraConfigWithLocalEnv, readJiraEnvFile } from "./jira-env.js";
import { setupJiraMcp, type JiraSetupReport } from "./jira-setup.js";
import { RootOrchestrator, createTaskSpec } from "./orchestrator.js";
import { checkPermission } from "./permission.js";
import { createPullRequestPlan } from "./pr-plan.js";
import { createGitToolProviders, createTaskSpecFromJiraIssue, GitHubCliProvider, JiraCliProvider, JiraMcpProvider } from "./providers.js";
import { LocalEvidenceReviewer } from "./reviewers.js";
import { createMockRoleProviders, type RoleProviders } from "./roles.js";
import { createRunCliReport } from "./run-report.js";
import { FileRunStore } from "./store.js";
import {
  formatWriteExecutionReadiness,
  formatWriteReadinessError,
  loadWriteReadinessPreflightInput,
  type WriteReadinessPreflightLoadErrorCode,
  summarizeWriteExecutionReadiness
} from "./write-readiness.js";
import {
  createWriteRunnerDryRunTraces,
  createWriteRunnerErrorReport,
  formatWriteRunnerError,
  summarizeWriteRunnerDryRun
} from "./write-runner.js";

interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

interface RunInput {
  kind: "direct" | "jira";
  title?: string;
  jiraKey?: string;
  note?: string;
}

const jiraIssueKeyPattern = /^[A-Z][A-Z0-9]+-\d+$/;

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(value);
    }
  }

  return { command, positional, flags };
}

function stringFlag(flags: ParsedArgs["flags"], key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function numberFlag(flags: ParsedArgs["flags"], key: string): number | undefined {
  const value = stringFlag(flags, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function permissionFlag(value: string | undefined): PermissionMode {
  return normalizePermissionMode(value);
}

function executorFlag(value: string | undefined): ExecutorMode {
  return normalizeExecutorMode(value);
}

function reviewerFlag(value: string | undefined): ReviewerMode {
  return normalizeReviewerMode(value);
}

function githubFlag(value: string | undefined): GitHubProviderMode {
  return normalizeGitHubProviderMode(value);
}

function printUsage(): void {
  console.log(`Usage:
  task-loop-orchestrator --help
  task-loop-orchestrator --version
  task-loop-orchestrator init [--force] [--json]
  task-loop-orchestrator setup jira [--url url] [--username email] [--api-token token|--personal-token token] [--skip-check]
  task-loop-orchestrator doctor [jira] [--github none|gh-cli] [--json]
  task-loop-orchestrator run ISSUE-KEY [--note text] [--permission read|write|maintainer] [--executor mock|codex-cli-dry-run|codex-cli] [--reviewer mock|local-evidence] [--max-iterations n] [--json]
  task-loop-orchestrator run <instruction> [--description text] [--permission read|write|maintainer] [--executor mock|codex-cli-dry-run|codex-cli] [--reviewer mock|local-evidence] [--max-iterations n] [--json]
  task-loop-orchestrator status [runId] [--json] [--raw]
  task-loop-orchestrator resume <runId> [--max-iterations n] [--json]
  task-loop-orchestrator checkpoint [runId] [--github none|gh-cli] [--json]
  task-loop-orchestrator pr-plan [runId] [--json]
  task-loop-orchestrator approve-pr [runId] --approved-by name [--reason text] [--json]
  task-loop-orchestrator pr-exec [runId] [--execute] [--approval approvalId] [--approved-by name] [--json]
  task-loop-orchestrator execution-audit (--intent intentId|--all) [--json]
  task-loop-orchestrator write-readiness --intent intentId [--preflight path] [--json]
  task-loop-orchestrator write-runner --intent intentId [--preflight path] [--simulate|--execute] --json
  task-loop-orchestrator checks [ref] [--json]

Short alias:
  tlo setup jira
  tlo doctor jira
  tlo run ISSUE-KEY
  tlo run ISSUE-KEY --note "additional context"
  tlo run "direct task instruction"`);
}

function packageVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("Unable to read package version.");
  }

  return packageJson.version;
}

function printVersion(): void {
  console.log(`task-loop-orchestrator ${packageVersion()}`);
}

function printJson(command: CliJsonCommand, payload: object): void {
  console.log(JSON.stringify(createCliJsonReport(command, payload), null, 2));
}

function statusLabel(status: "pass" | "warn" | "fail"): "Success" | "Warning" | "Failed" {
  if (status === "pass") {
    return "Success";
  }
  if (status === "warn") {
    return "Warning";
  }

  return "Failed";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function printExecutionAuditError(
  errorCode:
    | "execution_intent_not_found"
    | "execution_audit_missing_intent"
    | "invalid_execution_intent_file"
    | "invalid_execution_trace_file",
  message: string,
  options: { status?: "not_found" | "error"; intentId?: string; details?: { kind: "execution_intent" | "execution_trace" } } = {}
): void {
  printJson("execution-audit", createExecutionAuditErrorReport(errorCode, message, options));
}

function createExecutionAuditErrorReport(
  errorCode:
    | "execution_intent_not_found"
    | "execution_audit_missing_intent"
    | "invalid_execution_intent_file"
    | "invalid_execution_trace_file",
  message: string,
  options: { status?: "not_found" | "error"; intentId?: string; details?: { kind: "execution_intent" | "execution_trace" } } = {}
): ExecutionAuditErrorReport {
  return {
    status: options.status ?? "error",
    errorCode,
    message,
    ...(options.intentId ? { intentId: options.intentId } : {}),
    ...(options.details ? { details: options.details } : {}),
    intent: null,
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

function printPlainExecutionAuditError(
  errorCode:
    | "execution_intent_not_found"
    | "execution_audit_missing_intent"
    | "invalid_execution_intent_file"
    | "invalid_execution_trace_file",
  message: string,
  options: { status?: "not_found" | "error"; intentId?: string; details?: { kind: "execution_intent" | "execution_trace" } } = {}
): void {
  process.stdout.write(formatExecutionAuditError(createExecutionAuditErrorReport(errorCode, message, options)));
  process.exitCode = 1;
}

type WriteReadinessErrorCode = WriteReadinessErrorReport["errorCode"];

function printWriteReadinessError(
  errorCode: WriteReadinessErrorCode,
  message: string,
  options: {
    status?: WriteReadinessErrorReport["status"];
    intentId?: string;
    details?: WriteReadinessErrorReport["details"];
  } = {}
): void {
  printJson("write-readiness", createWriteReadinessErrorReport(errorCode, message, options));
}

function printPlainWriteReadinessError(
  errorCode: WriteReadinessErrorCode,
  message: string,
  options: {
    status?: WriteReadinessErrorReport["status"];
    intentId?: string;
    details?: WriteReadinessErrorReport["details"];
  } = {}
): void {
  process.stdout.write(formatWriteReadinessError(createWriteReadinessErrorReport(errorCode, message, options)));
  process.exitCode = 1;
}

function createWriteReadinessErrorReport(
  errorCode: WriteReadinessErrorCode,
  message: string,
  options: {
    status?: WriteReadinessErrorReport["status"];
    intentId?: string;
    details?: WriteReadinessErrorReport["details"];
  } = {}
): WriteReadinessErrorReport {
  return {
    status: options.status ?? "error",
    errorCode,
    message,
    ...(options.intentId ? { intentId: options.intentId } : {}),
    ...(options.details ? { details: options.details } : {}),
    readiness: null,
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

type WriteRunnerErrorCode = WriteRunnerErrorReport["errorCode"];

function printWriteRunnerError(
  errorCode: WriteRunnerErrorCode,
  message: string,
  options: {
    status?: WriteRunnerErrorReport["status"];
    intentId?: string;
    details?: WriteRunnerErrorReport["details"];
  } = {}
): void {
  printJson("write-runner", createWriteRunnerErrorReport(errorCode, message, options));
}

function printPlainWriteRunnerError(
  errorCode: WriteRunnerErrorCode,
  message: string,
  options: {
    status?: WriteRunnerErrorReport["status"];
    intentId?: string;
    details?: WriteRunnerErrorReport["details"];
  } = {}
): void {
  process.stdout.write(formatWriteRunnerError(createWriteRunnerErrorReport(errorCode, message, options)));
  process.exitCode = 1;
}

async function doctorCommand(args: ParsedArgs): Promise<void> {
  const githubMode = stringFlag(args.flags, "github") ? githubFlag(stringFlag(args.flags, "github")) : "none";
  const jiraEnabled = args.flags.jira === true || args.positional.includes("jira");
  const config =
    jiraEnabled
      ? await loadOrchestratorConfig(process.cwd())
          .then((loadedConfig) => loadJiraConfigWithLocalEnv(process.cwd(), loadedConfig.jira))
          .catch(() => undefined)
      : undefined;
  const report = await runDoctor(process.cwd(), { githubMode, jira: jiraEnabled, jiraConfig: config });

  if (args.flags.json === true) {
    printJson("doctor", report);
    return;
  }

  printDoctorReport(report);
}

function printDoctorReport(report: DoctorReport): void {
  console.log(`${statusLabel(report.status)}: Doctor`);
  console.log("");
  console.log("Checks:");
  for (const check of report.checks) {
    console.log(`- [${check.status}] ${check.id}: ${check.summary}`);
  }

  console.log("");
  console.log("Result:");
  console.log(`- Root: ${report.rootDir}`);
  console.log(`- Status: ${report.status}`);

  const nextActions = uniqueStrings(
    report.checks.flatMap((check) => [
      ...(check.recommendedAction ? [check.recommendedAction] : []),
      ...(check.suggestions ?? []).map((suggestion) => `${suggestion.command.join(" ")} - ${suggestion.reason}`)
    ])
  );

  if (nextActions.length > 0) {
    console.log("");
    console.log("Next:");
    for (const action of nextActions) {
      console.log(`- ${action}`);
    }
  } else {
    const hasJiraChecks = report.checks.some((check) => check.id.startsWith("jira_"));
    console.log("");
    console.log("Next:");
    console.log(hasJiraChecks ? "- tlo run ISSUE-KEY - read a Jira issue and start the planner run." : '- tlo run "task instruction" - start a planner run from direct text.');
  }
}

async function initCommand(args: ParsedArgs): Promise<void> {
  const report = await initProject(process.cwd(), {
    force: args.flags.force === true
  });

  if (args.flags.json === true) {
    printJson("init", report);
    return;
  }

  console.log("Initialized task-loop-orchestrator project files.");
  console.log(`Config: ${report.files.config.status} ${report.files.config.path}`);
  if (report.files.config.reason) {
    console.log(`- ${report.files.config.reason}`);
  }
  console.log(`Gitignore: ${report.files.gitignore.status} ${report.files.gitignore.path}`);
  if (report.files.gitignore.reason) {
    console.log(`- ${report.files.gitignore.reason}`);
  }
}

async function jiraCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positional[0];
  if (subcommand !== "setup") {
    throw new Error("jira requires a subcommand: setup. Prefer: tlo setup jira.");
  }

  const report = await jiraSetupCommand(args);
  printJiraSetupReport(report);
}

async function jiraSetupCommand(args: ParsedArgs): Promise<JiraSetupReport> {
  const existingEnv = await readJiraEnvFile(process.cwd());
  const url = stringFlag(args.flags, "url") ?? (await promptValue("Jira site URL", existingEnv.JIRA_URL));
  const personalToken = stringFlag(args.flags, "personal-token");

  if (personalToken) {
    return setupJiraMcp({
      rootDir: process.cwd(),
      url,
      personalToken,
      skipCheck: args.flags["skip-check"] === true
    });
  }

  const username = stringFlag(args.flags, "username") ?? (await promptValue("Jira email", existingEnv.JIRA_USERNAME));
  const apiToken =
    stringFlag(args.flags, "api-token") ??
    (await promptSecret("Jira API token", existingEnv.JIRA_API_TOKEN ? "leave blank to keep existing" : undefined)) ??
    existingEnv.JIRA_API_TOKEN;

  return setupJiraMcp({
    rootDir: process.cwd(),
    url,
    username,
    apiToken,
    skipCheck: args.flags["skip-check"] === true
  });
}

function printJiraSetupReport(report: JiraSetupReport): void {
  console.log(`${report.status === "ready" ? "Success" : "Warning"}: Jira setup`);
  console.log("");
  console.log("Result:");
  console.log(`- Env file: ${report.envFile}`);
  console.log(`- Auth mode: ${report.authMode}`);
  console.log(`- MCP check: [${report.mcpCheck.status}] ${report.mcpCheck.summary}`);
  console.log("");
  console.log("Next:");
  console.log(`- ${report.nextCommand} - ${report.status === "ready" ? "start a run from a Jira issue." : "check Jira MCP setup before starting a run."}`);
}

async function promptValue(label: string, defaultValue?: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${label} is required. Pass it with a flag in non-interactive mode.`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    return answer || defaultValue || "";
  } finally {
    rl.close();
  }
}

async function promptSecret(label: string, hint?: string): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${label} is required. Pass it with a flag in non-interactive mode.`);
  }

  const output = new HiddenPromptOutput();
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const suffix = hint ? ` (${hint})` : "";
    process.stdout.write(`${label}${suffix}: `);
    output.muted = true;
    const answer = (await rl.question("")).trim();
    process.stdout.write("\n");
    return answer || undefined;
  } finally {
    output.muted = false;
    rl.close();
  }
}

class HiddenPromptOutput extends Writable {
  muted = false;

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.muted) {
      process.stdout.write(chunk, encoding);
    }
    callback();
  }
}

async function runCommand(args: ParsedArgs): Promise<void> {
  const input = parseRunInput(args);
  if (input.kind === "direct" && !input.title) {
    throw new Error('run requires a Jira issue key or direct task instruction. Examples: tlo run OUC-10, tlo run "직접 작업 설명".');
  }

  const store = new FileRunStore(process.cwd());
  const config = await loadOrchestratorConfig(process.cwd());
  const jiraConfig = await loadJiraConfigWithLocalEnv(process.cwd(), config.jira);
  const executorMode = stringFlag(args.flags, "executor") ? executorFlag(stringFlag(args.flags, "executor")) : config.executor;
  const reviewerMode = stringFlag(args.flags, "reviewer") ? reviewerFlag(stringFlag(args.flags, "reviewer")) : config.reviewer;
  const permissionMode = stringFlag(args.flags, "permission") ? permissionFlag(stringFlag(args.flags, "permission")) : config.permissionMode;
  const taskSpec = input.kind === "jira" && input.jiraKey
    ? await createTaskSpecFromJiraKey(input.jiraKey, permissionMode, jiraConfig, input.note)
    : createTaskSpec({
        title: input.title ?? "",
        description: stringFlag(args.flags, "description") ?? input.note,
        permissionMode
      });
  const orchestrator = new RootOrchestrator({
    store,
    roles: createRoleProviders(executorMode, reviewerMode),
    tools: createGitToolProviders(process.cwd()),
    maxIterations: numberFlag(args.flags, "max-iterations") ?? config.maxIterations,
    worktreeEnabled: config.worktree.enabled
  });
  const run = await orchestrator.runTask(taskSpec);

  if (args.flags.json === true) {
    printJson("run", createRunCliReport(run, store));
    return;
  }

  printRunReport(run, store, input, executorMode, reviewerMode);
}

function parseRunInput(args: ParsedArgs): RunInput {
  const explicitJiraKey = stringFlag(args.flags, "jira");
  const flagNote = stringFlag(args.flags, "note");
  if (explicitJiraKey) {
    const inlineNote = args.positional.join(" ").trim();
    return {
      kind: "jira",
      jiraKey: explicitJiraKey,
      note: flagNote ?? (inlineNote || undefined)
    };
  }

  const [first, ...rest] = args.positional;
  if (isJiraIssueKey(first)) {
    const restNote = rest[0] === "with" ? rest.slice(1).join(" ").trim() : rest.join(" ").trim();
    return {
      kind: "jira",
      jiraKey: first,
      note: flagNote ?? (restNote || undefined)
    };
  }

  return {
    kind: "direct",
    title: args.positional.join(" ").trim(),
    note: flagNote
  };
}

function isJiraIssueKey(value: string | undefined): boolean {
  return typeof value === "string" && jiraIssueKeyPattern.test(value);
}

async function createTaskSpecFromJiraKey(
  jiraKey: string,
  permissionMode: PermissionMode,
  jiraConfig: JiraConfig,
  note?: string
) {
  const primaryProvider =
    jiraConfig.provider === "mcp-atlassian"
      ? new JiraMcpProvider(jiraConfig.mcp, process.cwd())
      : new JiraCliProvider(process.cwd());
  const issue = await primaryProvider.getIssue(jiraKey);
  if (issue) {
    return createTaskSpecFromJiraIssue(issue, permissionMode, note);
  }

  if (jiraConfig.provider === "mcp-atlassian" && jiraConfig.fallback === "cli") {
    const fallbackIssue = await new JiraCliProvider(process.cwd()).getIssue(jiraKey);
    if (fallbackIssue) {
      return createTaskSpecFromJiraIssue(fallbackIssue, permissionMode, note);
    }
  }

  if (jiraConfig.provider === "mcp-atlassian") {
    throw new Error(
      [
        "Failed: Run from Jira issue",
        "",
        "Reason:",
        `- Jira issue ${jiraKey} was not found or could not be read.`,
        `- Jira MCP did not return ${jiraConfig.mcp.toolName}, and Jira CLI fallback did not read the issue.`,
        "",
        "Next:",
        "- tlo doctor jira - check Jira credentials, uvx, MCP server startup, and tool exposure.",
        `- Confirm that ${jiraKey} exists and your Jira account can read it.`
      ].join("\n")
    );
  }

  throw new Error(
    [
      "Failed: Run from Jira issue",
      "",
      "Reason:",
      `- Jira issue ${jiraKey} was not found or could not be read through Jira CLI.`,
      "",
      "Next:",
      "- jira init - authenticate the Jira CLI.",
      `- jira issue view ${jiraKey} --raw - verify that the issue is readable.`
    ].join("\n")
  );
}

function printRunReport(
  run: Awaited<ReturnType<RootOrchestrator["runTask"]>>,
  store: FileRunStore,
  input: RunInput,
  executorMode: ExecutorMode,
  reviewerMode: ReviewerMode
): void {
  const completed = run.graph.subtasks.filter((subtask) => subtask.status === "completed").length;
  const label = run.status === "completed" ? "Success" : run.status === "failed" ? "Failed" : "Warning";

  console.log(`${label}: Run ${run.status}`);
  console.log("");
  console.log("Input:");
  if (input.kind === "jira") {
    console.log(`- Source: Jira issue ${input.jiraKey}`);
    if (input.note) {
      console.log(`- Note: ${input.note}`);
    }
  } else {
    console.log(`- Source: direct instruction`);
  }
  console.log(`- Task: ${run.spec.title}`);

  console.log("");
  console.log("Planner:");
  console.log("- Provider: mock");
  console.log(`- Subtasks: ${run.graph.subtasks.length}`);

  console.log("");
  console.log("Result:");
  console.log(`- Run ID: ${run.id}`);
  console.log(`- Iterations: ${run.iterations}`);
  console.log(`- Subtasks completed: ${completed}/${run.graph.subtasks.length}`);
  console.log(`- Executor: ${executorMode}`);
  console.log(`- Reviewer: ${reviewerMode}`);
  console.log(`- Saved: ${store.pathForRun(run.id)}`);

  console.log("");
  console.log("Next:");
  console.log(`- tlo status ${run.id} - inspect this run.`);
  if (run.status !== "completed") {
    console.log(`- tlo resume ${run.id} - continue the run.`);
  }
}

async function statusCommand(args: ParsedArgs): Promise<void> {
  const store = new FileRunStore(process.cwd());
  const runId = args.positional[0];
  const run = runId ? await store.load(runId) : await store.latest();

  if (!run) {
    if (args.flags.json === true) {
      printJson("status", {
        status: "not_found",
        run: null,
        message: 'No runs found. Start one with tlo run "task instruction" --json.'
      });
      return;
    }

    console.log("No runs found.");
    return;
  }

  if (args.flags.json === true) {
    printJson("status", args.flags.raw === true ? run : createRunCliReport(run, store));
    return;
  }

  const completed = run.graph.subtasks.filter((subtask) => subtask.status === "completed").length;
  console.log(`Run ${run.id}: ${run.status}`);
  console.log(`Task: ${run.spec.title}`);
  console.log(`Iterations: ${run.iterations}`);
  console.log(`Subtasks: ${completed}/${run.graph.subtasks.length} completed`);
  if (run.graph.nextCandidateId) {
    console.log(`Next: ${run.graph.nextCandidateId}`);
  }
  const recentEvents = run.events.slice(-3);
  if (recentEvents.length > 0) {
    console.log("Recent events:");
    for (const event of recentEvents) {
      console.log(`- ${event.kind}: ${event.message}`);
    }
  }
}

async function resumeCommand(args: ParsedArgs): Promise<void> {
  const runId = args.positional[0];
  if (!runId) {
    throw new Error("resume requires a runId.");
  }

  const store = new FileRunStore(process.cwd());
  const config = await loadOrchestratorConfig(process.cwd());
  const orchestrator = new RootOrchestrator({
    store,
    roles: createRoleProviders(config.executor, config.reviewer),
    tools: createGitToolProviders(process.cwd()),
    maxIterations: numberFlag(args.flags, "max-iterations") ?? config.maxIterations,
    worktreeEnabled: config.worktree.enabled
  });
  let run;
  try {
    run = await orchestrator.resume(runId);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    const message = `Run ${runId} was not found. Use tlo status --json to inspect the latest run, or start one with tlo run "task instruction" --json.`;
    if (args.flags.json === true) {
      printJson("resume", {
        status: "not_found",
        runId,
        run: null,
        message
      });
    } else {
      console.log(message);
    }
    process.exitCode = 1;
    return;
  }

  if (args.flags.json === true) {
    printJson("resume", createRunCliReport(run, store));
    return;
  }

  console.log(`Run ${run.id}: ${run.status}`);
  console.log(`Iterations: ${run.iterations}`);
  console.log(`Saved: ${store.pathForRun(run.id)}`);
}

async function checkpointCommand(args: ParsedArgs): Promise<void> {
  const store = new FileRunStore(process.cwd());
  const config = await loadOrchestratorConfig(process.cwd());
  const runId = args.positional[0];
  let run = runId ? await store.load(runId) : await store.latest();

  if (!run) {
    if (args.flags.json === true) {
      printJson("checkpoint", {
        status: "not_found",
        run: null
      });
      return;
    }

    console.log("No runs found.");
    return;
  }

  const permission = checkPermission(run.permissionMode, "read_state");
  if (!permission.allowed) {
    throw new Error(`Checkpoint requires read_state permission: ${permission.reason}`);
  }

  const githubMode = stringFlag(args.flags, "github") ? githubFlag(stringFlag(args.flags, "github")) : config.github;
  const tools = createGitToolProviders(
    process.cwd(),
    githubMode === "gh-cli" ? new GitHubCliProvider(process.cwd()) : undefined
  );
  const report = await createIntegrationCheckpoint({
    run,
    repo: tools.repo,
    github: tools.github,
    jira: tools.jira
  });
  await store.saveCheckpoint(report);
  run = appendEvent(run, {
    kind: "integration_checkpoint_ready",
    message: `Integration checkpoint ${report.id} is ready: ${report.status}.`,
    role: "root",
    data: {
      checkpointId: report.id,
      status: report.status,
      recommendedNextAction: report.recommendedNextAction
    }
  });
  await store.save(run);

  if (args.flags.json === true) {
    printJson("checkpoint", report);
    return;
  }

  console.log(`Checkpoint ${report.id}: ${report.status}`);
  console.log(`Run: ${report.runId}`);
  console.log(
    `Subtasks: ${report.counts.completed} completed, ${report.counts.pending} pending, ${report.counts.blocked} blocked`
  );
  console.log(`Recommended next action: ${report.recommendedNextAction}`);
  console.log(`Saved: ${store.pathForCheckpoint(report.id)}`);
}

async function checksCommand(args: ParsedArgs): Promise<void> {
  const ref = args.positional[0] ?? "HEAD";
  const provider = new GitHubCliProvider(process.cwd());
  const summary = await provider.getCheckStatus(ref);

  if (args.flags.json === true) {
    printJson("checks", summary);
    return;
  }

  console.log(`Checks ${summary.ref ?? ref}: ${summary.status}`);
  console.log(summary.summary);
  if (summary.details && summary.details.length > 0) {
    console.log("Details:");
    for (const detail of summary.details) {
      console.log(`- ${detail.name}: ${detail.status}${detail.summary ? ` (${detail.summary})` : ""}`);
    }
  }
}

async function prPlanCommand(args: ParsedArgs): Promise<void> {
  const store = new FileRunStore(process.cwd());
  const runId = args.positional[0];
  const run = runId ? await store.load(runId) : await store.latest();

  if (!run) {
    if (args.flags.json === true) {
      printJson("pr-plan", {
        status: "not_found",
        run: null
      });
      return;
    }

    console.log("No runs found.");
    return;
  }

  const checkpoint = await store.latestCheckpoint(run.id);
  const tools = createGitToolProviders(process.cwd());
  const plan = await createPullRequestPlan({
    run,
    repo: tools.repo,
    checkpoint
  });

  if (args.flags.json === true) {
    printJson("pr-plan", plan);
    return;
  }

  console.log(`PR plan ${plan.id}`);
  console.log(`Run: ${plan.runId}`);
  console.log(`Checkpoint: ${plan.checkpointId ?? "none"}`);
  console.log(`Branch hint: ${plan.sourceBranchHint}`);
  console.log(`Base branch: ${plan.baseBranch}`);
  if (plan.blockedReasons.length > 0) {
    console.log("Blocked reasons:");
    for (const reason of plan.blockedReasons) {
      console.log(`- ${reason}`);
    }
  } else {
    console.log("Blocked reasons: none");
  }
  console.log("Command candidates:");
  for (const candidate of plan.commandCandidates) {
    console.log(`- ${candidate.action}: ${candidate.command.join(" ")}`);
  }
}

async function prExecCommand(args: ParsedArgs): Promise<void> {
  const store = new FileRunStore(process.cwd());
  const runId = args.positional[0];
  const run = runId ? await store.load(runId) : await store.latest();

  if (!run) {
    if (args.flags.json === true) {
      printJson("pr-exec", {
        status: "not_found",
        run: null
      });
      return;
    }

    console.log("No runs found.");
    return;
  }

  const checkpoint = await store.latestCheckpoint(run.id);
  const tools = createGitToolProviders(process.cwd());
  const plan = await createPullRequestPlan({
    run,
    repo: tools.repo,
    checkpoint
  });
  const approvedBy = stringFlag(args.flags, "approved-by");
  const approval = await resolveApprovalForPrExec(store, args, plan, approvedBy);
  const report = preparePullRequestExecution({
    plan,
    approval,
    mode: args.flags.execute === true ? "execute" : "dry-run"
  });

  if (args.flags.json === true) {
    printJson("pr-exec", report);
    return;
  }

  console.log(`PR execution preflight ${report.id}: ${report.status}`);
  console.log(report.message);
  if (report.blockedReasons.length > 0) {
    console.log("Blocked reasons:");
    for (const reason of report.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }
  console.log("Command candidates:");
  for (const candidate of report.commandCandidates) {
    console.log(`- ${candidate.action}: ${candidate.command.join(" ")}`);
  }
}

async function approvePrCommand(args: ParsedArgs): Promise<void> {
  const store = new FileRunStore(process.cwd());
  const runId = args.positional[0];
  const run = runId ? await store.load(runId) : await store.latest();

  if (!run) {
    if (args.flags.json === true) {
      printJson("approve-pr", {
        status: "not_found",
        run: null
      });
      return;
    }

    console.log("No runs found.");
    return;
  }

  const approvedBy = stringFlag(args.flags, "approved-by");
  if (!approvedBy?.trim()) {
    throw new Error("approve-pr requires --approved-by.");
  }

  const checkpoint = await store.latestCheckpoint(run.id);
  const tools = createGitToolProviders(process.cwd());
  const plan = await createPullRequestPlan({
    run,
    repo: tools.repo,
    checkpoint
  });
  const approval = createPullRequestApproval(plan, {
    approvedBy,
    reason: stringFlag(args.flags, "reason")
  });
  await store.saveApproval(approval);

  if (args.flags.json === true) {
    printJson("approve-pr", approval);
    return;
  }

  console.log(`Approval ${approval.id}: ${approval.status}`);
  console.log(`Run: ${approval.runId}`);
  console.log(`Plan: ${approval.planId}`);
  console.log(`Approved by: ${approval.approvedBy}`);
  console.log(`Saved: ${store.pathForApproval(approval.id)}`);
}

async function executionAuditCommand(args: ParsedArgs): Promise<void> {
  const jsonOutput = args.flags.json === true;

  if (args.flags.all === true) {
    const store = new FileRunStore(process.cwd());
    let intents: Awaited<ReturnType<FileRunStore["listExecutionIntents"]>>;
    try {
      intents = await store.listExecutionIntents();
    } catch (error) {
      if (isInvalidExecutionIntentFileError(error)) {
        printExecutionAuditErrorForMode(jsonOutput, "invalid_execution_intent_file", "Execution intent file is invalid.", {
          details: { kind: "execution_intent" }
        });
        return;
      }
      throw error;
    }

    let traces: Awaited<ReturnType<FileRunStore["listExecutionTraces"]>>;
    try {
      traces = await store.listExecutionTraces();
    } catch (error) {
      if (isInvalidExecutionTraceFileError(error)) {
        printExecutionAuditErrorForMode(jsonOutput, "invalid_execution_trace_file", "Execution trace file is invalid.", {
          details: { kind: "execution_trace" }
        });
        return;
      }
      throw error;
    }

    const report = summarizeExecutionAuditList(summarizeExecutionAuditBundles(intents, traces));
    if (jsonOutput) {
      printJson("execution-audit", report);
    } else {
      process.stdout.write(formatExecutionAuditList(report));
    }
    return;
  }

  const intentId = stringFlag(args.flags, "intent");
  if (!intentId?.trim()) {
    printExecutionAuditErrorForMode(
      jsonOutput,
      "execution_audit_missing_intent",
      "execution-audit requires --intent <intentId> or --all."
    );
    return;
  }

  const store = new FileRunStore(process.cwd());
  let intent: Awaited<ReturnType<FileRunStore["loadExecutionIntent"]>>;
  try {
    intent = await store.loadExecutionIntent(intentId);
  } catch (error) {
    if (isMissingFileError(error)) {
      printExecutionAuditErrorForMode(jsonOutput, "execution_intent_not_found", "Execution intent was not found.", {
        status: "not_found",
        intentId
      });
      return;
    }
    if (isInvalidExecutionIntentFileError(error)) {
      printExecutionAuditErrorForMode(jsonOutput, "invalid_execution_intent_file", "Execution intent file is invalid.", {
        intentId,
        details: { kind: "execution_intent" }
      });
      return;
    }
    throw error;
  }

  let traces: Awaited<ReturnType<FileRunStore["listExecutionTraces"]>>;
  try {
    traces = await store.listExecutionTraces();
  } catch (error) {
    if (isInvalidExecutionTraceFileError(error)) {
      printExecutionAuditErrorForMode(jsonOutput, "invalid_execution_trace_file", "Execution trace file is invalid.", {
        intentId,
        details: { kind: "execution_trace" }
      });
      return;
    }
    throw error;
  }
  const bundle = summarizeExecutionAuditBundle(intent, traces);
  if (jsonOutput) {
    printJson("execution-audit", bundle);
  } else {
    process.stdout.write(formatExecutionAuditBundle(bundle));
  }
}

async function writeReadinessCommand(args: ParsedArgs): Promise<void> {
  const jsonOutput = args.flags.json === true;
  const preflightFlagPresent = Object.hasOwn(args.flags, "preflight");
  const preflightPath = stringFlag(args.flags, "preflight");

  const intentId = stringFlag(args.flags, "intent");
  if (!intentId?.trim()) {
    printWriteReadinessErrorForMode(
      jsonOutput,
      "write_readiness_missing_intent",
      "write-readiness requires --intent <intentId>."
    );
    return;
  }

  if (preflightFlagPresent && !preflightPath?.trim()) {
    printWriteReadinessErrorForMode(
      jsonOutput,
      "write_readiness_preflight_missing_path",
      "write-readiness --preflight requires a path.",
      {
        intentId,
        details: { kind: "preflight" }
      }
    );
    return;
  }

  const store = new FileRunStore(process.cwd());
  let intent: Awaited<ReturnType<FileRunStore["loadExecutionIntent"]>>;
  try {
    intent = await store.loadExecutionIntent(intentId);
  } catch (error) {
    if (isMissingFileError(error)) {
      printWriteReadinessErrorForMode(jsonOutput, "write_readiness_intent_not_found", "Execution intent was not found.", {
        status: "not_found",
        intentId
      });
      return;
    }
    if (isInvalidExecutionIntentFileError(error)) {
      printWriteReadinessErrorForMode(jsonOutput, "invalid_execution_intent_file", "Execution intent file is invalid.", {
        intentId,
        details: { kind: "execution_intent" }
      });
      return;
    }
    throw error;
  }

  let traces: Awaited<ReturnType<FileRunStore["listExecutionTraces"]>>;
  try {
    traces = await store.listExecutionTraces();
  } catch (error) {
    if (isInvalidExecutionTraceFileError(error)) {
      printWriteReadinessErrorForMode(jsonOutput, "invalid_execution_trace_file", "Execution trace file is invalid.", {
        intentId,
        details: { kind: "execution_trace" }
      });
      return;
    }
    throw error;
  }

  const bundle = summarizeExecutionAuditBundle(intent, traces);
  let preflight: Parameters<typeof summarizeWriteExecutionReadiness>[1];
  if (preflightPath?.trim()) {
    const loadedPreflight = await loadWriteReadinessPreflightInput(preflightPath);
    if (!loadedPreflight.ok) {
      printWriteReadinessErrorForMode(
        jsonOutput,
        writeReadinessPreflightErrorCode(loadedPreflight.errorCode),
        writeReadinessPreflightErrorMessage(loadedPreflight.errorCode),
        {
          intentId,
          details: { kind: "preflight" }
        }
      );
      return;
    }
    preflight = loadedPreflight.preflight;
  }

  const report = summarizeWriteExecutionReadiness(bundle, preflight);
  if (jsonOutput) {
    printJson("write-readiness", report);
  } else {
    process.stdout.write(formatWriteExecutionReadiness(report));
  }
}

async function writeRunnerCommand(args: ParsedArgs): Promise<void> {
  const jsonOutput = args.flags.json === true;
  const preflightFlagPresent = Object.hasOwn(args.flags, "preflight");
  const preflightPath = stringFlag(args.flags, "preflight");

  if (!jsonOutput) {
    printPlainWriteRunnerError(
      "write_runner_requires_json",
      "write-runner dry-run output requires --json in this boundary milestone."
    );
    return;
  }

  const intentId = stringFlag(args.flags, "intent");
  if (!intentId?.trim()) {
    printWriteRunnerError("write_runner_missing_intent", "write-runner requires --intent <intentId>.");
    return;
  }

  if (preflightFlagPresent && !preflightPath?.trim()) {
    printWriteRunnerError("write_runner_preflight_missing_path", "write-runner --preflight requires a path.", {
      intentId,
      details: { kind: "preflight" }
    });
    return;
  }

  const store = new FileRunStore(process.cwd());
  let intent: Awaited<ReturnType<FileRunStore["loadExecutionIntent"]>>;
  try {
    intent = await store.loadExecutionIntent(intentId);
  } catch (error) {
    if (isMissingFileError(error)) {
      printWriteRunnerError("write_runner_intent_not_found", "Execution intent was not found.", {
        status: "not_found",
        intentId
      });
      return;
    }
    if (isInvalidExecutionIntentFileError(error)) {
      printWriteRunnerError("invalid_execution_intent_file", "Execution intent file is invalid.", {
        intentId,
        details: { kind: "execution_intent" }
      });
      return;
    }
    throw error;
  }

  let traces: Awaited<ReturnType<FileRunStore["listExecutionTraces"]>>;
  try {
    traces = await store.listExecutionTraces();
  } catch (error) {
    if (isInvalidExecutionTraceFileError(error)) {
      printWriteRunnerError("invalid_execution_trace_file", "Execution trace file is invalid.", {
        intentId,
        details: { kind: "execution_trace" }
      });
      return;
    }
    throw error;
  }

  const bundle = summarizeExecutionAuditBundle(intent, traces);
  let preflight: Parameters<typeof summarizeWriteExecutionReadiness>[1];
  if (preflightPath?.trim()) {
    const loadedPreflight = await loadWriteReadinessPreflightInput(preflightPath);
    if (!loadedPreflight.ok) {
      printWriteRunnerError(
        writeRunnerPreflightErrorCode(loadedPreflight.errorCode),
        writeReadinessPreflightErrorMessage(loadedPreflight.errorCode),
        {
          intentId,
          details: { kind: "preflight" }
        }
      );
      return;
    }
    preflight = loadedPreflight.preflight;
  }

  const readiness = summarizeWriteExecutionReadiness(bundle, preflight);
  const mode = args.flags.execute === true ? "execute_disabled" : args.flags.simulate === true ? "simulate" : "dry_run";
  const dryRunTraces = mode === "execute_disabled" ? [] : createWriteRunnerDryRunTraces(intent, readiness);
  for (const trace of dryRunTraces) {
    await store.saveExecutionTrace(trace);
  }

  printJson(
    "write-runner",
    summarizeWriteRunnerDryRun(intent, readiness, dryRunTraces, {
      localTracePersistence: dryRunTraces.length > 0 ? "saved" : "skipped",
      mode
    })
  );
}

function writeRunnerPreflightErrorCode(errorCode: WriteReadinessPreflightLoadErrorCode): WriteRunnerErrorCode {
  if (errorCode === "preflight_file_not_found") {
    return "write_runner_preflight_file_not_found";
  }
  if (errorCode === "preflight_file_not_readable") {
    return "write_runner_preflight_file_not_readable";
  }
  if (errorCode === "preflight_invalid_json") {
    return "write_runner_preflight_invalid_json";
  }

  return "write_runner_preflight_invalid_schema";
}

function writeReadinessPreflightErrorCode(errorCode: WriteReadinessPreflightLoadErrorCode): WriteReadinessErrorCode {
  if (errorCode === "preflight_file_not_found") {
    return "write_readiness_preflight_file_not_found";
  }
  if (errorCode === "preflight_file_not_readable") {
    return "write_readiness_preflight_file_not_readable";
  }
  if (errorCode === "preflight_invalid_json") {
    return "write_readiness_preflight_invalid_json";
  }

  return "write_readiness_preflight_invalid_schema";
}

function writeReadinessPreflightErrorMessage(errorCode: WriteReadinessPreflightLoadErrorCode): string {
  if (errorCode === "preflight_file_not_found") {
    return "Preflight input file was not found.";
  }
  if (errorCode === "preflight_file_not_readable") {
    return "Preflight input file could not be read.";
  }
  if (errorCode === "preflight_invalid_json") {
    return "Preflight input file must contain valid JSON.";
  }

  return "Preflight input file does not match the write-readiness preflight contract.";
}

function printWriteReadinessErrorForMode(
  jsonOutput: boolean,
  errorCode: WriteReadinessErrorCode,
  message: string,
  options: {
    status?: WriteReadinessErrorReport["status"];
    intentId?: string;
    details?: WriteReadinessErrorReport["details"];
  } = {}
): void {
  if (jsonOutput) {
    printWriteReadinessError(errorCode, message, options);
  } else {
    printPlainWriteReadinessError(errorCode, message, options);
  }
}

function printExecutionAuditErrorForMode(
  jsonOutput: boolean,
  errorCode:
    | "execution_intent_not_found"
    | "execution_audit_missing_intent"
    | "invalid_execution_intent_file"
    | "invalid_execution_trace_file",
  message: string,
  options: { status?: "not_found" | "error"; intentId?: string; details?: { kind: "execution_intent" | "execution_trace" } } = {}
): void {
  if (jsonOutput) {
    printExecutionAuditError(errorCode, message, options);
  } else {
    printPlainExecutionAuditError(errorCode, message, options);
  }
}

function isMissingFileError(error: unknown): error is { code: "ENOENT" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isInvalidExecutionIntentFileError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true;
  }

  const message = error instanceof Error ? error.message : "";
  return message.startsWith("Invalid execution intent");
}

function isInvalidExecutionTraceFileError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true;
  }

  const message = error instanceof Error ? error.message : "";
  return message.startsWith("Invalid execution trace") || message.startsWith("Invalid execution intent");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === "--help" || args.command === "-h") {
    printUsage();
    return;
  }

  if (args.command === "--version" || args.command === "-v") {
    printVersion();
    return;
  }

  if (args.command === "run") {
    await runCommand(args);
    return;
  }

  if (args.command === "init") {
    await initCommand(args);
    return;
  }

  if (args.command === "jira") {
    await jiraCommand(args);
    return;
  }

  if (args.command === "setup" && args.positional[0] === "jira") {
    const report = await jiraSetupCommand(args);
    printJiraSetupReport(report);
    return;
  }

  if (args.command === "doctor") {
    await doctorCommand(args);
    return;
  }

  if (args.command === "status") {
    await statusCommand(args);
    return;
  }

  if (args.command === "resume") {
    await resumeCommand(args);
    return;
  }

  if (args.command === "checkpoint") {
    await checkpointCommand(args);
    return;
  }

  if (args.command === "checks") {
    await checksCommand(args);
    return;
  }

  if (args.command === "pr-plan") {
    await prPlanCommand(args);
    return;
  }

  if (args.command === "pr-exec") {
    await prExecCommand(args);
    return;
  }

  if (args.command === "approve-pr") {
    await approvePrCommand(args);
    return;
  }

  if (args.command === "execution-audit") {
    await executionAuditCommand(args);
    return;
  }

  if (args.command === "write-readiness") {
    await writeReadinessCommand(args);
    return;
  }

  if (args.command === "write-runner") {
    await writeRunnerCommand(args);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

async function resolveApprovalForPrExec(
  store: FileRunStore,
  args: ParsedArgs,
  plan: Awaited<ReturnType<typeof createPullRequestPlan>>,
  approvedBy: string | undefined
) {
  const approvalId = stringFlag(args.flags, "approval");
  if (approvalId) {
    return store.loadApproval(approvalId);
  }

  if (approvedBy) {
    return createPullRequestApproval(plan, { approvedBy, reason: stringFlag(args.flags, "reason") });
  }

  return store.latestApprovalForRun(plan.runId);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function createRoleProviders(executorMode: ExecutorMode, reviewerMode: ReviewerMode): RoleProviders {
  const roles = createMockRoleProviders();
  const executor =
    executorMode === "mock"
      ? roles.executor
      : new CodexCliExecutor({
          mode: executorMode,
          allowExecution: false
        });
  const reviewer = reviewerMode === "mock" ? roles.reviewer : new LocalEvidenceReviewer();

  return {
    ...roles,
    executor,
    reviewer
  };
}

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { appendEvent, appendStatusEvent } from "./audit.js";
import { createPullRequestApproval, preparePullRequestExecution } from "./approval.js";
import {
  type CodexConfig,
  type JiraConfig,
  type OpenAIConfig,
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
  LoopRun,
  PermissionMode,
  PlannerMode,
  ReviewerMode,
  WriteReadinessErrorReport,
  WriteRunnerErrorReport
} from "./domain.js";
import { checkCodex, runDoctor, type DoctorCheck, type DoctorReport } from "./doctor.js";
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
import { loadGeminiConfigWithLocalEnv, readGeminiEnvFile } from "./gemini-env.js";
import { GeminiPlanner } from "./gemini-planner.js";
import { setupGemini, type GeminiSetupReport } from "./gemini-setup.js";
import { initProject } from "./init.js";
import { createIntegrationCheckpoint } from "./integration.js";
import { loadJiraConfigWithLocalEnv, readJiraEnvFile } from "./jira-env.js";
import { setupJiraMcp, type JiraSetupReport } from "./jira-setup.js";
import { createEmptyGraph } from "./graph.js";
import { createId, nowIso } from "./ids.js";
import { loadOpenAIConfigWithLocalEnv, readOpenAIEnvFile } from "./openai-env.js";
import { OpenAIReviewer } from "./openai-reviewer.js";
import { setupOpenAI, type OpenAISetupReport } from "./openai-setup.js";
import { formatPlanPreview } from "./plan-preview.js";
import { RootOrchestrator, createTaskSpec } from "./orchestrator.js";
import { checkPermission } from "./permission.js";
import { createPullRequestPlan } from "./pr-plan.js";
import { resolveTargetProject, resolveTargetRoot } from "./project-root.js";
import {
  createGitToolProviders,
  createTaskSpecFromJiraIssue,
  GitHubCliProvider,
  hasJiraMcpEnvironment,
  JiraCliProvider,
  JiraMcpProvider,
  runCommand as runProviderCommand
} from "./providers.js";
import { LocalEvidenceReviewer } from "./reviewers.js";
import { createMockRoleProviders, type RoleProviders } from "./roles.js";
import { parseRunInput, type RunInput } from "./run-input.js";
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

interface RunPreflightFailure {
  title: string;
  reasons: string[];
  next: Array<{ description: string; command?: string }>;
  json: {
    errorCode: string;
    provider: "gemini" | "jira" | "codex" | "openai";
  };
}

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

function plannerFlag(value: string | undefined): PlannerMode {
  return value === "mock" || value === "gemini" ? value : "gemini";
}

function printUsage(): void {
  console.log(`Usage:
  task-loop-orchestrator --help
  task-loop-orchestrator --version
  task-loop-orchestrator init [--force] [--json]
  task-loop-orchestrator setup [--skip-check]
  task-loop-orchestrator setup jira [--url url] [--username email] [--api-token token|--personal-token token] [--skip-check]
  task-loop-orchestrator setup gemini [--api-key key] [--model model] [--skip-check]
  task-loop-orchestrator setup openai [--api-key key] [--model model] [--skip-check]
  task-loop-orchestrator doctor [codex|jira|gemini|openai] [--github none|gh-cli] [--json]
  task-loop-orchestrator run ISSUE-KEY [--note text] [--planner mock|gemini] [--permission read|write|maintainer] [--executor mock|codex-cli-dry-run|codex-cli] [--reviewer mock|local-evidence|openai] [--max-iterations n] [--json]
  task-loop-orchestrator run <instruction> [--description text] [--planner mock|gemini] [--permission read|write|maintainer] [--executor mock|codex-cli-dry-run|codex-cli] [--reviewer mock|local-evidence|openai] [--max-iterations n] [--json]
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
  tlo setup
  tlo setup jira
  tlo setup gemini
  tlo setup openai
  tlo doctor codex
  tlo doctor jira
  tlo doctor gemini
  tlo doctor openai
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

function uniqueSuggestionLines(
  suggestions: Array<{ command: string[]; reason: string }>
): Array<{ command: string; reason: string }> {
  const seen = new Set<string>();
  const result: Array<{ command: string; reason: string }> = [];
  for (const suggestion of suggestions) {
    const command = suggestion.command.join(" ");
    const key = `${command}\n${suggestion.reason}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ command, reason: suggestion.reason });
  }

  return result;
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
  const rootDir = await resolveTargetRoot();
  const githubMode = stringFlag(args.flags, "github") ? githubFlag(stringFlag(args.flags, "github")) : "none";
  const codexEnabled = args.flags.codex === true || args.positional.includes("codex");
  const jiraEnabled = args.flags.jira === true || args.positional.includes("jira");
  const geminiEnabled = args.flags.gemini === true || args.positional.includes("gemini");
  const openAIEnabled = args.flags.openai === true || args.positional.includes("openai");
  const config =
    codexEnabled || jiraEnabled || geminiEnabled || openAIEnabled
      ? await loadOrchestratorConfig(rootDir)
          .then(async (loadedConfig) => ({
            codex: loadedConfig.codex,
            jira: await loadJiraConfigWithLocalEnv(rootDir, loadedConfig.jira),
            gemini: await loadGeminiConfigWithLocalEnv(rootDir, loadedConfig.gemini),
            openai: await loadOpenAIConfigWithLocalEnv(rootDir, loadedConfig.openai)
          }))
          .catch(() => undefined)
      : undefined;
  const report = await runDoctor(rootDir, {
    githubMode,
    codex: true,
    codexConfig: config?.codex,
    jira: jiraEnabled,
    jiraConfig: config?.jira,
    gemini: geminiEnabled,
    geminiConfig: config?.gemini,
    openai: openAIEnabled,
    openAIConfig: config?.openai
  });

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

  const nextActions = uniqueStrings(report.checks.flatMap((check) => (check.recommendedAction ? [check.recommendedAction] : [])));
  const suggestions = uniqueSuggestionLines(report.checks.flatMap((check) => check.suggestions ?? []));

  if (nextActions.length > 0 || suggestions.length > 0) {
    console.log("");
    console.log("Next:");
    for (const action of nextActions) {
      console.log(`- ${action}`);
    }
    for (const suggestion of suggestions) {
      console.log(`- ${suggestion.reason}`);
      console.log(`  ${suggestion.command}`);
    }
  } else {
    const hasJiraChecks = report.checks.some((check) => check.id.startsWith("jira_"));
    console.log("");
    console.log("Next:");
    console.log(hasJiraChecks ? "- Start a run from a Jira issue:" : "- Start a run from direct text:");
    console.log(hasJiraChecks ? "  tlo run ISSUE-KEY" : '  tlo run "task instruction"');
  }
}

async function initCommand(args: ParsedArgs): Promise<void> {
  const target = await resolveTargetProject();
  const report = await initProject(target.rootDir, {
    force: args.flags.force === true
  });

  if (args.flags.json === true) {
    printJson("init", report);
    return;
  }

  console.log("Success: init");
  console.log("");
  console.log("Result:");
  console.log(`- Target repo: ${report.rootDir}`);
  console.log(`- Git repository: ${target.isGitRepository ? "yes" : "no"}`);
  console.log(`- Config: ${report.files.config.status} ${report.files.config.path}`);
  if (report.files.config.reason) {
    console.log(`- ${report.files.config.reason}`);
  }
  console.log(`- Gitignore: ${report.files.gitignore.status} ${report.files.gitignore.path}`);
  if (report.files.gitignore.reason) {
    console.log(`- ${report.files.gitignore.reason}`);
  }

  if (!target.isGitRepository) {
    console.log("");
    console.log("Warning:");
    console.log("- Current directory is not inside a Git repository. Codex execution requires a Git repository because it creates a Git worktree.");
  }

  console.log("");
  console.log("Next:");
  if (!target.isGitRepository) {
    console.log("- Move into the Git repository you want tlo to work on, or initialize this directory with git init.");
  }
  console.log("- Set up all providers:");
  console.log("  tlo setup");
  console.log("- Or set up one provider:");
  console.log("  tlo setup jira");
  console.log("  tlo setup gemini");
  console.log("  tlo setup openai");
}

async function jiraCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positional[0];
  if (subcommand !== "setup") {
    throw new Error("jira requires a subcommand: setup. Prefer: tlo setup jira.");
  }

  const report = await jiraSetupCommand(args);
  printJiraSetupReport(report);
}

async function setupCommand(args: ParsedArgs): Promise<void> {
  const target = args.positional[0];
  if (!target) {
    const report = await setupAllCommand(args);
    printSetupAllReport(report);
    return;
  }

  if (target === "jira") {
    const report = await jiraSetupCommand(args);
    printJiraSetupReport(report);
    return;
  }

  if (target === "gemini") {
    const report = await geminiSetupCommand(args);
    printGeminiSetupReport(report);
    return;
  }

  if (target === "openai") {
    const report = await openAISetupCommand(args);
    printOpenAISetupReport(report);
    return;
  }

  throw new Error("setup requires a target: jira, gemini, or openai.");
}

interface SetupAllReport {
  rootDir: string;
  status: "ready" | "needs_attention";
  codex: DoctorCheck[];
  jira: JiraSetupReport;
  gemini: GeminiSetupReport;
  openai: OpenAISetupReport;
}

async function setupAllCommand(args: ParsedArgs): Promise<SetupAllReport> {
  const rootDir = await resolveTargetRoot();
  const config = await loadOrchestratorConfig(rootDir);
  console.log(`Target repo: ${rootDir}`);
  console.log("");
  console.log("Step 1/4: Codex CLI");
  const codex = await checkCodex(rootDir, runProviderCommand, config.codex);
  printInlineCodexSetupStatus(codex);
  console.log("");
  console.log("Step 2/4: Jira");
  const jira = await jiraSetupCommand(args);
  console.log("");
  console.log("Step 3/4: Gemini");
  const gemini = await geminiSetupCommand(args);
  console.log("");
  console.log("Step 4/4: OpenAI");
  const openai = await openAISetupCommand(args);
  const status =
    codex.every((check) => check.status === "pass") && jira.status === "ready" && gemini.status === "ready" && openai.status === "ready"
      ? "ready"
      : "needs_attention";

  return {
    rootDir,
    status,
    codex,
    jira,
    gemini,
    openai
  };
}

function printSetupAllReport(report: SetupAllReport): void {
  console.log("");
  console.log(`${report.status === "ready" ? "Success" : "Warning"}: setup`);
  console.log("");
  console.log("Result:");
  console.log(`- Target repo: ${report.rootDir}`);
  console.log(`- Codex CLI: ${report.codex.every((check) => check.status === "pass") ? "ready" : "needs_attention"}`);
  console.log(`- Jira: ${report.jira.status} (${report.jira.envFile})`);
  console.log(`- Gemini: ${report.gemini.status} (${report.gemini.envFile})`);
  console.log(`- OpenAI: ${report.openai.status} (${report.openai.envFile})`);
  console.log("");
  console.log("Next:");
  if (report.status === "ready") {
    console.log("- Start a run from a Jira issue:");
    console.log("  tlo run ISSUE-KEY");
    return;
  }

  console.log("- Check provider setup:");
  console.log("  tlo doctor codex");
  console.log("  tlo doctor jira");
  console.log("  tlo doctor gemini");
  console.log("  tlo doctor openai");
}

function printInlineCodexSetupStatus(checks: DoctorCheck[]): void {
  for (const check of checks) {
    console.log(`- [${check.status}] ${check.id}: ${check.summary}`);
  }
  if (checks.every((check) => check.status === "pass")) {
    console.log("- No Codex token is needed. tlo reuses your local Codex login.");
    return;
  }

  console.log("- Next: run codex login, then tlo doctor codex.");
}

async function jiraSetupCommand(args: ParsedArgs): Promise<JiraSetupReport> {
  const rootDir = await resolveTargetRoot();
  const existingEnv = await readJiraEnvFile(rootDir);
  const url = stringFlag(args.flags, "url") ?? (await promptValue("Jira site URL", existingEnv.JIRA_URL));
  const personalToken = stringFlag(args.flags, "personal-token");

  if (personalToken) {
    return setupJiraMcp({
      rootDir,
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
    rootDir,
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
  console.log(`- ${report.status === "ready" ? "Start a run from a Jira issue:" : "Check Jira MCP setup before starting a run:"}`);
  console.log(`  ${report.nextCommand}`);
}

async function geminiSetupCommand(args: ParsedArgs): Promise<GeminiSetupReport> {
  const rootDir = await resolveTargetRoot();
  const existingEnv = await readGeminiEnvFile(rootDir);
  const apiKey =
    stringFlag(args.flags, "api-key") ??
    (await promptSecret("Gemini API key", existingEnv.GEMINI_API_KEY ? "leave blank to keep existing" : undefined)) ??
    existingEnv.GEMINI_API_KEY;
  const model = stringFlag(args.flags, "model") ?? existingEnv.GEMINI_MODEL;
  const endpoint = stringFlag(args.flags, "endpoint") ?? existingEnv.GEMINI_ENDPOINT;

  return setupGemini({
    rootDir,
    apiKey,
    model,
    endpoint,
    skipCheck: args.flags["skip-check"] === true
  });
}

function printGeminiSetupReport(report: GeminiSetupReport): void {
  console.log(`${report.status === "ready" ? "Success" : "Warning"}: Gemini setup`);
  console.log("");
  console.log("Result:");
  console.log(`- Env file: ${report.envFile}`);
  console.log(`- Model: ${report.model}`);
  console.log(`- Planner check: [${report.check.status}] ${report.check.summary}`);
  console.log("");
  console.log("Next:");
  console.log(`- ${report.status === "ready" ? "Start a run from a Jira issue or direct instruction:" : "Check Gemini planner setup:"}`);
  console.log(`  ${report.nextCommand}`);
}

async function openAISetupCommand(args: ParsedArgs): Promise<OpenAISetupReport> {
  const rootDir = await resolveTargetRoot();
  const existingEnv = await readOpenAIEnvFile(rootDir);
  const apiKey =
    stringFlag(args.flags, "api-key") ??
    (await promptSecret("OpenAI API key", existingEnv.OPENAI_API_KEY ? "leave blank to keep existing" : undefined)) ??
    existingEnv.OPENAI_API_KEY;
  const model = stringFlag(args.flags, "model") ?? existingEnv.OPENAI_MODEL;
  const endpoint = stringFlag(args.flags, "endpoint") ?? existingEnv.OPENAI_ENDPOINT;

  return setupOpenAI({
    rootDir,
    apiKey,
    model,
    endpoint,
    skipCheck: args.flags["skip-check"] === true
  });
}

function printOpenAISetupReport(report: OpenAISetupReport): void {
  console.log(`${report.status === "ready" ? "Success" : "Warning"}: OpenAI setup`);
  console.log("");
  console.log("Result:");
  console.log(`- Env file: ${report.envFile}`);
  console.log(`- Model: ${report.model}`);
  console.log(`- Reviewer check: [${report.check.status}] ${report.check.summary}`);
  console.log("");
  console.log("Next:");
  console.log(`- ${report.status === "ready" ? "Start a run from a Jira issue or direct instruction:" : "Check OpenAI reviewer setup:"}`);
  console.log(`  ${report.nextCommand}`);
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

async function promptYesNo(label: string, defaultValue: boolean = false): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${label} requires an interactive terminal.`);
  }

  const suffix = defaultValue ? " [Y/n]" : " [y/N]";
  const answer = (await promptValue(`${label}${suffix}`)).trim().toLowerCase();
  if (!answer) {
    return defaultValue;
  }

  return answer === "y" || answer === "yes";
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
  const rootDir = await resolveTargetRoot();
  const input = parseRunInput(args);
  if (input.kind === "direct" && !input.title) {
    throw new Error('run requires a Jira issue key or direct task instruction. Examples: tlo run OUC-10, tlo run "직접 작업 설명".');
  }

  const store = new FileRunStore(rootDir);
  const config = await loadOrchestratorConfig(rootDir);
  const jiraConfig = await loadJiraConfigWithLocalEnv(rootDir, config.jira);
  const geminiConfig = await loadGeminiConfigWithLocalEnv(rootDir, config.gemini);
  const openAIConfig = await loadOpenAIConfigWithLocalEnv(rootDir, config.openai);
  const plannerMode = stringFlag(args.flags, "planner") ? plannerFlag(stringFlag(args.flags, "planner")) : config.planner;
  const executorMode = stringFlag(args.flags, "executor") ? executorFlag(stringFlag(args.flags, "executor")) : config.executor;
  const reviewerMode = stringFlag(args.flags, "reviewer") ? reviewerFlag(stringFlag(args.flags, "reviewer")) : config.reviewer;
  const permissionMode = stringFlag(args.flags, "permission") ? permissionFlag(stringFlag(args.flags, "permission")) : config.permissionMode;
  const preflightFailure = await preflightRunDependencies(
    rootDir,
    input,
    plannerMode,
    geminiConfig,
    jiraConfig,
    executorMode,
    config.codex,
    reviewerMode,
    openAIConfig
  );
  if (preflightFailure) {
    printRunPreflightFailure(preflightFailure, args.flags.json === true);
    process.exitCode = 1;
    return;
  }

  const taskSpec = input.kind === "jira" && input.jiraKey
    ? await createTaskSpecFromJiraKey(input.jiraKey, permissionMode, jiraConfig, rootDir, input.note)
    : createTaskSpec({
        title: input.title ?? "",
        description: stringFlag(args.flags, "description") ?? input.note,
        permissionMode
      });
  const orchestrator = new RootOrchestrator({
    store,
    roles: createRoleProviders(rootDir, plannerMode, geminiConfig, executorMode, config.codex, reviewerMode, openAIConfig),
    tools: createGitToolProviders(rootDir),
    maxIterations: numberFlag(args.flags, "max-iterations") ?? config.maxIterations,
    worktreeEnabled: config.worktree.enabled
  });

  let run: LoopRun;
  if (args.flags.json === true) {
    run = await orchestrator.runTask(taskSpec);
  } else {
    run = await runInteractiveWithPlanApproval(orchestrator, store, taskSpec, {
      input,
      plannerMode,
      plannerModel: geminiConfig.model,
      executorMode,
      reviewerMode,
      maxIterations: numberFlag(args.flags, "max-iterations") ?? config.maxIterations
    });
  }

  if (args.flags.json === true) {
    printJson("run", createRunCliReport(run, store));
    return;
  }

  printRunReport(run, store, input, plannerMode, geminiConfig.model, executorMode, reviewerMode);
}

async function runInteractiveWithPlanApproval(
  orchestrator: RootOrchestrator,
  store: FileRunStore,
  taskSpec: Parameters<RootOrchestrator["runTask"]>[0],
  options: {
    input: RunInput;
    plannerMode: PlannerMode;
    plannerModel: string;
    executorMode: ExecutorMode;
    reviewerMode: ReviewerMode;
    maxIterations: number;
  }
): Promise<LoopRun> {
  if (options.input.kind === "jira") {
    console.log(`Reading Jira issue ${options.input.jiraKey}...`);
  }
  console.log(`Creating plan with ${options.plannerMode}${options.plannerMode === "gemini" ? ` (${options.plannerModel})` : ""}...`);

  let run = await orchestrator.discover(taskSpec);
  await store.save(run);
  run = await orchestrator.plan(run);
  await store.save(run);

  while (true) {
    console.log(formatPlanPreview(run));
    const approved = await promptYesNo("Approve this plan and start execution?", false);
    if (approved) {
      break;
    }

    const revision = await promptValue("Revision request (leave blank to stop)");
    if (!revision.trim()) {
      const blocked = appendStatusEvent(
        {
          ...run,
          status: "blocked",
          updatedAt: nowIso()
        },
        "run_blocked",
        "Run stopped before execution because the plan was not approved."
      );
      await store.save(blocked);
      return blocked;
    }

    run = appendEvent(
      {
        ...run,
        graph: createEmptyGraph(),
        context: {
          ...run.context,
          items: [
            ...run.context.items,
            {
              id: createId("ctx"),
              kind: "decision",
              text: `Plan revision request: ${revision.trim()}`,
              source: "root",
              createdAt: nowIso()
            }
          ]
        },
        status: "running",
        updatedAt: nowIso()
      },
      {
        kind: "context_updated",
        message: "Added plan revision request from user.",
        role: "root"
      }
    );
    console.log(`Revising plan with ${options.plannerMode}${options.plannerMode === "gemini" ? ` (${options.plannerModel})` : ""}...`);
    run = await orchestrator.plan(run);
    await store.save(run);
  }

  const targetIterations = run.iterations + options.maxIterations;
  while (run.status === "running" && run.iterations < targetIterations) {
    const nextSubtask = orchestrator.selectNextSubtask(run);
    if (nextSubtask) {
      console.log(`Executing with Codex: ${nextSubtask.title}`);
    }
    run = await orchestrator.iterate(run);
    await store.save(run);
    const reviewed = run.events.at(-2)?.kind === "review_completed" || run.events.at(-1)?.kind === "review_completed";
    if (reviewed) {
      console.log(`Reviewed: ${nextSubtask?.title ?? "current subtask"}`);
    }
  }

  if (run.status === "running") {
    run = appendStatusEvent(
      {
        ...run,
        status: "blocked",
        updatedAt: nowIso()
      },
      "run_blocked",
      `Run reached max additional iterations (${targetIterations}).`
    );
    await store.save(run);
  }

  return run;
}

async function preflightRunDependencies(
  rootDir: string,
  input: RunInput,
  plannerMode: PlannerMode,
  geminiConfig: Awaited<ReturnType<typeof loadGeminiConfigWithLocalEnv>>,
  jiraConfig: JiraConfig,
  executorMode: ExecutorMode,
  codexConfig: CodexConfig,
  reviewerMode: ReviewerMode,
  openAIConfig: OpenAIConfig
): Promise<RunPreflightFailure | undefined> {
  if (plannerMode === "gemini" && !geminiConfig.apiKey?.trim()) {
    return {
      title: "Run",
      reasons: ["Gemini Planner is selected, but Gemini credentials are not configured for this project."],
      next: [
        {
          description: "Create or view a Gemini API key in Google AI Studio:",
          command: "https://aistudio.google.com/app/apikey"
        },
        {
          description: "Set up all required providers for this project:",
          command: "tlo setup"
        },
        {
          description: "Save Gemini API credentials for this project:",
          command: "tlo setup gemini"
        },
        {
          description: "Then run the task again:",
          command: input.kind === "jira" && input.jiraKey ? `tlo run ${input.jiraKey}` : 'tlo run "task instruction"'
        }
      ],
      json: {
        errorCode: "gemini_setup_required",
        provider: "gemini"
      }
    };
  }

  if (executorMode === "codex-cli" && !codexConfig.binary.trim()) {
    return {
      title: "Run",
      reasons: ["Codex CLI executor is selected, but the Codex binary is not configured."],
      next: [
        {
          description: "Configure the Codex binary in orchestrator.config.json:",
          command: '"codex": { "binary": "codex" }'
        }
      ],
      json: {
        errorCode: "codex_setup_required",
        provider: "codex"
      }
    };
  }

  if (executorMode === "codex-cli") {
    const codexChecks = await checkCodex(rootDir, runProviderCommand, codexConfig);
    const failingCheck = codexChecks.find((check) => check.status !== "pass");
    if (failingCheck) {
      return {
        title: "Run",
        reasons: [`Codex CLI Executor is selected, but Codex CLI is not ready: ${failingCheck.summary}`],
        next: [
          {
            description: "Check Codex CLI readiness:",
            command: "tlo doctor codex"
          },
          {
            description: "Log in to Codex CLI if needed:",
            command: `${codexConfig.binary || "codex"} login`
          },
          {
            description: "Then run the task again:",
            command: input.kind === "jira" && input.jiraKey ? `tlo run ${input.jiraKey}` : 'tlo run "task instruction"'
          }
        ],
        json: {
          errorCode: "codex_setup_required",
          provider: "codex"
        }
      };
    }
  }

  if (reviewerMode === "openai" && !openAIConfig.apiKey?.trim()) {
    return {
      title: "Run",
      reasons: ["OpenAI Reviewer is selected, but OpenAI API credentials are not configured for this project."],
      next: [
        {
          description: "Create or view an OpenAI API key:",
          command: "https://platform.openai.com/api-keys"
        },
        {
          description: "Set up all required providers for this project:",
          command: "tlo setup"
        },
        {
          description: "Save OpenAI API credentials for this project:",
          command: "tlo setup openai"
        },
        {
          description: "Then run the task again:",
          command: input.kind === "jira" && input.jiraKey ? `tlo run ${input.jiraKey}` : 'tlo run "task instruction"'
        }
      ],
      json: {
        errorCode: "openai_setup_required",
        provider: "openai"
      }
    };
  }

  if (
    input.kind === "jira" &&
    jiraConfig.provider === "mcp-atlassian" &&
    jiraConfig.fallback === "none" &&
    !hasJiraMcpEnvironment(jiraConfig.mcp)
  ) {
    return {
      title: "Run from Jira issue",
      reasons: ["This task starts from a Jira issue, but Jira MCP credentials are not configured for this project."],
      next: [
        {
          description: "Save Jira URL and credentials for this project:",
          command: "tlo setup jira"
        },
        {
          description: "Then run the task again:",
          command: input.jiraKey ? `tlo run ${input.jiraKey}` : "tlo run ISSUE-KEY"
        }
      ],
      json: {
        errorCode: "jira_setup_required",
        provider: "jira"
      }
    };
  }

  return undefined;
}

function printRunPreflightFailure(failure: RunPreflightFailure, json: boolean): void {
  if (json) {
    printJson("run", {
      status: "failed",
      errorCode: failure.json.errorCode,
      provider: failure.json.provider,
      reasons: failure.reasons,
      next: failure.next
    });
    return;
  }

  console.log(`Failed: ${failure.title}`);
  console.log("");
  console.log("Reason:");
  for (const reason of failure.reasons) {
    console.log(`- ${reason}`);
  }
  console.log("");
  console.log("Next:");
  for (const item of failure.next) {
    console.log(`- ${item.description}`);
    if (item.command) {
      console.log(`  ${item.command}`);
    }
  }
}

async function createTaskSpecFromJiraKey(
  jiraKey: string,
  permissionMode: PermissionMode,
  jiraConfig: JiraConfig,
  rootDir: string,
  note?: string
) {
  const primaryProvider =
    jiraConfig.provider === "mcp-atlassian"
      ? new JiraMcpProvider(jiraConfig.mcp, rootDir)
      : new JiraCliProvider(rootDir);
  const issue = await primaryProvider.getIssue(jiraKey);
  if (issue) {
    return createTaskSpecFromJiraIssue(issue, permissionMode, note);
  }

  if (jiraConfig.provider === "mcp-atlassian" && jiraConfig.fallback === "cli") {
    const fallbackIssue = await new JiraCliProvider(rootDir).getIssue(jiraKey);
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
  plannerMode: PlannerMode,
  plannerModel: string,
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
  console.log(`- Provider: ${plannerMode}`);
  if (plannerMode === "gemini") {
    console.log(`- Model: ${plannerModel}`);
  }
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
  console.log("- View the saved run:");
  console.log(`  tlo status ${run.id}`);
  if (run.status !== "completed") {
    console.log("- Continue the run:");
    console.log(`  tlo resume ${run.id}`);
  }
}

async function statusCommand(args: ParsedArgs): Promise<void> {
  const rootDir = await resolveTargetRoot();
  const store = new FileRunStore(rootDir);
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
  const rootDir = await resolveTargetRoot();
  const runId = args.positional[0];
  if (!runId) {
    throw new Error("resume requires a runId.");
  }

  const store = new FileRunStore(rootDir);
  const config = await loadOrchestratorConfig(rootDir);
  const geminiConfig = await loadGeminiConfigWithLocalEnv(rootDir, config.gemini);
  const openAIConfig = await loadOpenAIConfigWithLocalEnv(rootDir, config.openai);
  const orchestrator = new RootOrchestrator({
    store,
    roles: createRoleProviders(rootDir, config.planner, geminiConfig, config.executor, config.codex, config.reviewer, openAIConfig),
    tools: createGitToolProviders(rootDir),
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
  const rootDir = await resolveTargetRoot();
  const store = new FileRunStore(rootDir);
  const config = await loadOrchestratorConfig(rootDir);
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
    rootDir,
    githubMode === "gh-cli" ? new GitHubCliProvider(rootDir) : undefined
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
  const rootDir = await resolveTargetRoot();
  const ref = args.positional[0] ?? "HEAD";
  const provider = new GitHubCliProvider(rootDir);
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
  const rootDir = await resolveTargetRoot();
  const store = new FileRunStore(rootDir);
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
  const tools = createGitToolProviders(rootDir);
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
  const rootDir = await resolveTargetRoot();
  const store = new FileRunStore(rootDir);
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
  const tools = createGitToolProviders(rootDir);
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
  const rootDir = await resolveTargetRoot();
  const store = new FileRunStore(rootDir);
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
  const tools = createGitToolProviders(rootDir);
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
  const rootDir = await resolveTargetRoot();
  const jsonOutput = args.flags.json === true;

  if (args.flags.all === true) {
    const store = new FileRunStore(rootDir);
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

  const store = new FileRunStore(rootDir);
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
  const rootDir = await resolveTargetRoot();
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

  const store = new FileRunStore(rootDir);
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
  const rootDir = await resolveTargetRoot();
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

  const store = new FileRunStore(rootDir);
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

  if (args.command === "setup") {
    await setupCommand(args);
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

function createRoleProviders(
  rootDir: string,
  plannerMode: PlannerMode,
  geminiConfig: Awaited<ReturnType<typeof loadGeminiConfigWithLocalEnv>>,
  executorMode: ExecutorMode,
  codexConfig: CodexConfig,
  reviewerMode: ReviewerMode,
  openAIConfig: Awaited<ReturnType<typeof loadOpenAIConfigWithLocalEnv>>
): RoleProviders {
  const roles = createMockRoleProviders();
  const planner = plannerMode === "mock" ? roles.planner : new GeminiPlanner({ config: geminiConfig });
  const executor =
    executorMode === "mock"
      ? roles.executor
      : new CodexCliExecutor({
          mode: executorMode,
          codexBinary: codexConfig.binary,
          allowExecution: executorMode === "codex-cli",
          rootDir,
          workspaceRoot: codexConfig.workspaceRoot,
          sandbox: codexConfig.sandbox,
          model: codexConfig.model
        });
  const reviewer =
    reviewerMode === "mock"
      ? roles.reviewer
      : reviewerMode === "openai"
        ? new OpenAIReviewer({ config: openAIConfig })
        : new LocalEvidenceReviewer();

  return {
    ...roles,
    planner,
    executor,
    reviewer
  };
}

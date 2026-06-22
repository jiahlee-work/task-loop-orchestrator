#!/usr/bin/env node
import { appendEvent } from "./audit.js";
import { createPullRequestApproval, preparePullRequestExecution } from "./approval.js";
import {
  loadOrchestratorConfig,
  normalizeExecutorMode,
  normalizeGitHubProviderMode,
  normalizePermissionMode,
  normalizeReviewerMode
} from "./config.js";
import type { ExecutorMode, GitHubProviderMode, PermissionMode, ReviewerMode } from "./domain.js";
import { CodexCliExecutor } from "./executors.js";
import { createIntegrationCheckpoint } from "./integration.js";
import { RootOrchestrator, createTaskSpec } from "./orchestrator.js";
import { checkPermission } from "./permission.js";
import { createPullRequestPlan } from "./pr-plan.js";
import { createGitToolProviders, GitHubCliProvider } from "./providers.js";
import { LocalEvidenceReviewer } from "./reviewers.js";
import { createMockRoleProviders, type RoleProviders } from "./roles.js";
import { FileRunStore } from "./store.js";

interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
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

function printUsage(): void {
  console.log(`Usage:
  task-loop-orchestrator run <title> [--description text] [--permission read|write|maintainer] [--executor mock|codex-cli-dry-run|codex-cli] [--reviewer mock|local-evidence] [--max-iterations n]
  task-loop-orchestrator status [runId] [--json]
  task-loop-orchestrator resume <runId> [--max-iterations n]
  task-loop-orchestrator checkpoint [runId] [--github none|gh-cli] [--json]
  task-loop-orchestrator pr-plan [runId] [--json]
  task-loop-orchestrator approve-pr [runId] --approved-by name [--reason text] [--json]
  task-loop-orchestrator pr-exec [runId] [--execute] [--approval approvalId] [--approved-by name] [--json]
  task-loop-orchestrator checks [ref] [--json]`);
}

async function runCommand(args: ParsedArgs): Promise<void> {
  const title = args.positional.join(" ").trim();
  if (!title) {
    throw new Error("run requires a title.");
  }

  const store = new FileRunStore(process.cwd());
  const config = await loadOrchestratorConfig(process.cwd());
  const executorMode = stringFlag(args.flags, "executor") ? executorFlag(stringFlag(args.flags, "executor")) : config.executor;
  const reviewerMode = stringFlag(args.flags, "reviewer") ? reviewerFlag(stringFlag(args.flags, "reviewer")) : config.reviewer;
  const orchestrator = new RootOrchestrator({
    store,
    roles: createRoleProviders(executorMode, reviewerMode),
    tools: createGitToolProviders(process.cwd()),
    maxIterations: numberFlag(args.flags, "max-iterations") ?? config.maxIterations,
    worktreeEnabled: config.worktree.enabled
  });
  const run = await orchestrator.runTask(
    createTaskSpec({
      title,
      description: stringFlag(args.flags, "description"),
      permissionMode: stringFlag(args.flags, "permission") ? permissionFlag(stringFlag(args.flags, "permission")) : config.permissionMode
    })
  );

  console.log(`Run ${run.id}: ${run.status}`);
  console.log(`Iterations: ${run.iterations}`);
  console.log(`Subtasks: ${run.graph.subtasks.length}`);
  console.log(`Saved: ${store.pathForRun(run.id)}`);
}

async function statusCommand(args: ParsedArgs): Promise<void> {
  const store = new FileRunStore(process.cwd());
  const runId = args.positional[0];
  const run = runId ? await store.load(runId) : await store.latest();

  if (!run) {
    console.log("No runs found.");
    return;
  }

  if (args.flags.json === true) {
    console.log(JSON.stringify(run, null, 2));
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
  const run = await orchestrator.resume(runId);
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
    console.log(JSON.stringify(report, null, 2));
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
    console.log(JSON.stringify(summary, null, 2));
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
    console.log(JSON.stringify(plan, null, 2));
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
    console.log(JSON.stringify(report, null, 2));
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
    console.log(JSON.stringify(approval, null, 2));
    return;
  }

  console.log(`Approval ${approval.id}: ${approval.status}`);
  console.log(`Run: ${approval.runId}`);
  console.log(`Plan: ${approval.planId}`);
  console.log(`Approved by: ${approval.approvedBy}`);
  console.log(`Saved: ${store.pathForApproval(approval.id)}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === "--help" || args.command === "-h") {
    printUsage();
    return;
  }

  if (args.command === "run") {
    await runCommand(args);
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

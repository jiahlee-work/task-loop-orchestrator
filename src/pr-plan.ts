import type { IntegrationCheckpointReport, LoopRun, PullRequestPlan } from "./domain.js";
import { createId, nowIso } from "./ids.js";
import type { RepoProvider } from "./providers.js";

export interface CreatePullRequestPlanInput {
  run: LoopRun;
  repo: RepoProvider;
  checkpoint?: IntegrationCheckpointReport;
  baseBranch?: string;
}

export async function createPullRequestPlan(input: CreatePullRequestPlanInput): Promise<PullRequestPlan> {
  const [repoStatus, diffStat] = await Promise.all([input.repo.getStatus(), input.repo.getDiff()]);
  const baseBranch = input.baseBranch ?? "main";
  const sourceBranchHint = createBranchHint(input.run.id);
  const blockedReasons = [
    ...checkpointBlockedReasons(input.checkpoint),
    ...(repoStatus.trim() ? [`Repository status is not clean: ${repoStatus}`] : []),
    ...(diffStat.trim() ? [`Repository diff is not clean: ${diffStat}`] : [])
  ];
  const preconditions = [
    "Review this plan before running any command.",
    "Confirm branch name and base branch.",
    "Stage reviewed files before commit.",
    "Run local verification before commit.",
    "Confirm GitHub checks are acceptable before PR creation."
  ];
  const title = input.run.spec.title;
  const body = createPullRequestBody(input.run, input.checkpoint);

  return {
    id: createId("prplan"),
    runId: input.run.id,
    checkpointId: input.checkpoint?.id,
    sourceBranchHint,
    baseBranch,
    title,
    body,
    preconditions,
    blockedReasons,
    commandCandidates: createCommandCandidates(sourceBranchHint, baseBranch, title, body),
    createdAt: nowIso()
  };
}

function checkpointBlockedReasons(checkpoint: IntegrationCheckpointReport | undefined): string[] {
  if (!checkpoint) {
    return ["No checkpoint report found; create a checkpoint before preparing PR execution."];
  }

  if (checkpoint.status === "clean") {
    return [];
  }

  return [
    `Latest checkpoint ${checkpoint.id} is ${checkpoint.status}.`,
    ...checkpoint.conflictRisks,
    ...checkpoint.ownerDecisionItems.map((item) => `Owner decision required: ${item.reason}`)
  ];
}

function createCommandCandidates(
  sourceBranchHint: string,
  baseBranch: string,
  title: string,
  body: string
): PullRequestPlan["commandCandidates"] {
  return [
    {
      action: "create_branch",
      command: ["git", "switch", "-c", sourceBranchHint],
      reason: "Create an isolated branch for the reviewed changes.",
      decisionReady: true
    },
    {
      action: "commit",
      command: ["git", "commit", "-m", title],
      reason: "Commit staged, reviewed local changes after explicit approval.",
      decisionReady: true
    },
    {
      action: "push",
      command: ["git", "push", "-u", "origin", sourceBranchHint],
      reason: "Publish the approved branch after explicit approval.",
      decisionReady: true
    },
    {
      action: "create_pr",
      command: ["gh", "pr", "create", "--base", baseBranch, "--head", sourceBranchHint, "--title", title, "--body", body],
      reason: "Open a PR after branch publication and maintainer approval.",
      decisionReady: true
    }
  ];
}

function createPullRequestBody(run: LoopRun, checkpoint: IntegrationCheckpointReport | undefined): string {
  const completed = run.graph.subtasks.filter((subtask) => subtask.status === "completed").length;
  const total = run.graph.subtasks.length;
  return [
    `Run: ${run.id}`,
    checkpoint ? `Checkpoint: ${checkpoint.id} (${checkpoint.status})` : "Checkpoint: none",
    `Task: ${run.spec.title}`,
    `Subtasks: ${completed}/${total} completed`,
    "",
    "This PR plan is decision-ready only. No branch, commit, push, or PR has been created by the orchestrator."
  ].join("\n");
}

function createBranchHint(runId: string): string {
  const compactRunId = runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toLowerCase();
  return `orchestrator/${compactRunId}`;
}

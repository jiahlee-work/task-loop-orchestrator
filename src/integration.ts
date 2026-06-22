import type {
  IntegrationCheckpointMaintainerActionCandidate,
  IntegrationCheckpointOwnerDecisionItem,
  IntegrationCheckpointReport,
  IntegrationCheckpointStatus,
  LoopEvent,
  LoopRun,
  Subtask
} from "./domain.js";
import { createId, nowIso } from "./ids.js";
import type { GitHubProvider, JiraProvider, RepoProvider } from "./providers.js";

export interface IntegrationCheckpointInput {
  run: LoopRun;
  repo: RepoProvider;
  github?: GitHubProvider;
  jira?: JiraProvider;
}

export async function createIntegrationCheckpoint(
  input: IntegrationCheckpointInput
): Promise<IntegrationCheckpointReport> {
  const [repoStatus, diffStat, ciCheck] = await Promise.all([
    input.repo.getStatus(),
    input.repo.getDiff(),
    input.github?.getCheckStatus().catch(() => undefined)
  ]);
  const counts = countSubtasks(input.run.graph.subtasks);
  const ownerDecisionItems = collectOwnerDecisionItems(input.run);
  const conflictRisks = collectConflictRisks(input.run, repoStatus, diffStat);
  const status = evaluateCheckpointStatus({
    counts,
    ownerDecisionItems,
    conflictRisks,
    repoStatus,
    diffStat
  });

  return {
    id: createId("checkpoint"),
    runId: input.run.id,
    status,
    counts,
    repoStatus,
    diffStat,
    ciCheck: ciCheck ?? {
      status: "not_run",
      summary: "CI/check integration is not connected; placeholder only.",
      source: "placeholder"
    },
    conflictRisks,
    recommendedNextAction: recommendNextAction(status, counts, ownerDecisionItems),
    maintainerActionCandidates: createMaintainerActionCandidates(status, repoStatus, diffStat),
    ownerDecisionItems,
    createdAt: nowIso()
  };
}

function countSubtasks(subtasks: Subtask[]): IntegrationCheckpointReport["counts"] {
  return {
    completed: subtasks.filter((subtask) => subtask.status === "completed").length,
    blocked: subtasks.filter((subtask) => subtask.status === "blocked").length,
    pending: subtasks.filter((subtask) => subtask.status === "pending").length,
    active: subtasks.filter((subtask) => subtask.status === "active").length,
    failed: subtasks.filter((subtask) => subtask.status === "failed").length
  };
}

function collectOwnerDecisionItems(run: LoopRun): IntegrationCheckpointOwnerDecisionItem[] {
  const reviewerItems = run.events.flatMap((event): IntegrationCheckpointOwnerDecisionItem[] => {
    if (event.kind !== "review_completed") {
      return [];
    }

    const report = event.data?.report;
    if (!isRecord(report) || report.verdict !== "owner_decision") {
      return [];
    }

    return [
      {
        source: "reviewer",
        reason:
          typeof report.ownerDecisionReason === "string"
            ? report.ownerDecisionReason
            : "Reviewer requested owner decision.",
        subtaskId: event.subtaskId
      }
    ];
  });

  const blockedContextItems = run.context.items
    .filter((item) => item.kind === "blocked")
    .map((item): IntegrationCheckpointOwnerDecisionItem => ({
      source: "context",
      reason: item.text
    }));

  return [...reviewerItems, ...blockedContextItems];
}

function collectConflictRisks(run: LoopRun, repoStatus: string, diffStat: string): string[] {
  const graphConflicts = run.graph.conflicts.map((conflict) => conflict.description);
  const blockedSubtasks = run.graph.subtasks
    .filter((subtask) => subtask.status === "blocked" || subtask.status === "failed")
    .map((subtask) => `${subtask.id}: ${subtask.result ?? subtask.title}`);
  const repoRisks = [
    ...(repoStatus.trim() ? [`Repository has uncommitted status: ${repoStatus}`] : []),
    ...(diffStat.trim() ? [`Repository has diff stat: ${diffStat}`] : [])
  ];

  return [...graphConflicts, ...blockedSubtasks, ...repoRisks];
}

function evaluateCheckpointStatus(input: {
  counts: IntegrationCheckpointReport["counts"];
  ownerDecisionItems: IntegrationCheckpointOwnerDecisionItem[];
  conflictRisks: string[];
  repoStatus: string;
  diffStat: string;
}): IntegrationCheckpointStatus {
  if (input.counts.blocked > 0 || input.counts.failed > 0 || input.ownerDecisionItems.length > 0) {
    return "blocked";
  }

  if (
    input.counts.pending > 0 ||
    input.counts.active > 0 ||
    input.conflictRisks.length > 0 ||
    input.repoStatus.trim() ||
    input.diffStat.trim()
  ) {
    return "needs_attention";
  }

  return "clean";
}

function recommendNextAction(
  status: IntegrationCheckpointStatus,
  counts: IntegrationCheckpointReport["counts"],
  ownerDecisionItems: IntegrationCheckpointOwnerDecisionItem[]
): string {
  if (status === "clean") {
    return "Prepare maintainer review; no integration action has been executed.";
  }

  if (ownerDecisionItems.length > 0) {
    return "Resolve owner decision items before integration.";
  }

  if (counts.blocked > 0 || counts.failed > 0) {
    return "Resolve blocked or failed subtasks before integration.";
  }

  if (counts.pending > 0 || counts.active > 0) {
    return "Continue the task loop until all subtasks are complete.";
  }

  return "Review repository status and diff before integration.";
}

function createMaintainerActionCandidates(
  status: IntegrationCheckpointStatus,
  repoStatus: string,
  diffStat: string
): IntegrationCheckpointMaintainerActionCandidate[] {
  if (status !== "clean") {
    return [];
  }

  const hasRepoEvidence = repoStatus.trim() || diffStat.trim();
  return [
    {
      action: "create_pr",
      label: "Create PR",
      reason: hasRepoEvidence
        ? "Checkpoint is clean and repository evidence is available for maintainer review."
        : "Checkpoint is clean; PR creation remains a decision-ready candidate.",
      decisionReady: true
    },
    {
      action: "merge_pr",
      label: "Merge PR",
      reason: "Maintainer-only candidate; checkpoint does not execute merge.",
      decisionReady: true
    },
    {
      action: "release",
      label: "Release",
      reason: "Maintainer-only candidate for later release workflow.",
      decisionReady: true
    }
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

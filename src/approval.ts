import type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalPlanSnapshot,
  PullRequestExecutionMode,
  PullRequestExecutionReport,
  PullRequestPlan
} from "./domain.js";
import { createId, nowIso } from "./ids.js";

export interface CreateApprovalInput {
  approvedBy?: string;
  status?: ApprovalStatus;
  reason?: string;
}

export interface PreparePullRequestExecutionInput {
  plan: PullRequestPlan;
  mode?: PullRequestExecutionMode;
  approval?: ApprovalRecord;
}

export function createPullRequestApproval(plan: PullRequestPlan, input: CreateApprovalInput = {}): ApprovalRecord {
  const status = input.status ?? (input.approvedBy ? "approved" : "pending");
  return {
    id: createId("approval"),
    scope: "pr_execution",
    planId: plan.id,
    runId: plan.runId,
    checkpointId: plan.checkpointId,
    planSnapshot: createApprovalPlanSnapshot(plan),
    status,
    approvedBy: input.approvedBy,
    reason: input.reason,
    createdAt: nowIso()
  };
}

export function preparePullRequestExecution(input: PreparePullRequestExecutionInput): PullRequestExecutionReport {
  const mode = input.mode ?? "dry-run";
  const approvalBlockedReasons = approvalBlockedReasonsFor(mode, input.plan, input.approval);
  const executionBlockedReasons =
    mode === "execute" && approvalBlockedReasons.length === 0
      ? ["Write execution is not implemented; branch, commit, push, and PR creation remain blocked at the boundary."]
      : [];
  const blockedReasons = [...input.plan.blockedReasons, ...approvalBlockedReasons, ...executionBlockedReasons];
  const status = mode === "dry-run" ? "dry_run" : blockedReasons.length === 0 ? "ready" : "blocked";

  return {
    id: createId("prexec"),
    planId: input.plan.id,
    runId: input.plan.runId,
    mode,
    status,
    approval: input.approval,
    blockedReasons,
    commandCandidates: input.plan.commandCandidates,
    executedCommands: [],
    message: createMessage(mode, status),
    createdAt: nowIso()
  };
}

function approvalBlockedReasonsFor(
  mode: PullRequestExecutionMode,
  plan: PullRequestPlan,
  approval: ApprovalRecord | undefined
): string[] {
  if (mode === "dry-run") {
    return [];
  }

  if (!approval) {
    return ["Execution mode requires an approval record."];
  }

  if (approval.status !== "approved") {
    return [`Approval status is ${approval.status}; execution requires approved.`];
  }

  if (!approval.approvedBy?.trim()) {
    return ["Approved execution requires approvedBy."];
  }

  const staleReasons = staleApprovalReasons(plan, approval);
  if (staleReasons.length > 0) {
    return staleReasons;
  }

  return [];
}

function staleApprovalReasons(plan: PullRequestPlan, approval: ApprovalRecord): string[] {
  const reasons: string[] = [];

  if (approval.runId !== plan.runId) {
    reasons.push(`Approval run ${approval.runId} does not match current run ${plan.runId}.`);
  }

  if (approval.checkpointId !== plan.checkpointId) {
    reasons.push(
      `Stale approval: approved checkpoint ${approval.checkpointId ?? "none"} does not match current checkpoint ${
        plan.checkpointId ?? "none"
      }.`
    );
  }

  return reasons;
}

function createApprovalPlanSnapshot(plan: PullRequestPlan): ApprovalPlanSnapshot {
  return {
    planTitle: plan.title,
    baseBranch: plan.baseBranch,
    sourceBranchHint: plan.sourceBranchHint,
    blockedReasons: [...plan.blockedReasons],
    commandCandidateActions: plan.commandCandidates.map((candidate) => candidate.action)
  };
}

function createMessage(mode: PullRequestExecutionMode, status: PullRequestExecutionReport["status"]): string {
  if (mode === "dry-run") {
    return "Dry-run only. No branch, commit, push, or PR command was executed.";
  }

  if (status === "blocked") {
    return "Execution was blocked before any write command could run.";
  }

  return "Execution preconditions are ready, but command execution is intentionally not implemented.";
}

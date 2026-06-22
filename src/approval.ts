import type {
  ApprovalRecord,
  ApprovalStatus,
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
    status,
    approvedBy: input.approvedBy,
    reason: input.reason,
    createdAt: nowIso()
  };
}

export function preparePullRequestExecution(input: PreparePullRequestExecutionInput): PullRequestExecutionReport {
  const mode = input.mode ?? "dry-run";
  const approvalBlockedReasons = approvalBlockedReasonsFor(mode, input.approval);
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

function approvalBlockedReasonsFor(mode: PullRequestExecutionMode, approval: ApprovalRecord | undefined): string[] {
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

  return [];
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

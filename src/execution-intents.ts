import { createHash } from "node:crypto";
import type {
  ApprovalRecord,
  ExecutionIntent,
  ExecutionIntentCommandCandidate,
  ExecutionIntentCommandActionSummary,
  ExecutionIntentReport,
  ExecutionIntentStatus,
  PermissionMode,
  PullRequestCommandCandidate,
  PullRequestPlan
} from "./domain.js";
import { createId, nowIso } from "./ids.js";

export const executionIntentPolicyVersion = "write-execution-intent/v1";

export interface CreateExecutionIntentInput {
  plan: PullRequestPlan;
  approval: ApprovalRecord;
  actor: string;
  reason?: string;
  createdAt?: string;
  expiresAt: string;
  targetRef?: string;
  permissionMode: PermissionMode;
  policyVersion?: string;
  status?: ExecutionIntentStatus;
}

export function createExecutionIntent(input: CreateExecutionIntentInput): ExecutionIntent {
  const blockedReasons = executionIntentBlockedReasons(input.plan, input.approval);

  return {
    id: createId("intent"),
    runId: input.plan.runId,
    planId: input.plan.id,
    planFingerprint: createPlanFingerprint(input.plan),
    checkpointId: input.plan.checkpointId,
    approvalId: input.approval.id,
    actor: input.actor,
    reason: input.reason,
    createdAt: input.createdAt ?? nowIso(),
    expiresAt: input.expiresAt,
    targetRef: input.targetRef ?? input.plan.sourceBranchHint,
    baseBranch: input.plan.baseBranch,
    sourceBranch: input.plan.sourceBranchHint,
    permissionMode: input.permissionMode,
    policyVersion: input.policyVersion ?? executionIntentPolicyVersion,
    commandCandidates: input.plan.commandCandidates.map(copyCommandCandidate),
    status: input.status ?? (blockedReasons.length > 0 ? "blocked" : "created"),
    blockedReasons
  };
}

export function createPlanFingerprint(plan: PullRequestPlan): string {
  const fingerprintInput = {
    id: plan.id,
    runId: plan.runId,
    checkpointId: plan.checkpointId ?? null,
    sourceBranchHint: plan.sourceBranchHint,
    baseBranch: plan.baseBranch,
    title: plan.title,
    blockedReasons: plan.blockedReasons,
    commandCandidates: plan.commandCandidates.map(copyCommandCandidate)
  };

  return createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex");
}

export function parseExecutionIntent(value: unknown): ExecutionIntent {
  if (!isRecord(value)) {
    throw new Error("Invalid execution intent: expected object.");
  }

  const status = requireExecutionIntentStatus(value.status);
  const permissionMode = requirePermissionMode(value.permissionMode);
  const commandCandidates = requireCommandCandidates(value.commandCandidates);
  const blockedReasons = requireStringArray(value.blockedReasons, "blockedReasons");

  return {
    id: requireString(value.id, "id"),
    runId: requireString(value.runId, "runId"),
    planId: requireString(value.planId, "planId"),
    planFingerprint: requireString(value.planFingerprint, "planFingerprint"),
    checkpointId: optionalString(value.checkpointId, "checkpointId"),
    approvalId: requireString(value.approvalId, "approvalId"),
    actor: requireString(value.actor, "actor"),
    reason: optionalString(value.reason, "reason"),
    createdAt: requireString(value.createdAt, "createdAt"),
    expiresAt: requireString(value.expiresAt, "expiresAt"),
    targetRef: requireString(value.targetRef, "targetRef"),
    baseBranch: requireString(value.baseBranch, "baseBranch"),
    sourceBranch: requireString(value.sourceBranch, "sourceBranch"),
    permissionMode,
    policyVersion: requireString(value.policyVersion, "policyVersion"),
    commandCandidates,
    status,
    blockedReasons
  };
}

export function summarizeExecutionIntent(intent: ExecutionIntent): ExecutionIntentReport {
  const commandCandidateActions = intent.commandCandidates.map((candidate) => candidate.action);

  return {
    id: intent.id,
    runId: intent.runId,
    planId: intent.planId,
    approvalId: intent.approvalId,
    checkpointId: intent.checkpointId,
    status: intent.status,
    actor: intent.actor,
    reason: intent.reason,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    targetRef: intent.targetRef,
    baseBranch: intent.baseBranch,
    sourceBranch: intent.sourceBranch,
    permissionMode: intent.permissionMode,
    policyVersion: intent.policyVersion,
    commandCandidateCount: intent.commandCandidates.length,
    commandCandidateActions,
    commandActionSummary: summarizeCommandActions(commandCandidateActions),
    blockedReasonCount: intent.blockedReasons.length,
    blockedReasons: [...intent.blockedReasons],
    executionEnabled: false,
    writeExecution: "disabled"
  };
}

export function summarizeExecutionIntents(intents: ExecutionIntent[]): ExecutionIntentReport[] {
  return intents.map(summarizeExecutionIntent);
}

function executionIntentBlockedReasons(plan: PullRequestPlan, approval: ApprovalRecord): string[] {
  const reasons = [...plan.blockedReasons];

  if (!plan.checkpointId) {
    reasons.push("Execution intent requires a checkpoint id.");
  }

  if (approval.status !== "approved") {
    reasons.push(`Execution intent requires an approved approval record; current status is ${approval.status}.`);
  }

  if (approval.runId !== plan.runId) {
    reasons.push(`Approval run ${approval.runId} does not match plan run ${plan.runId}.`);
  }

  if (approval.planId !== plan.id) {
    reasons.push(`Approval plan ${approval.planId} does not match current plan ${plan.id}.`);
  }

  if (approval.checkpointId !== plan.checkpointId) {
    reasons.push(
      `Approval checkpoint ${approval.checkpointId ?? "none"} does not match current checkpoint ${
        plan.checkpointId ?? "none"
      }.`
    );
  }

  return reasons;
}

function summarizeCommandActions(
  actions: PullRequestCommandCandidate["action"][]
): ExecutionIntentCommandActionSummary[] {
  const counts = new Map<PullRequestCommandCandidate["action"], number>();

  for (const action of actions) {
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }

  return Array.from(counts, ([action, count]) => ({ action, count }));
}

function copyCommandCandidate(candidate: ExecutionIntentCommandCandidate): ExecutionIntentCommandCandidate {
  return {
    action: candidate.action,
    command: [...candidate.command],
    reason: candidate.reason,
    decisionReady: candidate.decisionReady
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid execution intent: ${field} must be a non-empty string.`);
  }

  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireString(value, field);
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid execution intent: ${field} must be a string array.`);
  }

  return [...value];
}

function requireExecutionIntentStatus(value: unknown): ExecutionIntentStatus {
  if (value === "created" || value === "blocked" || value === "expired") {
    return value;
  }

  throw new Error(`Invalid execution intent status: ${String(value)}.`);
}

function requirePermissionMode(value: unknown): PermissionMode {
  if (value === "read" || value === "write" || value === "maintainer") {
    return value;
  }

  throw new Error(`Invalid execution intent permissionMode: ${String(value)}.`);
}

function requireCommandCandidates(value: unknown): ExecutionIntentCommandCandidate[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid execution intent: commandCandidates must be an array.");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Invalid execution intent: commandCandidates items must be objects.");
    }

    const action = item.action;
    if (action !== "create_branch" && action !== "commit" && action !== "push" && action !== "create_pr") {
      throw new Error(`Invalid execution intent command action: ${String(action)}.`);
    }

    return {
      action,
      command: requireStringArray(item.command, "commandCandidates.command"),
      reason: requireString(item.reason, "commandCandidates.reason"),
      decisionReady: true
    };
  });
}

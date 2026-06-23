import { createHash } from "node:crypto";
import type {
  ApprovalRecord,
  ExecutionAuditBundle,
  ExecutionIntent,
  ExecutionIntentCommandCandidate,
  ExecutionIntentCommandActionSummary,
  ExecutionIntentReport,
  ExecutionIntentStatus,
  ExecutionTraceCommandCandidate,
  ExecutionTracePolicyDecision,
  ExecutionTraceRecord,
  ExecutionTraceReport,
  ExecutionTraceStatus,
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

export interface CreateExecutionDryRunTraceInput {
  intent: ExecutionIntent;
  candidate: ExecutionIntentCommandCandidate;
  createdAt?: string;
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

export function createExecutionDryRunTrace(input: CreateExecutionDryRunTraceInput): ExecutionTraceRecord {
  const blockedReasons = dryRunTraceBlockedReasons(input.intent);
  const status: ExecutionTraceStatus = blockedReasons.length > 0 ? "blocked" : "planned";
  const policyDecision: ExecutionTracePolicyDecision = status === "planned" ? "dry_run_planned" : "blocked";

  return {
    id: createId("trace"),
    intentId: input.intent.id,
    runId: input.intent.runId,
    planId: input.intent.planId,
    approvalId: input.intent.approvalId,
    checkpointId: input.intent.checkpointId,
    commandCandidate: copyTraceCommandCandidate(input.candidate),
    status,
    policyVersion: input.intent.policyVersion,
    policyDecision,
    blockedReasons,
    createdAt: input.createdAt ?? nowIso(),
    executionEnabled: false,
    writeExecution: "disabled"
  };
}

export function createExecutionDryRunTraces(
  intent: ExecutionIntent,
  options: { createdAt?: string } = {}
): ExecutionTraceRecord[] {
  return intent.commandCandidates.map((candidate) =>
    createExecutionDryRunTrace({ intent, candidate, createdAt: options.createdAt })
  );
}

export function parseExecutionTraceRecord(value: unknown): ExecutionTraceRecord {
  if (!isRecord(value)) {
    throw new Error("Invalid execution trace: expected object.");
  }

  const status = requireExecutionTraceStatus(value.status);
  const policyDecision = requireExecutionTracePolicyDecision(value.policyDecision);

  return {
    id: requireString(value.id, "id"),
    intentId: requireString(value.intentId, "intentId"),
    runId: requireString(value.runId, "runId"),
    planId: requireString(value.planId, "planId"),
    approvalId: requireString(value.approvalId, "approvalId"),
    checkpointId: optionalString(value.checkpointId, "checkpointId"),
    commandCandidate: requireTraceCommandCandidate(value.commandCandidate),
    status,
    policyVersion: requireString(value.policyVersion, "policyVersion"),
    policyDecision,
    blockedReasons: requireStringArray(value.blockedReasons, "blockedReasons"),
    createdAt: requireString(value.createdAt, "createdAt"),
    executionEnabled: requireFalse(value.executionEnabled, "executionEnabled"),
    writeExecution: requireDisabledWriteExecution(value.writeExecution)
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

export function summarizeExecutionTrace(trace: ExecutionTraceRecord): ExecutionTraceReport {
  return {
    id: trace.id,
    intentId: trace.intentId,
    runId: trace.runId,
    planId: trace.planId,
    approvalId: trace.approvalId,
    checkpointId: trace.checkpointId,
    action: trace.commandCandidate.action,
    argv: [...trace.commandCandidate.argv],
    reason: trace.commandCandidate.reason,
    status: trace.status,
    policyVersion: trace.policyVersion,
    policyDecision: trace.policyDecision,
    blockedReasonCount: trace.blockedReasons.length,
    blockedReasons: [...trace.blockedReasons],
    createdAt: trace.createdAt,
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

export function summarizeExecutionAuditBundle(
  intent: ExecutionIntent,
  traces: ExecutionTraceRecord[]
): ExecutionAuditBundle {
  const matchingTraces = traces.filter((trace) => trace.intentId === intent.id);
  const mismatchedTraces = traces.filter((trace) => trace.intentId !== intent.id);
  const traceReports = matchingTraces.map(summarizeExecutionTrace);
  const traceActions = traceReports.map((trace) => trace.action);
  const blockedReasons = uniqueStrings([
    ...intent.blockedReasons,
    ...traceReports.flatMap((trace) => trace.blockedReasons)
  ]);

  return {
    intent: summarizeExecutionIntent(intent),
    traces: traceReports,
    traceCount: traceReports.length,
    plannedTraceCount: traceReports.filter((trace) => trace.status === "planned").length,
    blockedTraceCount: traceReports.filter((trace) => trace.status === "blocked").length,
    traceActionSummary: summarizeCommandActions(traceActions),
    blockedReasonCount: blockedReasons.length,
    blockedReasons,
    mismatchedTraceCount: mismatchedTraces.length,
    mismatchedTraceIds: mismatchedTraces.map((trace) => trace.id),
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

export function summarizeExecutionAuditBundles(
  intents: ExecutionIntent[],
  traces: ExecutionTraceRecord[]
): ExecutionAuditBundle[] {
  return intents.map((intent) => summarizeExecutionAuditBundle(intent, traces));
}

function dryRunTraceBlockedReasons(intent: ExecutionIntent): string[] {
  const reasons = [...intent.blockedReasons];

  if (intent.status === "expired" || (intent.status === "blocked" && reasons.length === 0)) {
    reasons.push(`Execution intent status is ${intent.status}.`);
  }

  return reasons;
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
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

function copyTraceCommandCandidate(candidate: ExecutionIntentCommandCandidate): ExecutionTraceCommandCandidate {
  return {
    action: candidate.action,
    argv: [...candidate.command],
    reason: candidate.reason
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

function requireExecutionTraceStatus(value: unknown): ExecutionTraceStatus {
  if (value === "planned" || value === "blocked") {
    return value;
  }

  throw new Error(`Invalid execution trace status: ${String(value)}.`);
}

function requireExecutionTracePolicyDecision(value: unknown): ExecutionTracePolicyDecision {
  if (value === "dry_run_planned" || value === "blocked") {
    return value;
  }

  throw new Error(`Invalid execution trace policyDecision: ${String(value)}.`);
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

function requireTraceCommandCandidate(value: unknown): ExecutionTraceCommandCandidate {
  if (!isRecord(value)) {
    throw new Error("Invalid execution trace: commandCandidate must be an object.");
  }

  const action = value.action;
  if (action !== "create_branch" && action !== "commit" && action !== "push" && action !== "create_pr") {
    throw new Error(`Invalid execution trace command action: ${String(action)}.`);
  }

  return {
    action,
    argv: requireStringArray(value.argv, "commandCandidate.argv"),
    reason: requireString(value.reason, "commandCandidate.reason")
  };
}

function requireFalse(value: unknown, field: string): false {
  if (value !== false) {
    throw new Error(`Invalid execution trace: ${field} must be false.`);
  }

  return false;
}

function requireDisabledWriteExecution(value: unknown): "disabled" {
  if (value !== "disabled") {
    throw new Error("Invalid execution trace: writeExecution must be disabled.");
  }

  return "disabled";
}

import type {
  ExecutionIntent,
  ExecutionTraceRecord,
  PullRequestCommandCandidate,
  WriteExecutionReadinessReport,
  WriteRunnerDryRunPlanItem,
  WriteRunnerDryRunReport,
  WriteRunnerErrorReport,
  WriteRunnerExecutionMode,
  WriteRunnerExecutionPolicy,
  WriteRunnerSimulationResult
} from "./domain.js";
import { createExecutionDryRunTraces } from "./execution-intents.js";
import { nowIso } from "./ids.js";

export function createWriteRunnerDryRunTraces(
  intent: ExecutionIntent,
  readiness: WriteExecutionReadinessReport,
  options: { createdAt?: string } = {}
): ExecutionTraceRecord[] {
  if (!readiness.ready || intent.commandCandidates.length === 0) {
    return [];
  }

  return createExecutionDryRunTraces(intent, options);
}

export function summarizeWriteRunnerDryRun(
  intent: ExecutionIntent,
  readiness: WriteExecutionReadinessReport,
  traces: ExecutionTraceRecord[],
  options: {
    createdAt?: string;
    localTracePersistence?: WriteRunnerDryRunReport["localTracePersistence"];
    mode?: WriteRunnerExecutionMode;
    executor?: WriteRunnerExecutor;
  } = {}
): WriteRunnerDryRunReport {
  const mode = options.mode ?? "dry_run";
  const policy = createWriteRunnerExecutionPolicy(intent, readiness, mode);
  const blockedReasons = writeRunnerBlockedReasons(intent, readiness, policy);
  const status = writeRunnerStatus(mode, blockedReasons);
  const planItems =
    status === "planned" || status === "simulated" ? intent.commandCandidates.map((candidate) => planItem(intent, candidate)) : [];
  const simulationResults =
    status === "simulated" ? (options.executor ?? new SimulatedWriteRunnerExecutor()).simulate(planItems, policy) : [];

  return {
    status,
    intentId: intent.id,
    runId: intent.runId,
    planId: intent.planId,
    approvalId: intent.approvalId,
    ...(intent.checkpointId ? { checkpointId: intent.checkpointId } : {}),
    readinessStatus: readiness.readinessStatus,
    ready: readiness.ready,
    planItemCount: planItems.length,
    planItems,
    traceCount: traces.length,
    traceIds: traces.map((trace) => trace.id),
    localTracePersistence: options.localTracePersistence ?? (traces.length > 0 ? "saved" : "skipped"),
    policy,
    simulationResultCount: simulationResults.length,
    simulationResults,
    blockedReasonCount: blockedReasons.length,
    blockedReasons,
    createdAt: options.createdAt ?? nowIso(),
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

export interface WriteRunnerExecutor {
  simulate(planItems: WriteRunnerDryRunPlanItem[], policy: WriteRunnerExecutionPolicy): WriteRunnerSimulationResult[];
}

export class SimulatedWriteRunnerExecutor implements WriteRunnerExecutor {
  simulate(planItems: WriteRunnerDryRunPlanItem[], policy: WriteRunnerExecutionPolicy): WriteRunnerSimulationResult[] {
    if (policy.mode !== "simulate" || policy.blockers.length > 0) {
      return [];
    }

    return planItems.map((item) => ({
      action: item.action,
      status: "simulated",
      summary: simulationSummary(item.action),
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    }));
  }
}

export function createWriteRunnerExecutionPolicy(
  intent: ExecutionIntent,
  readiness: WriteExecutionReadinessReport,
  mode: WriteRunnerExecutionMode = "dry_run"
): WriteRunnerExecutionPolicy {
  const allowedActions = intent.commandCandidates.map((candidate) => candidate.action);
  const blockers = readiness.ready
    ? mode === "execute_disabled"
      ? ["Actual write execution is disabled; use simulate mode until the guarded executor is implemented."]
      : []
    : [`Write readiness is ${readiness.readinessStatus}.`];

  return {
    mode,
    requiredReadiness: "ready",
    allowedActions,
    disallowedActions: [],
    blockers,
    actualExecutionEnabled: false,
    executionEnabled: false,
    writeExecution: "disabled"
  };
}

export function createWriteRunnerErrorReport(
  errorCode: WriteRunnerErrorReport["errorCode"],
  message: string,
  options: {
    status?: WriteRunnerErrorReport["status"];
    intentId?: string;
    details?: WriteRunnerErrorReport["details"];
  } = {}
): WriteRunnerErrorReport {
  return {
    status: options.status ?? "error",
    errorCode,
    message,
    ...(options.intentId ? { intentId: options.intentId } : {}),
    ...(options.details ? { details: options.details } : {}),
    dryRun: null,
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

export function formatWriteRunnerError(report: WriteRunnerErrorReport): string {
  const lines = [
    "Write runner dry-run error:",
    `Status: ${report.status}`,
    `Code: ${report.errorCode}`,
    `Message: ${report.message}`,
    ...(report.intentId ? [`Intent: ${report.intentId}`] : []),
    ...(report.details ? [`Details: ${report.details.kind}`] : []),
    `Execution: ${report.executionEnabled ? "enabled" : "disabled"}`,
    `Write execution: ${report.writeExecution}`,
    "Re-run with --json for machine-readable error details."
  ];

  return `${lines.join("\n")}\n`;
}

function writeRunnerBlockedReasons(
  intent: ExecutionIntent,
  readiness: WriteExecutionReadinessReport,
  policy: WriteRunnerExecutionPolicy
): string[] {
  const reasons = [...policy.blockers, ...readiness.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`)];

  if (!readiness.ready && reasons.length === 0) {
    reasons.push(`Write readiness is ${readiness.readinessStatus}.`);
  }

  if (intent.commandCandidates.length === 0) {
    reasons.push("Execution intent has no command candidates.");
  }

  return Array.from(new Set(reasons));
}

function writeRunnerStatus(mode: WriteRunnerExecutionMode, blockedReasons: string[]): WriteRunnerDryRunReport["status"] {
  if (mode === "execute_disabled") {
    return "disabled";
  }

  if (blockedReasons.length > 0) {
    return "blocked";
  }

  return mode === "simulate" ? "simulated" : "planned";
}

function planItem(intent: ExecutionIntent, candidate: ExecutionIntent["commandCandidates"][number]): WriteRunnerDryRunPlanItem {
  const common = {
    action: candidate.action,
    summary: summaryForAction(candidate.action),
    sourceBranch: intent.sourceBranch,
    baseBranch: intent.baseBranch,
    targetRef: intent.targetRef
  };

  if (candidate.action === "create_branch") {
    return {
      ...common,
      branchNameCandidate: intent.sourceBranch
    };
  }

  if (candidate.action === "commit") {
    return {
      ...common,
      commitMessageCandidate: `Run ${intent.runId}: prepare approved changes`
    };
  }

  if (candidate.action === "create_pr") {
    return {
      ...common,
      prTitleCandidate: `Run ${intent.runId}`,
      prBodyCandidate: `Prepared from execution intent ${intent.id}.`
    };
  }

  return common;
}

function summaryForAction(action: PullRequestCommandCandidate["action"]): string {
  if (action === "create_branch") {
    return "Plan branch creation without creating the branch.";
  }
  if (action === "commit") {
    return "Plan commit metadata without creating a commit.";
  }
  if (action === "push") {
    return "Plan push target without pushing.";
  }
  return "Plan PR creation metadata without creating a GitHub PR.";
}

function simulationSummary(action: PullRequestCommandCandidate["action"]): string {
  if (action === "create_branch") {
    return "Simulated branch creation boundary without creating a branch.";
  }
  if (action === "commit") {
    return "Simulated commit boundary without creating a commit.";
  }
  if (action === "push") {
    return "Simulated push boundary without pushing.";
  }
  return "Simulated PR creation boundary without creating a GitHub PR.";
}

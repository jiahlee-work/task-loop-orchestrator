import { spawn } from "node:child_process";
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
  WriteRunnerLocalExecutionResult,
  WriteRunnerSimulationResult,
  WriteRunnerVerificationAction
} from "./domain.js";
import { createExecutionDryRunTraces } from "./execution-intents.js";
import { nowIso } from "./ids.js";

export const writeRunnerVerificationActions: readonly WriteRunnerVerificationAction[] = [
  "typecheck",
  "test",
  "build",
  "lint",
  "package:smoke",
  "release:check"
];

const verificationScriptByAction: Record<WriteRunnerVerificationAction, string> = {
  typecheck: "typecheck",
  test: "test",
  build: "build",
  lint: "lint",
  "package:smoke": "package:smoke",
  "release:check": "release:check"
};

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
    localExecutionResults?: WriteRunnerLocalExecutionResult[];
  } = {}
): WriteRunnerDryRunReport {
  const mode = options.mode ?? "dry_run";
  const policy = createWriteRunnerExecutionPolicy(intent, readiness, mode);
  const blockedReasons = writeRunnerBlockedReasons(intent, readiness, policy);
  const localExecutionResults = options.localExecutionResults ?? [];
  const status = writeRunnerStatus(mode, blockedReasons, localExecutionResults);
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
    localExecutionResultCount: localExecutionResults.length,
    localExecutionResults,
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

export interface GuardedLocalVerificationExecutorOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  now?: () => number;
}

export interface GuardedLocalVerificationExecutionOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
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

export class GuardedLocalVerificationExecutor {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly now: () => number;

  constructor(options: GuardedLocalVerificationExecutorOptions) {
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 64_000;
    this.now = options.now ?? Date.now;
  }

  async execute(
    action: WriteRunnerVerificationAction,
    policy: WriteRunnerExecutionPolicy,
    options: GuardedLocalVerificationExecutionOptions = {}
  ): Promise<WriteRunnerLocalExecutionResult> {
    if (policy.mode !== "execute_local" || policy.blockers.length > 0 || !policy.localExecutionEnabled) {
      return localExecutionResult(action, "blocked", "Verification execution was blocked by policy.", 0);
    }

    if (!isWriteRunnerVerificationAction(action) || !policy.allowedVerificationActions.includes(action)) {
      return localExecutionResult(action, "blocked", "Verification action is not allowlisted.", 0);
    }

    const startedAt = this.now();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxOutputBytes = options.maxOutputBytes ?? this.maxOutputBytes;

    return new Promise((resolve) => {
      let settled = false;
      let observedOutputBytes = 0;
      const child = spawn("pnpm", ["run", verificationScriptByAction[action]], {
        cwd: this.cwd,
        env: sanitizedExecutionEnv(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGTERM");
        resolve(localExecutionResult(action, "timed_out", "Verification script timed out.", this.now() - startedAt));
      }, timeoutMs);

      const observeOutput = (chunk: Buffer | string) => {
        if (observedOutputBytes >= maxOutputBytes) {
          return;
        }
        observedOutputBytes = Math.min(maxOutputBytes, observedOutputBytes + Buffer.byteLength(chunk));
      };

      child.stdout?.on("data", observeOutput);
      child.stderr?.on("data", observeOutput);

      child.on("error", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(localExecutionResult(action, "failed", "Verification script could not be started.", this.now() - startedAt));
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const durationMs = this.now() - startedAt;
        const status = code === 0 ? "succeeded" : "failed";
        const summary = code === 0 ? "Verification script completed successfully." : "Verification script failed.";
        resolve(localExecutionResult(action, status, summary, durationMs));
      });
    });
  }
}

export function createWriteRunnerExecutionPolicy(
  intent: ExecutionIntent,
  readiness: WriteExecutionReadinessReport,
  mode: WriteRunnerExecutionMode = "dry_run"
): WriteRunnerExecutionPolicy {
  const allowedActions = intent.commandCandidates.map((candidate) => candidate.action);
  const localExecutionEnabled = readiness.ready && mode === "execute_local";
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
    allowedVerificationActions: [...writeRunnerVerificationActions],
    blockers,
    localExecutionEnabled,
    localExecutionScope: localExecutionEnabled ? "verification_only" : "disabled",
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

export function isWriteRunnerVerificationAction(value: string): value is WriteRunnerVerificationAction {
  return writeRunnerVerificationActions.includes(value as WriteRunnerVerificationAction);
}

function writeRunnerStatus(
  mode: WriteRunnerExecutionMode,
  blockedReasons: string[],
  localExecutionResults: WriteRunnerLocalExecutionResult[]
): WriteRunnerDryRunReport["status"] {
  if (mode === "execute_disabled") {
    return "disabled";
  }

  if (blockedReasons.length > 0) {
    return "blocked";
  }

  if (mode === "execute_local") {
    return localExecutionResults.length > 0 && localExecutionResults.every((result) => result.status === "succeeded")
      ? "local_executed"
      : "local_failed";
  }

  return mode === "simulate" ? "simulated" : "planned";
}

function localExecutionResult(
  action: WriteRunnerVerificationAction,
  status: WriteRunnerLocalExecutionResult["status"],
  summary: string,
  durationMs: number
): WriteRunnerLocalExecutionResult {
  return {
    action,
    status,
    summary,
    durationMs: Math.max(0, Math.round(durationMs)),
    outputCaptured: false,
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

function sanitizedExecutionEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }
  if (process.env.HOME) {
    env.HOME = process.env.HOME;
  }
  if (process.env.SystemRoot) {
    env.SystemRoot = process.env.SystemRoot;
  }
  if (process.env.TMPDIR) {
    env.TMPDIR = process.env.TMPDIR;
  }
  return env;
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

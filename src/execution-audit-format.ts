import type {
  ExecutionAuditBundle,
  ExecutionAuditErrorReport,
  ExecutionAuditListReport,
  ExecutionIntentCommandActionSummary
} from "./domain.js";

export function formatExecutionAuditBundle(bundle: ExecutionAuditBundle): string {
  const lines = [
    `Execution audit: ${bundle.intent.id}`,
    `Status: ${bundle.intent.status}`,
    `Run: ${bundle.intent.runId}`,
    `Plan: ${bundle.intent.planId}`,
    `Approval: ${bundle.intent.approvalId}`,
    `Checkpoint: ${bundle.intent.checkpointId ?? "none"}`,
    `Created: ${bundle.intent.createdAt}`,
    `Base: ${bundle.intent.baseBranch}`,
    `Source: ${bundle.intent.sourceBranch}`,
    `Target ref: ${bundle.intent.targetRef}`,
    `Execution: ${bundle.executionEnabled ? "enabled" : "disabled"}`,
    `Write execution: ${bundle.writeExecution}`,
    `Dry-run traces: ${bundle.traceCount} total, ${bundle.plannedTraceCount} planned, ${bundle.blockedTraceCount} blocked`,
    `Actions: ${formatActionSummary(bundle.traceActionSummary)}`,
    `Blocked reasons: ${bundle.blockedReasonCount}`,
    ...formatIndentedList(bundle.blockedReasons),
    `Mismatched traces: ${bundle.mismatchedTraceCount}`,
    ...formatIndentedList(bundle.mismatchedTraceIds),
    "Trace summary:",
    ...formatTraceSummary(bundle)
  ];

  return `${lines.join("\n")}\n`;
}

export function formatExecutionAuditList(report: ExecutionAuditListReport): string {
  const lines = [
    "Execution audit bundles",
    `Bundles: ${report.bundleCount}`,
    `Execution: ${report.executionEnabled ? "enabled" : "disabled"}`,
    `Write execution: ${report.writeExecution}`,
    "Order: newest first by execution intent createdAt"
  ];

  if (report.bundleCount === 0) {
    lines.push("No execution audit bundles found.");
  } else {
    lines.push(
      ...report.bundles.map((bundle) =>
        [
          `- ${bundle.intent.id}`,
          `status=${bundle.intent.status}`,
          `run=${bundle.intent.runId}`,
          `plan=${bundle.intent.planId}`,
          `traces=${bundle.traceCount}`,
          `blockedReasons=${bundle.blockedReasonCount}`,
          `createdAt=${bundle.intent.createdAt}`
        ].join(" ")
      )
    );
  }

  return `${lines.join("\n")}\n`;
}

export function formatExecutionAuditError(payload: ExecutionAuditErrorReport): string {
  const lines = [
    `Execution audit error: ${payload.message}`,
    `Code: ${payload.errorCode}`,
    `Status: ${payload.status}`,
    `Execution: ${payload.executionEnabled ? "enabled" : "disabled"}`,
    `Write execution: ${payload.writeExecution}`,
    "Re-run with --json for machine-readable error details."
  ];

  if (payload.intentId) {
    lines.splice(3, 0, `Intent: ${payload.intentId}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatActionSummary(actions: ExecutionIntentCommandActionSummary[]): string {
  if (actions.length === 0) {
    return "none";
  }

  return actions.map((item) => `${item.action}=${item.count}`).join(", ");
}

function formatIndentedList(values: string[]): string[] {
  return values.map((value) => `  - ${value}`);
}

function formatTraceSummary(bundle: ExecutionAuditBundle): string[] {
  if (bundle.traces.length === 0) {
    return ["  - none"];
  }

  return bundle.traces.map(
    (trace) => `  - ${trace.action}: ${trace.status}, policy=${trace.policyDecision}, reason=${trace.reason}`
  );
}

import type {
  ExecutionAuditBundle,
  WriteExecutionReadinessBlocker,
  WriteExecutionReadinessCategory,
  WriteExecutionReadinessCheck,
  WriteExecutionReadinessPreflightInput,
  WriteExecutionReadinessReport
} from "./domain.js";

type PreflightKey = keyof WriteExecutionReadinessPreflightInput;

interface PreflightCheckDefinition {
  key: PreflightKey;
  category: WriteExecutionReadinessCategory;
  code: string;
  unknownMessage: string;
  passMessage: string;
  blockedMessage: string;
}

const preflightChecks: PreflightCheckDefinition[] = [
  {
    key: "approvalFresh",
    category: "approval",
    code: "approval_freshness_unverified",
    unknownMessage: "Approval freshness has not been verified.",
    passMessage: "Approval freshness is verified.",
    blockedMessage: "Approval is stale or missing."
  },
  {
    key: "approvalNotExpired",
    category: "approval",
    code: "approval_expiration_unverified",
    unknownMessage: "Approval expiration has not been verified.",
    passMessage: "Approval is not expired.",
    blockedMessage: "Approval is expired."
  },
  {
    key: "planFingerprintMatches",
    category: "policy",
    code: "plan_fingerprint_unverified",
    unknownMessage: "Plan fingerprint has not been compared with the approved plan.",
    passMessage: "Plan fingerprint matches the approved plan.",
    blockedMessage: "Plan fingerprint does not match the approved plan."
  },
  {
    key: "checkpointMatches",
    category: "precondition",
    code: "checkpoint_match_unverified",
    unknownMessage: "Latest checkpoint has not been compared with the approved checkpoint.",
    passMessage: "Latest checkpoint matches the approved checkpoint.",
    blockedMessage: "Latest checkpoint does not match the approved checkpoint."
  },
  {
    key: "repoClean",
    category: "repo_state",
    code: "repo_cleanliness_unverified",
    unknownMessage: "Repository cleanliness has not been verified.",
    passMessage: "Repository cleanliness satisfies policy.",
    blockedMessage: "Repository state does not satisfy cleanliness policy."
  },
  {
    key: "diffVerified",
    category: "repo_state",
    code: "diff_verification_unverified",
    unknownMessage: "Diff verification has not run.",
    passMessage: "Diff verification passed.",
    blockedMessage: "Diff verification failed."
  },
  {
    key: "refPolicySatisfied",
    category: "policy",
    code: "ref_policy_unverified",
    unknownMessage: "Target ref and branch policy have not been verified.",
    passMessage: "Target ref and branch policy are satisfied.",
    blockedMessage: "Target ref or branch policy is not satisfied."
  },
  {
    key: "ciPolicySatisfied",
    category: "ci",
    code: "ci_policy_unverified",
    unknownMessage: "CI/check policy has not been verified.",
    passMessage: "CI/check policy is satisfied.",
    blockedMessage: "CI/check policy is not satisfied."
  },
  {
    key: "permissionAllowed",
    category: "permission",
    code: "permission_gate_unverified",
    unknownMessage: "Permission gate has not been verified for the approved action.",
    passMessage: "Permission gate allows the approved action.",
    blockedMessage: "Permission gate blocks the approved action."
  },
  {
    key: "commandRunnerConfigured",
    category: "policy",
    code: "command_runner_unverified",
    unknownMessage: "Command runner write configuration has not been verified.",
    passMessage: "Command runner write configuration is available.",
    blockedMessage: "Command runner write configuration is unavailable."
  }
];

export function summarizeWriteExecutionReadiness(
  bundle: ExecutionAuditBundle,
  preflight?: WriteExecutionReadinessPreflightInput
): WriteExecutionReadinessReport {
  const blockers: WriteExecutionReadinessBlocker[] = [];
  const checks: WriteExecutionReadinessCheck[] = [];

  addAuditBundleChecks(bundle, blockers, checks);
  addPreflightChecks(preflight, blockers, checks);

  const readinessStatus =
    blockers.length > 0 ? "blocked" : checks.some((check) => check.status === "unknown") ? "unknown" : "ready";

  return {
    readinessStatus,
    ready: readinessStatus === "ready",
    intentId: bundle.intent.id,
    runId: bundle.intent.runId,
    planId: bundle.intent.planId,
    approvalId: bundle.intent.approvalId,
    ...(bundle.intent.checkpointId ? { checkpointId: bundle.intent.checkpointId } : {}),
    blockers,
    checks,
    inputs: {
      auditBundle: "available",
      preflight: preflightAvailability(preflight)
    },
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

export function formatWriteExecutionReadiness(report: WriteExecutionReadinessReport): string {
  const lines = [
    `Write execution readiness: ${report.intentId}`,
    `Status: ${report.readinessStatus}`,
    `Ready: ${formatReadyValue(report)}`,
    `Run: ${report.runId}`,
    `Plan: ${report.planId}`,
    `Approval: ${report.approvalId}`,
    `Checkpoint: ${report.checkpointId ?? "none"}`,
    `Execution: ${report.executionEnabled ? "enabled" : "disabled"}`,
    `Write execution: ${report.writeExecution}`,
    `Inputs: auditBundle=${report.inputs.auditBundle}, preflight=${report.inputs.preflight}`,
    "Blockers:",
    ...formatBlockers(report),
    "Checks:",
    ...formatChecks(report),
    "Use --json for the stable automation contract."
  ];

  return `${lines.join("\n")}\n`;
}

function addAuditBundleChecks(
  bundle: ExecutionAuditBundle,
  blockers: WriteExecutionReadinessBlocker[],
  checks: WriteExecutionReadinessCheck[]
): void {
  if (bundle.blockedTraceCount > 0) {
    const message = `${bundle.blockedTraceCount} dry-run trace(s) are blocked.`;
    checks.push(auditCheck("trace", "blocked", "blocked_dry_run_trace", message));
    blockers.push(auditBlocker("trace", "blocked_dry_run_trace", message));
  } else {
    checks.push(auditCheck("trace", "pass", "dry_run_traces_not_blocked", "Dry-run traces are not blocked."));
  }

  if (bundle.blockedReasonCount > 0) {
    checks.push(
      auditCheck(
        "precondition",
        "blocked",
        "audit_blocked_reasons_present",
        `${bundle.blockedReasonCount} audit blocked reason(s) are present.`
      )
    );
    for (const reason of bundle.blockedReasons) {
      blockers.push(auditBlocker("precondition", "audit_blocked_reason", reason));
    }
  } else {
    checks.push(auditCheck("precondition", "pass", "audit_blocked_reasons_absent", "No audit blocked reasons are present."));
  }

  if (bundle.mismatchedTraceCount > 0) {
    const message = `${bundle.mismatchedTraceCount} trace record(s) do not belong to this intent.`;
    checks.push(auditCheck("trace", "blocked", "mismatched_trace_records", message));
    blockers.push(auditBlocker("trace", "mismatched_trace_records", message));
  } else {
    checks.push(auditCheck("trace", "pass", "no_mismatched_trace_records", "No mismatched trace records are present."));
  }
}

function addPreflightChecks(
  preflight: WriteExecutionReadinessPreflightInput | undefined,
  blockers: WriteExecutionReadinessBlocker[],
  checks: WriteExecutionReadinessCheck[]
): void {
  for (const definition of preflightChecks) {
    const value = preflight?.[definition.key];
    if (value === true) {
      checks.push(preflightCheck(definition.category, "pass", passCode(definition.code), definition.passMessage));
      continue;
    }

    if (value === false) {
      checks.push(preflightCheck(definition.category, "blocked", blockedCode(definition.code), definition.blockedMessage));
      blockers.push(preflightBlocker(definition.category, blockedCode(definition.code), definition.blockedMessage));
      continue;
    }

    checks.push(preflightCheck(definition.category, "unknown", definition.code, definition.unknownMessage));
  }
}

function preflightAvailability(preflight: WriteExecutionReadinessPreflightInput | undefined): "missing" | "partial" | "available" {
  if (!preflight) {
    return "missing";
  }

  return preflightChecks.every((definition) => preflight[definition.key] !== undefined) ? "available" : "partial";
}

function auditCheck(
  category: WriteExecutionReadinessCategory,
  status: WriteExecutionReadinessCheck["status"],
  code: string,
  message: string
): WriteExecutionReadinessCheck {
  return { category, status, code, message, source: "audit_bundle" };
}

function preflightCheck(
  category: WriteExecutionReadinessCategory,
  status: WriteExecutionReadinessCheck["status"],
  code: string,
  message: string
): WriteExecutionReadinessCheck {
  return { category, status, code, message, source: "preflight" };
}

function auditBlocker(category: WriteExecutionReadinessCategory, code: string, message: string): WriteExecutionReadinessBlocker {
  return { category, code, message, source: "audit_bundle" };
}

function preflightBlocker(category: WriteExecutionReadinessCategory, code: string, message: string): WriteExecutionReadinessBlocker {
  return { category, code, message, source: "preflight" };
}

function passCode(code: string): string {
  return code.replace(/_unverified$/, "_passed");
}

function blockedCode(code: string): string {
  return code.replace(/_unverified$/, "_blocked");
}

function formatReadyValue(report: WriteExecutionReadinessReport): "yes" | "no" | "unknown" {
  if (report.ready) {
    return "yes";
  }

  return report.readinessStatus === "unknown" ? "unknown" : "no";
}

function formatBlockers(report: WriteExecutionReadinessReport): string[] {
  if (report.blockers.length === 0) {
    return ["  - none"];
  }

  return groupedLines(report.blockers, (blocker) => `    - ${blocker.code}: ${blocker.message} (${blocker.source})`);
}

function formatChecks(report: WriteExecutionReadinessReport): string[] {
  if (report.checks.length === 0) {
    return ["  - none"];
  }

  return groupedLines(report.checks, (check) => `    - [${check.status}] ${check.code}: ${check.message} (${check.source})`);
}

function groupedLines<T extends { category: WriteExecutionReadinessCategory }>(
  items: T[],
  formatItem: (item: T) => string
): string[] {
  const categories = [...new Set(items.map((item) => item.category))];
  return categories.flatMap((category) => [
    `  ${category}:`,
    ...items.filter((item) => item.category === category).map(formatItem)
  ]);
}

import { describe, expect, it } from "vitest";
import { createPullRequestApproval } from "../src/approval.js";
import type { ExecutionAuditErrorReport, PullRequestPlan } from "../src/domain.js";
import {
  formatExecutionAuditBundle,
  formatExecutionAuditError,
  formatExecutionAuditList
} from "../src/execution-audit-format.js";
import {
  createExecutionDryRunTraces,
  createExecutionIntent,
  summarizeExecutionAuditBundle,
  summarizeExecutionAuditList
} from "../src/execution-intents.js";

describe("execution audit plain formatters", () => {
  it("formats single audit bundles with safe human-readable summary fields", () => {
    const secret = "top-secret-command-token";
    const intent = executionIntent("2026-06-22T00:00:00.000Z", {
      blockedReasons: ["Repository status is not clean."],
      commandSecret: secret
    });
    const [trace] = createExecutionDryRunTraces(intent, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });
    const otherIntent = executionIntent("2026-06-21T00:00:00.000Z");
    const [mismatchedTrace] = createExecutionDryRunTraces(otherIntent, {
      createdAt: "2026-06-21T01:00:00.000Z"
    });
    const bundle = summarizeExecutionAuditBundle(intent, [trace, mismatchedTrace]);

    const output = formatExecutionAuditBundle(bundle);

    expect(output).toContain(`Execution audit: ${intent.id}`);
    expect(output).toContain("Status: blocked");
    expect(output).toContain(`Run: ${intent.runId}`);
    expect(output).toContain("Plan: prplan-1");
    expect(output).toContain("Approval: ");
    expect(output).toContain("Checkpoint: checkpoint-1");
    expect(output).toContain("Created: 2026-06-22T00:00:00.000Z");
    expect(output).toContain("Base: main");
    expect(output).toContain("Source: orchestrator/run1");
    expect(output).toContain("Target ref: orchestrator/run1");
    expect(output).toContain("Execution: disabled");
    expect(output).toContain("Write execution: disabled");
    expect(output).toContain("Dry-run traces: 1 total, 0 planned, 1 blocked");
    expect(output).toContain("Actions: create_branch=1");
    expect(output).toContain("Blocked reasons: 1");
    expect(output).toContain("Repository status is not clean.");
    expect(output).toContain("Mismatched traces: 1");
    expect(output).toContain(mismatchedTrace.id);
    expect(output).toContain("Trace summary:");
    expect(output).toContain("create_branch: blocked, policy=blocked, reason=Create branch.");
    expectNoUnsafeExecutionOutput(output, secret);
  });

  it("formats audit lists with bundle count, empty state, newest-first note, and one-line summaries", () => {
    const older = summarizeExecutionAuditBundle(
      executionIntent("2026-06-22T00:00:00.000Z"),
      []
    );
    const newerIntent = executionIntent("2026-06-23T00:00:00.000Z");
    const newer = summarizeExecutionAuditBundle(
      newerIntent,
      createExecutionDryRunTraces(newerIntent, { createdAt: "2026-06-23T01:00:00.000Z" })
    );
    const report = summarizeExecutionAuditList([newer, older]);

    const output = formatExecutionAuditList(report);

    expect(output).toContain("Execution audit bundles");
    expect(output).toContain("Bundles: 2");
    expect(output).toContain("Execution: disabled");
    expect(output).toContain("Write execution: disabled");
    expect(output).toContain("Order: newest first by execution intent createdAt");
    expect(output).toContain(`- ${newer.intent.id} status=created run=run-1 plan=prplan-1 traces=1 blockedReasons=0 createdAt=2026-06-23T00:00:00.000Z`);
    expect(output).toContain(`- ${older.intent.id} status=created run=run-1 plan=prplan-1 traces=0 blockedReasons=0 createdAt=2026-06-22T00:00:00.000Z`);
    expectNoUnsafeExecutionOutput(output);

    const emptyOutput = formatExecutionAuditList(summarizeExecutionAuditList([]));
    expect(emptyOutput).toContain("Execution audit bundles");
    expect(emptyOutput).toContain("Bundles: 0");
    expect(emptyOutput).toContain("No execution audit bundles found.");
    expectNoUnsafeExecutionOutput(emptyOutput);
  });

  it("formats short plain errors with JSON recommendation and no unsafe details", () => {
    const error = executionAuditError({
      errorCode: "invalid_execution_intent_file",
      message: "Invalid execution intent file.",
      details: { kind: "execution_intent" }
    });

    const output = formatExecutionAuditError(error);

    expect(output).toContain("Execution audit error: Invalid execution intent file.");
    expect(output).toContain("Code: invalid_execution_intent_file");
    expect(output).toContain("Status: error");
    expect(output).toContain("Intent: intent-format-error");
    expect(output).toContain("Execution: disabled");
    expect(output).toContain("Write execution: disabled");
    expect(output).toContain("Re-run with --json for machine-readable error details.");
    expect(output).not.toContain("Details:");
    expectNoUnsafeExecutionOutput(output, "top-secret-error-fixture");
  });
});

function executionIntent(
  createdAt: string,
  options: { blockedReasons?: string[]; commandSecret?: string } = {}
) {
  const plan = prPlan(options);
  const approval = createPullRequestApproval(plan, {
    approvedBy: "maintainer",
    reason: "Reviewed current checkpoint and PR plan."
  });

  return createExecutionIntent({
    plan,
    approval,
    actor: "maintainer",
    reason: "Prepare audited write execution intent.",
    createdAt,
    expiresAt: "2026-06-24T00:00:00.000Z",
    permissionMode: "maintainer"
  });
}

function prPlan(options: { blockedReasons?: string[]; commandSecret?: string } = {}): PullRequestPlan {
  return {
    id: "prplan-1",
    runId: "run-1",
    checkpointId: "checkpoint-1",
    sourceBranchHint: "orchestrator/run1",
    baseBranch: "main",
    title: "Prepare PR workflow",
    body: "PR body",
    preconditions: ["Review this plan."],
    blockedReasons: options.blockedReasons ?? [],
    commandCandidates: [
      {
        action: "create_branch",
        command: ["git", "switch", "-c", "orchestrator/run1", options.commandSecret ?? "safe-arg"],
        reason: "Create branch.",
        decisionReady: true
      }
    ],
    createdAt: "2026-06-22T00:00:00.000Z"
  };
}

function executionAuditError(input: {
  errorCode: string;
  message: string;
  details?: ExecutionAuditErrorReport["details"];
}): ExecutionAuditErrorReport {
  return {
    status: "error",
    errorCode: input.errorCode,
    message: input.message,
    intentId: "intent-format-error",
    intent: null,
    details: input.details,
    executionEnabled: false,
    writeExecution: "disabled",
    hasExecutionResults: false
  };
}

function expectNoUnsafeExecutionOutput(output: string, secret = "top-secret-fixture"): void {
  expect(output).not.toContain(secret);
  expect(output).not.toContain("executedCommands");
  expect(output).not.toContain("stdout");
  expect(output).not.toContain("stderr");
  expect(output).not.toContain("exitCode");
  expect(output).not.toContain("stack");
}

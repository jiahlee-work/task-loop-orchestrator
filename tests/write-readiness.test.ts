import { describe, expect, it } from "vitest";
import { createPullRequestApproval } from "../src/approval.js";
import type { ExecutionAuditBundle, PullRequestPlan, WriteExecutionReadinessPreflightInput } from "../src/domain.js";
import {
  createExecutionDryRunTraces,
  createExecutionIntent,
  summarizeExecutionAuditBundle
} from "../src/execution-intents.js";
import { formatWriteExecutionReadiness, summarizeWriteExecutionReadiness } from "../src/write-readiness.js";

describe("write execution readiness helper", () => {
  it("blocks readiness when the audit bundle contains blocked traces or blocked reasons", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."]);
    const bundle = executionAuditBundle("2026-06-22T00:00:00.000Z", {
      approvedPlan,
      currentPlan
    });

    const report = summarizeWriteExecutionReadiness(bundle);

    expect(report.readinessStatus).toBe("blocked");
    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "trace",
          code: "blocked_dry_run_trace",
          source: "audit_bundle"
        }),
        expect.objectContaining({
          category: "precondition",
          code: "audit_blocked_reason",
          message: "Repository status is not clean.",
          source: "audit_bundle"
        })
      ])
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "trace", status: "blocked", source: "audit_bundle" }),
        expect.objectContaining({ category: "precondition", status: "blocked", source: "audit_bundle" })
      ])
    );
    expect(report.executionEnabled).toBe(false);
    expect(report.writeExecution).toBe("disabled");
    expect(report.hasExecutionResults).toBe(false);
    expectNoUnsafeReadinessOutput(report);
  });

  it("returns unknown readiness when future preflight input is missing", () => {
    const bundle = executionAuditBundle("2026-06-22T00:00:00.000Z", {
      commandSecret: "top-secret-readiness"
    });

    const report = summarizeWriteExecutionReadiness(bundle);

    expect(report.readinessStatus).toBe("unknown");
    expect(report.ready).toBe(false);
    expect(report.inputs).toEqual({
      auditBundle: "available",
      preflight: "missing"
    });
    expect(report.blockers).toEqual([]);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "approval", status: "unknown", code: "approval_freshness_unverified" }),
        expect.objectContaining({ category: "ci", status: "unknown", code: "ci_policy_unverified" }),
        expect.objectContaining({ category: "repo_state", status: "unknown", code: "repo_cleanliness_unverified" }),
        expect.objectContaining({ category: "policy", status: "unknown", code: "plan_fingerprint_unverified" })
      ])
    );
    expectNoUnsafeReadinessOutput(report);
  });

  it("can report ready only when all preflight checks pass and audit bundle has no blockers", () => {
    const bundle = executionAuditBundle("2026-06-22T00:00:00.000Z");

    const report = summarizeWriteExecutionReadiness(bundle, passingPreflight());

    expect(report.readinessStatus).toBe("ready");
    expect(report.ready).toBe(true);
    expect(report.inputs.preflight).toBe("available");
    expect(report.blockers).toEqual([]);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report).toMatchObject({
      intentId: bundle.intent.id,
      runId: bundle.intent.runId,
      planId: bundle.intent.planId,
      approvalId: bundle.intent.approvalId,
      checkpointId: bundle.intent.checkpointId,
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    });
    expectNoUnsafeReadinessOutput(report);
  });

  it("turns failed preflight checks into blockers without mutating the input bundle", () => {
    const bundle = executionAuditBundle("2026-06-22T00:00:00.000Z");
    const before = JSON.stringify(bundle);

    const report = summarizeWriteExecutionReadiness(bundle, {
      ...passingPreflight(),
      ciPolicySatisfied: false,
      repoClean: false
    });

    expect(JSON.stringify(bundle)).toBe(before);
    expect(report.readinessStatus).toBe("blocked");
    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "ci", code: "ci_policy_blocked", source: "preflight" }),
        expect.objectContaining({ category: "repo_state", code: "repo_cleanliness_blocked", source: "preflight" })
      ])
    );
    expectNoUnsafeReadinessOutput(report);
  });

  it("formats blocked readiness reports with grouped blockers and disabled markers", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."]);
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z", {
        approvedPlan,
        currentPlan
      })
    );

    const output = formatWriteExecutionReadiness(report);

    expect(output).toContain(`Write execution readiness: ${report.intentId}`);
    expect(output).toContain("Status: blocked");
    expect(output).toContain("Ready: no");
    expect(output).toContain(`Run: ${report.runId}`);
    expect(output).toContain(`Plan: ${report.planId}`);
    expect(output).toContain(`Approval: ${report.approvalId}`);
    expect(output).toContain("Execution: disabled");
    expect(output).toContain("Write execution: disabled");
    expect(output).toContain("Blockers:");
    expect(output).toContain("  trace:");
    expect(output).toContain("blocked_dry_run_trace");
    expect(output).toContain("  precondition:");
    expect(output).toContain("Repository status is not clean.");
    expect(output).toContain("Checks:");
    expect(output).toContain("[blocked]");
    expect(output).toContain("Use --json for the stable automation contract.");
    expectNoUnsafeReadinessOutput(output);
  });

  it("formats unknown readiness reports with unknown checks", () => {
    const report = summarizeWriteExecutionReadiness(executionAuditBundle("2026-06-22T00:00:00.000Z"));

    const output = formatWriteExecutionReadiness(report);

    expect(output).toContain("Status: unknown");
    expect(output).toContain("Ready: unknown");
    expect(output).toContain("Inputs: auditBundle=available, preflight=missing");
    expect(output).toContain("approval_freshness_unverified");
    expect(output).toContain("ci_policy_unverified");
    expect(output).toContain("[unknown]");
    expect(output).toContain("Blockers:");
    expect(output).toContain("  - none");
    expectNoUnsafeReadinessOutput(output);
  });

  it("formats ready reports with pass checks and stable empty blocker output", () => {
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z", {
        commandSecret: "top-secret-readiness"
      }),
      passingPreflight()
    );

    const output = formatWriteExecutionReadiness(report);

    expect(output).toContain("Status: ready");
    expect(output).toContain("Ready: yes");
    expect(output).toContain("Inputs: auditBundle=available, preflight=available");
    expect(output).toContain("Blockers:");
    expect(output).toContain("  - none");
    expect(output).toContain("[pass]");
    expect(output).toContain("approval_freshness_passed");
    expect(output).toContain("ci_policy_passed");
    expectNoUnsafeReadinessOutput(output);
  });

  it("formats empty report sections without exposing unsafe fields", () => {
    const report = {
      ...summarizeWriteExecutionReadiness(executionAuditBundle("2026-06-22T00:00:00.000Z"), passingPreflight()),
      blockers: [],
      checks: []
    };

    const output = formatWriteExecutionReadiness(report);

    expect(output).toContain("Blockers:");
    expect(output).toContain("Checks:");
    expect(output.match(/  - none/g)).toHaveLength(2);
    expectNoUnsafeReadinessOutput(output);
  });
});

function executionAuditBundle(
  createdAt: string,
  options: { approvedPlan?: PullRequestPlan; currentPlan?: PullRequestPlan; commandSecret?: string } = {}
): ExecutionAuditBundle {
  const plan = options.currentPlan ?? prPlan("checkpoint-1", [], options.commandSecret);
  const approval = createPullRequestApproval(options.approvedPlan ?? plan, {
    approvedBy: "maintainer",
    reason: "Reviewed current checkpoint and PR plan."
  });
  const intent = createExecutionIntent({
    plan,
    approval,
    actor: "maintainer",
    reason: "Prepare audited write execution intent.",
    createdAt,
    expiresAt: "2026-06-24T00:00:00.000Z",
    permissionMode: "maintainer"
  });
  const traces = createExecutionDryRunTraces(intent, {
    createdAt: "2026-06-22T01:00:00.000Z"
  });

  return summarizeExecutionAuditBundle(intent, traces);
}

function prPlan(checkpointId = "checkpoint-1", blockedReasons: string[] = [], commandSecret = "safe-arg"): PullRequestPlan {
  return {
    id: "prplan-1",
    runId: "run-1",
    checkpointId,
    sourceBranchHint: "orchestrator/run1",
    baseBranch: "main",
    title: "Prepare PR workflow",
    body: "PR body",
    preconditions: ["Review this plan."],
    blockedReasons,
    commandCandidates: [
      {
        action: "create_branch",
        command: ["git", "switch", "-c", commandSecret],
        reason: "Create branch.",
        decisionReady: true
      },
      {
        action: "create_pr",
        command: ["gh", "pr", "create", "--title", "Prepare PR workflow"],
        reason: "Create PR.",
        decisionReady: true
      }
    ],
    createdAt: "2026-06-22T00:00:00.000Z"
  };
}

function passingPreflight(): Required<WriteExecutionReadinessPreflightInput> {
  return {
    approvalFresh: true,
    approvalNotExpired: true,
    planFingerprintMatches: true,
    checkpointMatches: true,
    repoClean: true,
    diffVerified: true,
    refPolicySatisfied: true,
    ciPolicySatisfied: true,
    permissionAllowed: true,
    commandRunnerConfigured: true
  };
}

function expectNoUnsafeReadinessOutput(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const forbidden of ["executedCommands", "stdout", "stderr", "exitCode", "stack", "argv", "top-secret-readiness"]) {
    expect(serialized).not.toContain(forbidden);
  }
}

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPullRequestApproval } from "../src/approval.js";
import type { PullRequestPlan, WriteExecutionReadinessPreflightInput } from "../src/domain.js";
import { createExecutionIntent, summarizeExecutionAuditBundle } from "../src/execution-intents.js";
import { summarizeWriteExecutionReadiness } from "../src/write-readiness.js";
import { createWriteRunnerDryRunTraces, summarizeWriteRunnerDryRun } from "../src/write-runner.js";
import { FileRunStore } from "../src/store.js";

describe("audited write runner dry-run boundary", () => {
  it("plans and stores non-executing trace records only when readiness is ready", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-write-runner-"));
    const store = new FileRunStore(root);
    const intent = executionIntent("top-secret-runner-argv");
    const bundle = summarizeExecutionAuditBundle(intent, []);
    const readiness = summarizeWriteExecutionReadiness(bundle, passingPreflight());
    const traces = createWriteRunnerDryRunTraces(intent, readiness, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });
    const report = summarizeWriteRunnerDryRun(intent, readiness, traces, {
      createdAt: "2026-06-22T01:00:00.000Z",
      localTracePersistence: "saved"
    });

    try {
      await store.saveExecutionIntent(intent);
      for (const trace of traces) {
        await store.saveExecutionTrace(trace);
      }

      expect(readiness.readinessStatus).toBe("ready");
      expect(traces).toHaveLength(intent.commandCandidates.length);
      expect(await store.listExecutionTraces()).toHaveLength(intent.commandCandidates.length);
      expect(report).toMatchObject({
        status: "planned",
        intentId: intent.id,
        runId: intent.runId,
        planId: intent.planId,
        approvalId: intent.approvalId,
        readinessStatus: "ready",
        ready: true,
        planItemCount: 2,
        traceCount: 2,
        localTracePersistence: "saved",
        policy: expect.objectContaining({
          mode: "dry_run",
          requiredReadiness: "ready",
          actualExecutionEnabled: false,
          executionEnabled: false,
          writeExecution: "disabled"
        }),
        simulationResultCount: 0,
        simulationResults: [],
        blockedReasonCount: 0,
        executionEnabled: false,
        writeExecution: "disabled",
        hasExecutionResults: false
      });
      expect(report.planItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "create_branch",
            branchNameCandidate: "orchestrator/runner",
            summary: "Plan branch creation without creating the branch."
          }),
          expect.objectContaining({
            action: "create_pr",
            prTitleCandidate: "Run run-runner",
            summary: "Plan PR creation metadata without creating a GitHub PR."
          })
        ])
      );
      expectNoUnsafeRunnerOutput(report);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("simulates safe execution results without exposing raw commands when explicitly requested", () => {
    const intent = executionIntent("top-secret-runner-argv");
    const bundle = summarizeExecutionAuditBundle(intent, []);
    const readiness = summarizeWriteExecutionReadiness(bundle, passingPreflight());
    const traces = createWriteRunnerDryRunTraces(intent, readiness, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });
    const report = summarizeWriteRunnerDryRun(intent, readiness, traces, {
      createdAt: "2026-06-22T01:00:00.000Z",
      localTracePersistence: "saved",
      mode: "simulate"
    });

    expect(report).toMatchObject({
      status: "simulated",
      readinessStatus: "ready",
      ready: true,
      planItemCount: 2,
      traceCount: 2,
      localTracePersistence: "saved",
      policy: expect.objectContaining({
        mode: "simulate",
        allowedActions: ["create_branch", "create_pr"],
        disallowedActions: [],
        actualExecutionEnabled: false
      }),
      simulationResultCount: 2,
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    });
    expect(report.simulationResults).toEqual([
      expect.objectContaining({
        action: "create_branch",
        status: "simulated",
        summary: "Simulated branch creation boundary without creating a branch."
      }),
      expect.objectContaining({
        action: "create_pr",
        status: "simulated",
        summary: "Simulated PR creation boundary without creating a GitHub PR."
      })
    ]);
    expectNoUnsafeRunnerOutput(report);
  });

  it("returns a blocked dry-run report without traces when readiness is unknown", () => {
    const intent = executionIntent("top-secret-runner-argv");
    const bundle = summarizeExecutionAuditBundle(intent, []);
    const readiness = summarizeWriteExecutionReadiness(bundle);
    const traces = createWriteRunnerDryRunTraces(intent, readiness);
    const report = summarizeWriteRunnerDryRun(intent, readiness, traces, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    expect(readiness.readinessStatus).toBe("unknown");
    expect(traces).toEqual([]);
    expect(report).toMatchObject({
      status: "blocked",
      readinessStatus: "unknown",
      ready: false,
      planItemCount: 0,
      planItems: [],
      traceCount: 0,
      traceIds: [],
      localTracePersistence: "skipped",
      policy: expect.objectContaining({
        mode: "dry_run",
        blockers: ["Write readiness is unknown."],
        actualExecutionEnabled: false
      }),
      simulationResultCount: 0,
      simulationResults: [],
      blockedReasonCount: 1,
      blockedReasons: ["Write readiness is unknown."],
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    });
    expectNoUnsafeRunnerOutput(report);
  });

  it("blocks simulation when readiness is unknown", () => {
    const intent = executionIntent("top-secret-runner-argv");
    const bundle = summarizeExecutionAuditBundle(intent, []);
    const readiness = summarizeWriteExecutionReadiness(bundle);
    const traces = createWriteRunnerDryRunTraces(intent, readiness);
    const report = summarizeWriteRunnerDryRun(intent, readiness, traces, {
      createdAt: "2026-06-22T01:00:00.000Z",
      mode: "simulate"
    });

    expect(report).toMatchObject({
      status: "blocked",
      readinessStatus: "unknown",
      ready: false,
      planItemCount: 0,
      traceCount: 0,
      simulationResultCount: 0,
      simulationResults: [],
      blockedReasons: ["Write readiness is unknown."],
      policy: expect.objectContaining({
        mode: "simulate",
        blockers: ["Write readiness is unknown."],
        actualExecutionEnabled: false
      })
    });
    expectNoUnsafeRunnerOutput(report);
  });

  it("returns disabled when actual execution is requested", () => {
    const intent = executionIntent("top-secret-runner-argv");
    const bundle = summarizeExecutionAuditBundle(intent, []);
    const readiness = summarizeWriteExecutionReadiness(bundle, passingPreflight());
    const report = summarizeWriteRunnerDryRun(intent, readiness, [], {
      createdAt: "2026-06-22T01:00:00.000Z",
      mode: "execute_disabled"
    });

    expect(report).toMatchObject({
      status: "disabled",
      readinessStatus: "ready",
      ready: true,
      planItemCount: 0,
      planItems: [],
      traceCount: 0,
      localTracePersistence: "skipped",
      simulationResultCount: 0,
      simulationResults: [],
      blockedReasons: ["Actual write execution is disabled; use simulate mode until the guarded executor is implemented."],
      policy: expect.objectContaining({
        mode: "execute_disabled",
        blockers: ["Actual write execution is disabled; use simulate mode until the guarded executor is implemented."],
        actualExecutionEnabled: false,
        executionEnabled: false,
        writeExecution: "disabled"
      })
    });
    expectNoUnsafeRunnerOutput(report);
  });

  it("keeps blocked readiness reasons without exposing raw command arguments", () => {
    const intent = executionIntent("top-secret-runner-argv", {
      status: "blocked",
      blockedReasons: ["Approval checkpoint does not match."]
    });
    const bundle = summarizeExecutionAuditBundle(intent, []);
    const readiness = summarizeWriteExecutionReadiness(bundle, passingPreflight());
    const report = summarizeWriteRunnerDryRun(intent, readiness, createWriteRunnerDryRunTraces(intent, readiness), {
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    expect(report.status).toBe("blocked");
    expect(report.ready).toBe(false);
    expect(report.planItems).toEqual([]);
    expect(report.blockedReasons).toEqual(
      expect.arrayContaining(["audit_blocked_reason: Approval checkpoint does not match."])
    );
    expectNoUnsafeRunnerOutput(report);
  });
});

function executionIntent(
  commandSecret: string,
  overrides: { status?: "created" | "blocked" | "expired"; blockedReasons?: string[] } = {}
) {
  const plan = prPlan(commandSecret, overrides.blockedReasons ?? []);
  const approval = createPullRequestApproval(plan, {
    approvedBy: "maintainer",
    reason: "Reviewed dry-run boundary."
  });

  return {
    ...createExecutionIntent({
      plan,
      approval,
      actor: "maintainer",
      reason: "Prepare audited write runner dry-run.",
      createdAt: "2026-06-22T00:00:00.000Z",
      expiresAt: "2026-06-23T00:00:00.000Z",
      permissionMode: "maintainer"
    }),
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.blockedReasons ? { blockedReasons: overrides.blockedReasons } : {})
  };
}

function prPlan(commandSecret = "top-secret-runner-argv", blockedReasons: string[] = []): PullRequestPlan {
  return {
    id: "prplan-runner",
    runId: "run-runner",
    checkpointId: "checkpoint-runner",
    sourceBranchHint: "orchestrator/runner",
    baseBranch: "main",
    title: "Runner dry-run",
    body: "Dry-run boundary.",
    preconditions: [],
    blockedReasons,
    commandCandidates: [
      {
        action: "create_branch",
        command: ["git", "switch", "-c", commandSecret],
        reason: "Create the runner branch candidate.",
        decisionReady: true
      },
      {
        action: "create_pr",
        command: ["gh", "pr", "create", "--title", commandSecret],
        reason: "Create the runner PR candidate.",
        decisionReady: true
      }
    ],
    createdAt: "2026-06-22T00:00:00.000Z"
  };
}

function passingPreflight(): WriteExecutionReadinessPreflightInput {
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

function expectNoUnsafeRunnerOutput(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain("top-secret-runner-argv");
  expect(text).not.toContain("argv");
  expect(text).not.toContain("stdout");
  expect(text).not.toContain("stderr");
  expect(text).not.toContain("exitCode");
  expect(text).not.toContain("executedCommands");
  expect(text).not.toContain("stack");
}

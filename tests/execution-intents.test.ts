import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPullRequestApproval } from "../src/approval.js";
import {
  createExecutionIntent,
  createExecutionDryRunTrace,
  createExecutionDryRunTraces,
  createPlanFingerprint,
  executionIntentPolicyVersion,
  parseExecutionIntent,
  parseExecutionTraceRecord,
  summarizeExecutionAuditBundle,
  summarizeExecutionAuditBundles,
  summarizeExecutionIntent,
  summarizeExecutionIntents
} from "../src/execution-intents.js";
import { FileRunStore } from "../src/store.js";
import type { PullRequestPlan } from "../src/domain.js";

describe("execution intent persistence", () => {
  it("creates a non-executing intent from an approved PR plan", () => {
    const plan = prPlan();
    const approval = createPullRequestApproval(plan, {
      approvedBy: "maintainer",
      reason: "Reviewed current checkpoint and PR plan."
    });

    const intent = createExecutionIntent({
      plan,
      approval,
      actor: "maintainer",
      reason: "Prepare audited write execution intent.",
      createdAt: "2026-06-22T00:00:00.000Z",
      expiresAt: "2026-06-23T00:00:00.000Z",
      permissionMode: "maintainer"
    });

    expect(intent.id).toMatch(/^intent_/);
    expect(intent.status).toBe("created");
    expect(intent.runId).toBe(plan.runId);
    expect(intent.planId).toBe(plan.id);
    expect(intent.planFingerprint).toBe(createPlanFingerprint(plan));
    expect(intent.checkpointId).toBe(plan.checkpointId);
    expect(intent.approvalId).toBe(approval.id);
    expect(intent.targetRef).toBe(plan.sourceBranchHint);
    expect(intent.sourceBranch).toBe(plan.sourceBranchHint);
    expect(intent.baseBranch).toBe(plan.baseBranch);
    expect(intent.policyVersion).toBe(executionIntentPolicyVersion);
    expect(intent.commandCandidates).toEqual(plan.commandCandidates);
    expect(intent.blockedReasons).toEqual([]);
    expect("executedCommands" in intent).toBe(false);
  });

  it("marks intents blocked when checkpoint or approval state does not match", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."]);
    const approval = createPullRequestApproval(approvedPlan, {
      approvedBy: "maintainer"
    });

    const intent = createExecutionIntent({
      plan: currentPlan,
      approval,
      actor: "maintainer",
      createdAt: "2026-06-22T00:00:00.000Z",
      expiresAt: "2026-06-23T00:00:00.000Z",
      permissionMode: "maintainer"
    });

    expect(intent.status).toBe("blocked");
    expect(intent.blockedReasons).toEqual(
      expect.arrayContaining([
        "Repository status is not clean.",
        "Approval checkpoint checkpoint-old does not match current checkpoint checkpoint-current."
      ])
    );
    expect("executedCommands" in intent).toBe(false);
  });

  it("persists execution intents under .orchestrator/execution-intents", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-intent-"));
    const store = new FileRunStore(root);
    const intent = executionIntent("2026-06-22T00:00:00.000Z");

    try {
      await store.saveExecutionIntent(intent);

      await expect(store.loadExecutionIntent(intent.id)).resolves.toEqual(intent);
      expect(store.pathForExecutionIntent(intent.id)).toBe(
        join(root, ".orchestrator", "execution-intents", `${intent.id}.json`)
      );
      const persisted = JSON.parse(await readFile(store.pathForExecutionIntent(intent.id), "utf8"));
      expect(persisted.id).toBe(intent.id);
      expect("executedCommands" in persisted).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lists execution intents by newest createdAt first", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-intent-"));
    const store = new FileRunStore(root);
    const older = executionIntent("2026-06-22T00:00:00.000Z");
    const newer = executionIntent("2026-06-23T00:00:00.000Z");

    try {
      await store.saveExecutionIntent(older);
      await store.saveExecutionIntent(newer);

      const intents = await store.listExecutionIntents();

      expect(intents.map((intent) => intent.id)).toEqual([newer.id, older.id]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid persisted execution intent shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-intent-"));
    const store = new FileRunStore(root);
    const invalidIntentPath = store.pathForExecutionIntent("intent-invalid");

    try {
      await mkdir(dirname(invalidIntentPath), { recursive: true });
      await writeFile(
        invalidIntentPath,
        `${JSON.stringify({
          ...executionIntent("2026-06-22T00:00:00.000Z"),
          status: "executed"
        })}\n`,
        "utf8"
      );

      await expect(store.loadExecutionIntent("intent-invalid")).rejects.toThrow("Invalid execution intent status");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects missing required execution intent fields", () => {
    const missingActor = { ...executionIntent("2026-06-22T00:00:00.000Z") } as Record<string, unknown>;
    delete missingActor.actor;

    expect(() => parseExecutionIntent(missingActor)).toThrow("actor must be a non-empty string");
  });

  it("summarizes an execution intent as a read-only non-executing report", () => {
    const intent = executionIntent("2026-06-22T00:00:00.000Z");

    const report = summarizeExecutionIntent(intent);

    expect(report).toMatchObject({
      id: intent.id,
      runId: intent.runId,
      planId: intent.planId,
      approvalId: intent.approvalId,
      checkpointId: intent.checkpointId,
      status: "created",
      actor: "maintainer",
      reason: "Prepare audited write execution intent.",
      createdAt: "2026-06-22T00:00:00.000Z",
      expiresAt: "2026-06-24T00:00:00.000Z",
      targetRef: "orchestrator/run1",
      baseBranch: "main",
      sourceBranch: "orchestrator/run1",
      permissionMode: "maintainer",
      policyVersion: executionIntentPolicyVersion,
      commandCandidateCount: 2,
      commandCandidateActions: ["create_branch", "create_pr"],
      commandActionSummary: [
        { action: "create_branch", count: 1 },
        { action: "create_pr", count: 1 }
      ],
      blockedReasonCount: 0,
      blockedReasons: [],
      executionEnabled: false,
      writeExecution: "disabled"
    });
    expect("executedCommands" in report).toBe(false);
  });

  it("includes blocked reasons in read-only intent reports", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."]);
    const approval = createPullRequestApproval(approvedPlan, {
      approvedBy: "maintainer"
    });
    const intent = createExecutionIntent({
      plan: currentPlan,
      approval,
      actor: "maintainer",
      createdAt: "2026-06-22T00:00:00.000Z",
      expiresAt: "2026-06-23T00:00:00.000Z",
      permissionMode: "maintainer"
    });

    const report = summarizeExecutionIntent(intent);

    expect(report.status).toBe("blocked");
    expect(report.blockedReasonCount).toBe(2);
    expect(report.blockedReasons).toEqual(
      expect.arrayContaining([
        "Repository status is not clean.",
        "Approval checkpoint checkpoint-old does not match current checkpoint checkpoint-current."
      ])
    );
    expect(report.executionEnabled).toBe(false);
    expect("executedCommands" in report).toBe(false);
  });

  it("summarizes stored execution intent lists without changing store order", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-intent-"));
    const store = new FileRunStore(root);
    const older = executionIntent("2026-06-22T00:00:00.000Z");
    const newer = executionIntent("2026-06-23T00:00:00.000Z");

    try {
      await store.saveExecutionIntent(older);
      await store.saveExecutionIntent(newer);

      const reports = summarizeExecutionIntents(await store.listExecutionIntents());

      expect(reports.map((report) => report.id)).toEqual([newer.id, older.id]);
      expect(reports.every((report) => report.executionEnabled === false)).toBe(true);
      expect(reports.every((report) => !("executedCommands" in report))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates non-executing dry-run traces from intent command candidates", () => {
    const intent = executionIntent("2026-06-22T00:00:00.000Z");

    const trace = createExecutionDryRunTrace({
      intent,
      candidate: intent.commandCandidates[0],
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    expect(trace.id).toMatch(/^trace_/);
    expect(trace).toMatchObject({
      intentId: intent.id,
      runId: intent.runId,
      planId: intent.planId,
      approvalId: intent.approvalId,
      checkpointId: intent.checkpointId,
      commandCandidate: {
        action: "create_branch",
        argv: ["git", "switch", "-c", "orchestrator/run1"],
        reason: "Create branch."
      },
      status: "planned",
      policyVersion: executionIntentPolicyVersion,
      policyDecision: "dry_run_planned",
      blockedReasons: [],
      createdAt: "2026-06-22T01:00:00.000Z",
      executionEnabled: false,
      writeExecution: "disabled"
    });
    expect("executedCommands" in trace).toBe(false);
    expect("stdout" in trace).toBe(false);
    expect("stderr" in trace).toBe(false);
    expect("exitCode" in trace).toBe(false);
  });

  it("creates blocked dry-run traces that preserve intent blocked reasons", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."]);
    const approval = createPullRequestApproval(approvedPlan, {
      approvedBy: "maintainer"
    });
    const intent = createExecutionIntent({
      plan: currentPlan,
      approval,
      actor: "maintainer",
      createdAt: "2026-06-22T00:00:00.000Z",
      expiresAt: "2026-06-23T00:00:00.000Z",
      permissionMode: "maintainer"
    });

    const [trace] = createExecutionDryRunTraces(intent, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    expect(trace.status).toBe("blocked");
    expect(trace.policyDecision).toBe("blocked");
    expect(trace.blockedReasons).toEqual(intent.blockedReasons);
    expect(trace.executionEnabled).toBe(false);
    expect("executedCommands" in trace).toBe(false);
    expect("stdout" in trace).toBe(false);
    expect("stderr" in trace).toBe(false);
  });

  it("persists execution dry-run traces under .orchestrator/execution-traces", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-trace-"));
    const store = new FileRunStore(root);
    const intent = executionIntent("2026-06-22T00:00:00.000Z");
    const trace = createExecutionDryRunTrace({
      intent,
      candidate: intent.commandCandidates[0],
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    try {
      await store.saveExecutionTrace(trace);

      await expect(store.loadExecutionTrace(trace.id)).resolves.toEqual(trace);
      expect(store.pathForExecutionTrace(trace.id)).toBe(
        join(root, ".orchestrator", "execution-traces", `${trace.id}.json`)
      );
      const persisted = JSON.parse(await readFile(store.pathForExecutionTrace(trace.id), "utf8"));
      expect(persisted.id).toBe(trace.id);
      expect("executedCommands" in persisted).toBe(false);
      expect("stdout" in persisted).toBe(false);
      expect("stderr" in persisted).toBe(false);
      expect("exitCode" in persisted).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lists execution traces by newest createdAt first", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-trace-"));
    const store = new FileRunStore(root);
    const intent = executionIntent("2026-06-22T00:00:00.000Z");
    const older = createExecutionDryRunTrace({
      intent,
      candidate: intent.commandCandidates[0],
      createdAt: "2026-06-22T01:00:00.000Z"
    });
    const newer = createExecutionDryRunTrace({
      intent,
      candidate: intent.commandCandidates[1],
      createdAt: "2026-06-22T02:00:00.000Z"
    });

    try {
      await store.saveExecutionTrace(older);
      await store.saveExecutionTrace(newer);

      const traces = await store.listExecutionTraces();

      expect(traces.map((trace) => trace.id)).toEqual([newer.id, older.id]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid persisted execution trace shape", () => {
    const intent = executionIntent("2026-06-22T00:00:00.000Z");
    const trace = createExecutionDryRunTrace({
      intent,
      candidate: intent.commandCandidates[0],
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    expect(() =>
      parseExecutionTraceRecord({
        ...trace,
        status: "executed"
      })
    ).toThrow("Invalid execution trace status");
    expect(() =>
      parseExecutionTraceRecord({
        ...trace,
        executionEnabled: true
      })
    ).toThrow("executionEnabled must be false");
  });

  it("summarizes execution audit bundles from an intent and matching traces", () => {
    const intent = executionIntent("2026-06-22T00:00:00.000Z");
    const traces = createExecutionDryRunTraces(intent, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    const bundle = summarizeExecutionAuditBundle(intent, traces);

    expect(bundle.intent.id).toBe(intent.id);
    expect(bundle.traces).toHaveLength(2);
    expect(bundle.traceCount).toBe(2);
    expect(bundle.plannedTraceCount).toBe(2);
    expect(bundle.blockedTraceCount).toBe(0);
    expect(bundle.traceActionSummary).toEqual([
      { action: "create_branch", count: 1 },
      { action: "create_pr", count: 1 }
    ]);
    expect(bundle.blockedReasonCount).toBe(0);
    expect(bundle.blockedReasons).toEqual([]);
    expect(bundle.mismatchedTraceCount).toBe(0);
    expect(bundle.mismatchedTraceIds).toEqual([]);
    expect(bundle.executionEnabled).toBe(false);
    expect(bundle.writeExecution).toBe("disabled");
    expect(bundle.hasExecutionResults).toBe(false);
    expect(bundle.traces[0]).toMatchObject({
      intentId: intent.id,
      runId: intent.runId,
      planId: intent.planId,
      approvalId: intent.approvalId,
      checkpointId: intent.checkpointId,
      action: "create_branch",
      argv: ["git", "switch", "-c", "orchestrator/run1"],
      reason: "Create branch.",
      status: "planned",
      policyVersion: executionIntentPolicyVersion,
      policyDecision: "dry_run_planned",
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    });
    expect("executedCommands" in bundle).toBe(false);
    expect("stdout" in bundle).toBe(false);
    expect("stderr" in bundle).toBe(false);
    expect("exitCode" in bundle).toBe(false);
    expect(bundle.traces.every((trace) => !("executedCommands" in trace))).toBe(true);
    expect(bundle.traces.every((trace) => !("stdout" in trace))).toBe(true);
    expect(bundle.traces.every((trace) => !("stderr" in trace))).toBe(true);
    expect(bundle.traces.every((trace) => !("exitCode" in trace))).toBe(true);
  });

  it("keeps mismatched traces out of execution audit bundles and exposes mismatch counts", () => {
    const intent = executionIntent("2026-06-22T00:00:00.000Z");
    const [matchingTrace] = createExecutionDryRunTraces(intent, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });
    const otherIntent = executionIntent("2026-06-22T02:00:00.000Z");
    const [mismatchedTrace] = createExecutionDryRunTraces(otherIntent, {
      createdAt: "2026-06-22T03:00:00.000Z"
    });

    const bundle = summarizeExecutionAuditBundle(intent, [matchingTrace, mismatchedTrace]);

    expect(bundle.traceCount).toBe(1);
    expect(bundle.traces.map((trace) => trace.id)).toEqual([matchingTrace.id]);
    expect(bundle.mismatchedTraceCount).toBe(1);
    expect(bundle.mismatchedTraceIds).toEqual([mismatchedTrace.id]);
    expect(bundle.executionEnabled).toBe(false);
    expect(bundle.hasExecutionResults).toBe(false);
  });

  it("summarizes blocked execution audit bundles with unique blocked reasons", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."]);
    const approval = createPullRequestApproval(approvedPlan, {
      approvedBy: "maintainer"
    });
    const intent = createExecutionIntent({
      plan: currentPlan,
      approval,
      actor: "maintainer",
      createdAt: "2026-06-22T00:00:00.000Z",
      expiresAt: "2026-06-23T00:00:00.000Z",
      permissionMode: "maintainer"
    });
    const traces = createExecutionDryRunTraces(intent, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    const bundle = summarizeExecutionAuditBundle(intent, traces);

    expect(bundle.plannedTraceCount).toBe(0);
    expect(bundle.blockedTraceCount).toBe(2);
    expect(bundle.blockedReasons).toEqual(intent.blockedReasons);
    expect(bundle.blockedReasonCount).toBe(intent.blockedReasons.length);
    expect(bundle.traces.every((trace) => trace.status === "blocked")).toBe(true);
    expect(bundle.executionEnabled).toBe(false);
    expect("executedCommands" in bundle).toBe(false);
  });

  it("summarizes audit bundle lists from stored intent and trace records", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-audit-bundle-"));
    const store = new FileRunStore(root);
    const intent = executionIntent("2026-06-22T00:00:00.000Z");
    const traces = createExecutionDryRunTraces(intent, {
      createdAt: "2026-06-22T01:00:00.000Z"
    });

    try {
      await store.saveExecutionIntent(intent);
      await Promise.all(traces.map((trace) => store.saveExecutionTrace(trace)));

      const bundles = summarizeExecutionAuditBundles(
        await store.listExecutionIntents(),
        await store.listExecutionTraces()
      );

      expect(bundles).toHaveLength(1);
      expect(bundles[0].intent.id).toBe(intent.id);
      expect(bundles[0].traceCount).toBe(2);
      expect(bundles[0].executionEnabled).toBe(false);
      expect(bundles[0].hasExecutionResults).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function executionIntent(createdAt: string) {
  const plan = prPlan();
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

function prPlan(checkpointId = "checkpoint-1", blockedReasons: string[] = []): PullRequestPlan {
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
        command: ["git", "switch", "-c", "orchestrator/run1"],
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

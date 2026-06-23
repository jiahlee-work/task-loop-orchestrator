import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPullRequestApproval } from "../src/approval.js";
import {
  createExecutionIntent,
  createPlanFingerprint,
  executionIntentPolicyVersion,
  parseExecutionIntent,
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

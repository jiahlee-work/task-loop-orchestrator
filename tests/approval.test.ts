import { describe, expect, it } from "vitest";
import type { PullRequestPlan } from "../src/domain.js";
import { createPullRequestApproval, preparePullRequestExecution } from "../src/approval.js";
import { FileRunStore } from "../src/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("PR execution approval preflight", () => {
  it("defaults to dry-run and never executes command candidates", () => {
    const report = preparePullRequestExecution({ plan: prPlan() });

    expect(report.mode).toBe("dry-run");
    expect(report.status).toBe("dry_run");
    expect(report.executedCommands).toEqual([]);
    expect(report.commandCandidates).toHaveLength(2);
    expect(report.message).toContain("Dry-run only");
  });

  it("blocks execute mode without approval", () => {
    const report = preparePullRequestExecution({ plan: prPlan(), mode: "execute" });

    expect(report.status).toBe("blocked");
    expect(report.blockedReasons).toContain("Execution mode requires an approval record.");
    expect(report.executedCommands).toEqual([]);
  });

  it("creates approval records but still blocks write execution at the boundary", () => {
    const plan = prPlan();
    const approval = createPullRequestApproval(plan, {
      approvedBy: "maintainer",
      reason: "Reviewed checkpoint and PR plan."
    });

    const report = preparePullRequestExecution({ plan, approval, mode: "execute" });

    expect(approval.status).toBe("approved");
    expect(approval.scope).toBe("pr_execution");
    expect(approval.planSnapshot).toEqual({
      planTitle: "Prepare PR workflow",
      baseBranch: "main",
      sourceBranchHint: "orchestrator/run1",
      blockedReasons: [],
      commandCandidateActions: ["create_branch", "create_pr"]
    });
    expect(report.status).toBe("blocked");
    expect(report.approval?.approvedBy).toBe("maintainer");
    expect(report.blockedReasons).toContain(
      "Write execution is not implemented; branch, commit, push, and PR creation remain blocked at the boundary."
    );
    expect(report.executedCommands).toEqual([]);
  });

  it("carries PR plan blocked reasons into execution preflight", () => {
    const report = preparePullRequestExecution({
      plan: prPlan(["Latest checkpoint is needs_attention."]),
      mode: "execute"
    });

    expect(report.blockedReasons).toEqual(
      expect.arrayContaining(["Latest checkpoint is needs_attention.", "Execution mode requires an approval record."])
    );
  });

  it("persists approvals and loads latest approvals by plan and run", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-approval-"));
    const store = new FileRunStore(root);
    const plan = prPlan();
    const approval = createPullRequestApproval(plan, {
      approvedBy: "maintainer",
      reason: "Approved after reviewing checkpoint."
    });

    try {
      await store.saveApproval(approval);

      await expect(store.loadApproval(approval.id)).resolves.toEqual(approval);
      await expect(store.latestApprovalForPlan(plan.id)).resolves.toEqual(approval);
      await expect(store.latestApprovalForRun(plan.runId)).resolves.toEqual(approval);
      await expect(store.loadApproval(approval.id)).resolves.toMatchObject({
        planSnapshot: {
          planTitle: plan.title,
          baseBranch: plan.baseBranch,
          sourceBranchHint: plan.sourceBranchHint,
          blockedReasons: plan.blockedReasons,
          commandCandidateActions: ["create_branch", "create_pr"]
        }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses a persisted approved approval but still blocks write execution at the boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-approval-"));
    const store = new FileRunStore(root);
    const plan = prPlan();
    const approval = createPullRequestApproval(plan, {
      approvedBy: "maintainer"
    });

    try {
      await store.saveApproval(approval);
      const persisted = await store.loadApproval(approval.id);
      const report = preparePullRequestExecution({ plan, approval: persisted, mode: "execute" });

      expect(report.status).toBe("blocked");
      expect(report.approval?.id).toBe(approval.id);
      expect(report.blockedReasons).toContain(
        "Write execution is not implemented; branch, commit, push, and PR creation remain blocked at the boundary."
      );
      expect(report.executedCommands).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not mark approval stale when the current checkpoint matches", () => {
    const plan = prPlan([], "checkpoint-current");
    const approval = createPullRequestApproval(plan, {
      approvedBy: "maintainer"
    });

    const report = preparePullRequestExecution({ plan, approval, mode: "execute" });

    expect(report.blockedReasons.some((reason) => reason.startsWith("Stale approval:"))).toBe(false);
    expect(report.blockedReasons).toContain(
      "Write execution is not implemented; branch, commit, push, and PR creation remain blocked at the boundary."
    );
    expect(report.executedCommands).toEqual([]);
  });

  it("blocks stale approvals when the current checkpoint changed", () => {
    const approvedPlan = prPlan([], "checkpoint-old");
    const currentPlan = prPlan([], "checkpoint-current");
    const approval = createPullRequestApproval(approvedPlan, {
      approvedBy: "maintainer"
    });

    const report = preparePullRequestExecution({ plan: currentPlan, approval, mode: "execute" });

    expect(report.status).toBe("blocked");
    expect(report.blockedReasons).toContain(
      "Stale approval: approved checkpoint checkpoint-old does not match current checkpoint checkpoint-current."
    );
    expect(report.blockedReasons).not.toContain(
      "Write execution is not implemented; branch, commit, push, and PR creation remain blocked at the boundary."
    );
    expect(report.executedCommands).toEqual([]);
  });

  it("blocks persisted approved approvals when they are stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-loop-approval-"));
    const store = new FileRunStore(root);
    const approvedPlan = prPlan([], "checkpoint-old");
    const currentPlan = prPlan([], "checkpoint-current");
    const approval = createPullRequestApproval(approvedPlan, {
      approvedBy: "maintainer"
    });

    try {
      await store.saveApproval(approval);
      const persisted = await store.loadApproval(approval.id);
      const report = preparePullRequestExecution({ plan: currentPlan, approval: persisted, mode: "execute" });

      expect(report.status).toBe("blocked");
      expect(report.blockedReasons).toContain(
        "Stale approval: approved checkpoint checkpoint-old does not match current checkpoint checkpoint-current."
      );
      expect(report.executedCommands).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function prPlan(blockedReasons: string[] = [], checkpointId = "checkpoint-1"): PullRequestPlan {
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

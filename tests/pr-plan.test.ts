import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IntegrationCheckpointReport, LoopRun, Subtask, TaskSpec } from "../src/domain.js";
import { createPullRequestPlan } from "../src/pr-plan.js";
import { MockRepoProvider } from "../src/providers.js";
import { FileRunStore } from "../src/store.js";

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-pr-plan-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createPullRequestPlan", () => {
  it("creates decision-ready PR candidates for a clean checkpoint and clean repo", async () => {
    const run = loopRun([subtask("completed")]);
    const checkpoint = checkpointReport({ status: "clean", runId: run.id });

    const plan = await createPullRequestPlan({
      run,
      checkpoint,
      repo: new MockRepoProvider({ status: "", diff: "" })
    });

    expect(plan.blockedReasons).toEqual([]);
    expect(plan.checkpointId).toBe(checkpoint.id);
    expect(plan.commandCandidates.map((candidate) => candidate.action)).toEqual([
      "create_branch",
      "commit",
      "push",
      "create_pr"
    ]);
    expect(plan.commandCandidates.every((candidate) => candidate.decisionReady)).toBe(true);
    expect(plan.preconditions).toContain("Stage reviewed files before commit.");
    expect(plan.commandCandidates.find((candidate) => candidate.action === "commit")?.command).toEqual([
      "git",
      "commit",
      "-m",
      run.spec.title
    ]);
    expect(plan.commandCandidates.find((candidate) => candidate.action === "create_pr")?.command).toContain("pr");
  });

  it("includes blocked reasons for non-clean checkpoint and dirty repo", async () => {
    const run = loopRun([subtask("completed")]);
    const checkpoint = checkpointReport({
      status: "needs_attention",
      runId: run.id,
      conflictRisks: ["Repository has uncommitted status."]
    });

    const plan = await createPullRequestPlan({
      run,
      checkpoint,
      repo: new MockRepoProvider({
        status: " M src/cli.ts",
        diff: " src/cli.ts | 3 +++"
      })
    });

    expect(plan.blockedReasons).toEqual(
      expect.arrayContaining([
        `Latest checkpoint ${checkpoint.id} is needs_attention.`,
        "Repository has uncommitted status.",
        "Repository status is not clean:  M src/cli.ts",
        "Repository diff is not clean:  src/cli.ts | 3 +++"
      ])
    );
  });

  it("loads the latest checkpoint for a run from the file store", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const older = checkpointReport({ id: "older", runId: "run-1", createdAt: "2026-06-22T00:00:00.000Z" });
    const newer = checkpointReport({ id: "newer", runId: "run-1", createdAt: "2026-06-22T01:00:00.000Z" });
    const other = checkpointReport({ id: "other", runId: "run-2", createdAt: "2026-06-22T02:00:00.000Z" });

    await store.saveCheckpoint(older);
    await store.saveCheckpoint(newer);
    await store.saveCheckpoint(other);

    await expect(store.latestCheckpoint("run-1")).resolves.toMatchObject({ id: "newer" });
    await expect(store.latestCheckpoint()).resolves.toMatchObject({ id: "other" });
  });
});

function loopRun(subtasks: Subtask[]): LoopRun {
  const spec: TaskSpec = {
    id: "task-1",
    title: "Prepare PR workflow",
    acceptanceCriteria: ["PR plan can be generated."],
    permissionMode: "write"
  };

  return {
    id: "run-1",
    spec,
    context: {
      runId: "run-1",
      task: spec,
      items: []
    },
    graph: {
      subtasks,
      conflicts: []
    },
    events: [],
    status: "completed",
    iterations: 1,
    permissionMode: "write",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

function subtask(status: Subtask["status"]): Subtask {
  return {
    id: `subtask-${status}`,
    title: `${status} subtask`,
    dependsOn: [],
    status,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

function checkpointReport(input: {
  id?: string;
  runId: string;
  status?: IntegrationCheckpointReport["status"];
  conflictRisks?: string[];
  createdAt?: string;
}): IntegrationCheckpointReport {
  return {
    id: input.id ?? "checkpoint-1",
    runId: input.runId,
    status: input.status ?? "clean",
    counts: {
      completed: 1,
      blocked: 0,
      pending: 0,
      active: 0,
      failed: 0
    },
    repoStatus: "",
    diffStat: "",
    ciCheck: {
      status: "success",
      summary: "Checks passed.",
      source: "github"
    },
    conflictRisks: input.conflictRisks ?? [],
    recommendedNextAction: "Prepare maintainer review.",
    maintainerActionCandidates: [],
    ownerDecisionItems: [],
    createdAt: input.createdAt ?? "2026-06-22T00:00:00.000Z"
  };
}

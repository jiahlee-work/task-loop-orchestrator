import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEvent } from "../src/audit.js";
import type { LoopRun, Subtask, TaskSpec } from "../src/domain.js";
import { createIntegrationCheckpoint } from "../src/integration.js";
import { MockRepoProvider } from "../src/providers.js";
import { FileRunStore } from "../src/store.js";

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-checkpoint-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createIntegrationCheckpoint", () => {
  it("returns clean for a completed graph and clean repo", async () => {
    const run = loopRun([subtask("completed")]);

    const report = await createIntegrationCheckpoint({
      run,
      repo: new MockRepoProvider({ status: "", diff: "" })
    });

    expect(report.status).toBe("clean");
    expect(report.counts.completed).toBe(1);
    expect(report.repoStatus).toBe("");
    expect(report.diffStat).toBe("");
    expect(report.maintainerActionCandidates.every((candidate) => candidate.decisionReady)).toBe(true);
    expect(report.maintainerActionCandidates.map((candidate) => candidate.action)).toEqual(
      expect.arrayContaining(["create_pr", "merge_pr", "release"])
    );
  });

  it("includes repo status and diff stat and marks dirty repo as needs_attention", async () => {
    const run = loopRun([subtask("completed")]);

    const report = await createIntegrationCheckpoint({
      run,
      repo: new MockRepoProvider({
        status: " M src/integration.ts",
        diff: " src/integration.ts | 25 +++++++++++++++++"
      })
    });

    expect(report.status).toBe("needs_attention");
    expect(report.repoStatus).toContain("src/integration.ts");
    expect(report.diffStat).toContain("25");
    expect(report.conflictRisks.some((risk) => risk.includes("Repository has uncommitted status"))).toBe(true);
    expect(report.maintainerActionCandidates).toEqual([]);
  });

  it("returns blocked for blocked subtasks and owner decision reviewer events", async () => {
    const runWithBlocked = appendEvent(loopRun([subtask("blocked", "Needs owner input.")]), {
      kind: "review_completed",
      message: "Owner decision required.",
      role: "reviewer",
      subtaskId: "subtask-blocked",
      data: {
        report: {
          verdict: "owner_decision",
          ownerDecisionReason: "Acceptance criteria missing."
        }
      }
    });

    const report = await createIntegrationCheckpoint({
      run: runWithBlocked,
      repo: new MockRepoProvider({ status: "", diff: "" })
    });

    expect(report.status).toBe("blocked");
    expect(report.counts.blocked).toBe(1);
    expect(report.ownerDecisionItems[0]?.reason).toContain("Acceptance criteria missing");
    expect(report.recommendedNextAction).toContain("owner decision");
  });

  it("persists checkpoint reports and can add a ready event to the run", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    let run = loopRun([subtask("completed")]);
    await mkdir(join(root, ".orchestrator", "runs"), { recursive: true });
    await store.save(run);

    const report = await createIntegrationCheckpoint({
      run,
      repo: new MockRepoProvider({ status: "", diff: "" })
    });
    await store.saveCheckpoint(report);
    run = appendEvent(run, {
      kind: "integration_checkpoint_ready",
      message: `Integration checkpoint ${report.id} is ready.`,
      role: "root",
      data: {
        checkpointId: report.id
      }
    });
    await store.save(run);

    const persistedCheckpoint = JSON.parse(await readFile(store.pathForCheckpoint(report.id), "utf8"));
    const persistedRun = await store.load(run.id);

    expect(persistedCheckpoint.id).toBe(report.id);
    expect(persistedRun.events.some((event) => event.kind === "integration_checkpoint_ready")).toBe(true);
  });

  it("reflects GitHub check summary when a GitHub provider is present", async () => {
    const run = loopRun([subtask("completed")]);

    const report = await createIntegrationCheckpoint({
      run,
      repo: new MockRepoProvider({ status: "", diff: "" }),
      github: {
        async getRepositoryInfo() {
          return undefined;
        },
        async listPullRequests() {
          return [];
        },
        async getCheckStatus() {
          return {
            status: "pending",
            summary: "GitHub checks pending (1 check).",
            ref: "main",
            source: "github",
            details: [{ name: "test", status: "pending" }]
          };
        }
      }
    });

    expect(report.ciCheck).toEqual({
      status: "pending",
      summary: "GitHub checks pending (1 check).",
      ref: "main",
      source: "github",
      details: [{ name: "test", status: "pending" }]
    });
  });
});

function loopRun(subtasks: Subtask[]): LoopRun {
  const spec: TaskSpec = {
    id: "task-1",
    title: "Checkpoint task",
    acceptanceCriteria: ["Checkpoint can be generated."],
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
    status: subtasks.every((item) => item.status === "completed") ? "completed" : "blocked",
    iterations: 1,
    permissionMode: "write",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

function subtask(status: Subtask["status"], result?: string): Subtask {
  return {
    id: status === "blocked" ? "subtask-blocked" : `subtask-${status}`,
    title: `${status} subtask`,
    dependsOn: [],
    status,
    result,
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

import { afterEach, describe, expect, it } from "vitest";
import type { Context, Graph, RoleReport, Subtask, TaskSpec } from "../src/domain.js";
import { RootOrchestrator, createTaskSpec } from "../src/orchestrator.js";
import { MockExecutor, MockPlanner, type RoleProviders } from "../src/roles.js";
import { MockRepoProvider } from "../src/providers.js";
import { collectReviewEvidence, LocalEvidenceReviewer } from "../src/reviewers.js";
import { FileRunStore } from "../src/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-reviewer-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const spec: TaskSpec = {
  id: "task-1",
  title: "Review milestone",
  acceptanceCriteria: ["Evidence is collected."],
  permissionMode: "write"
};

const context: Context = {
  runId: "run-1",
  task: spec,
  items: []
};

const graph: Graph = {
  subtasks: [],
  conflicts: []
};

const subtask: Subtask = {
  id: "subtask-1",
  title: "Verify work",
  dependsOn: [],
  status: "active",
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:00.000Z"
};

describe("review evidence and LocalEvidenceReviewer", () => {
  it("collects repo status and diff stat evidence", async () => {
    const evidence = await collectReviewEvidence({
      spec,
      context,
      graph,
      rootContract: {
        schemaVersion: 1,
        runId: "run-1",
        taskId: "task-1",
        goal: "Review milestone",
        nonGoals: ["Do not change unrelated files."],
        mustFollow: ["Keep the reviewer read-only."],
        acceptanceCriteria: ["Root criteria is verified."],
        contextGuard: ["Reject changes outside the approved task."],
        repoConstraints: ["Do not commit."],
        userDecisions: [],
        permissionMode: "write",
        updatedAt: "2026-06-22T00:00:00.000Z"
      },
      subtask,
      executorReport: {
        role: "executor",
        status: "ok",
        subtaskId: subtask.id,
        summary: "Executor completed work."
      },
      repo: new MockRepoProvider({
        status: " M src/reviewers.ts",
        diff: " src/reviewers.ts | 42 +++++++++++++++++++++++++"
      })
    });

    expect(evidence.some((item) => item.kind === "repo_status" && item.summary.includes("src/reviewers.ts"))).toBe(true);
    expect(evidence.some((item) => item.kind === "diff_stat" && item.summary.includes("42"))).toBe(true);
    expect(
      evidence.some(
        (item) => item.kind === "acceptance_criteria_coverage" && item.summary.includes("1 acceptance criteria")
      )
    ).toBe(true);
    expect(
      evidence.some((item) => item.kind === "context_guard_coverage" && item.summary.includes("1 context guard"))
    ).toBe(true);
  });

  it("returns request_changes for executor failure without mutating context or graph", async () => {
    const reviewer = new LocalEvidenceReviewer();
    const contextBefore = structuredClone(context);
    const graphBefore = structuredClone(graph);

    const report = await reviewer.review({
      spec,
      context,
      graph,
      subtask,
      executorReport: {
        role: "executor",
        status: "failed",
        subtaskId: subtask.id,
        summary: "Executor failed."
      },
      evidence: []
    });

    expect(report.status).toBe("blocked");
    expect(report.data?.verdict).toBe("request_changes");
    expect(report.data?.readOnly).toBe(true);
    expect(context).toEqual(contextBefore);
    expect(graph).toEqual(graphBefore);
  });

  it("blocks the run with owner_decision when acceptance criteria are absent", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const roles: RoleProviders = {
      planner: new MockPlanner(),
      executor: new MockExecutor(),
      reviewer: new LocalEvidenceReviewer()
    };
    const orchestrator = new RootOrchestrator({ store, roles });

    const run = await orchestrator.runTask(
      createTaskSpec({
        title: "Missing criteria",
        acceptanceCriteria: []
      })
    );
    const reviewEvent = run.events.find((event) => event.kind === "review_completed");
    const report = reviewEvent?.data?.report as { verdict?: string; ownerDecisionReason?: string } | undefined;

    expect(run.status).toBe("blocked");
    expect(report?.verdict).toBe("owner_decision");
    expect(report?.ownerDecisionReason).toContain("Acceptance criteria");
    expect(run.events.some((event) => event.kind === "verification_evidence_collected")).toBe(true);
  });

  it("fails the run when executor fails under structured review", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const roles: RoleProviders = {
      planner: new MockPlanner(),
      executor: {
        async execute(input): Promise<RoleReport> {
          return {
            role: "executor",
            status: "failed",
            subtaskId: input.subtask.id,
            summary: "Executor adapter failed before producing changes."
          };
        }
      },
      reviewer: new LocalEvidenceReviewer()
    };
    const orchestrator = new RootOrchestrator({ store, roles });

    const run = await orchestrator.runTask(createTaskSpec({ title: "Executor failure review" }));
    const reviewEvent = run.events.find((event) => event.kind === "review_completed");
    const report = reviewEvent?.data?.report as { verdict?: string; evidence?: unknown[] } | undefined;

    expect(run.status).toBe("failed");
    expect(run.graph.subtasks[0]?.status).toBe("failed");
    expect(report?.verdict).toBe("request_changes");
    expect(report?.evidence?.length).toBeGreaterThan(0);
  });
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Context, Graph, RoleReport, Subtask, TaskSpec } from "../src/domain.js";
import { RootOrchestrator, createTaskSpec } from "../src/orchestrator.js";
import { MockExecutor, MockPlanner, type RoleProviders } from "../src/roles.js";
import { FileRunStore } from "../src/store.js";

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-orchestrator-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("RootOrchestrator", () => {
  it("runs a mock closed loop and persists the run file", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const orchestrator = new RootOrchestrator({ store });

    const run = await orchestrator.runTask(
      createTaskSpec({
        title: "Create MVP scaffold",
        description: "Exercise a closed-loop mock run."
      })
    );

    expect(run.status).toBe("completed");
    expect(run.iterations).toBeGreaterThanOrEqual(1);
    expect(run.graph.subtasks).toHaveLength(1);
    expect(run.graph.subtasks[0]?.status).toBe("completed");
    expect(run.context.items.some((item) => item.source === "reviewer")).toBe(true);
    expect(run.context.items.some((item) => item.text.includes("Repo status:"))).toBe(true);
    expect(run.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "discovered",
        "planned",
        "subtask_selected",
        "execution_started",
        "execution_completed",
        "review_completed",
        "context_updated",
        "graph_updated",
        "run_completed"
      ])
    );

    const persisted = JSON.parse(await readFile(store.pathForRunSnapshot(run.id), "utf8"));
    const rootContract = JSON.parse(await readFile(store.pathForRootContract(run.id), "utf8"));
    const taskTree = JSON.parse(await readFile(store.pathForTaskTree(run.id), "utf8"));
    const state = JSON.parse(await readFile(store.pathForRunState(run.id), "utf8"));
    const summary = await readFile(store.pathForRunSummary(run.id), "utf8");

    expect(persisted.id).toBe(run.id);
    expect(persisted.status).toBe("completed");
    expect(persisted.events.length).toBeGreaterThan(0);
    expect(rootContract).toMatchObject({
      schemaVersion: 1,
      runId: run.id,
      goal: "Create MVP scaffold",
      acceptanceCriteria: ["Mock closed-loop run completes at least one bounded subtask."]
    });
    expect(taskTree).toMatchObject({
      schemaVersion: 1,
      runId: run.id,
      tasks: [{ status: "completed" }]
    });
    expect(state).toMatchObject({
      schemaVersion: 1,
      runId: run.id,
      status: "completed",
      counts: {
        completed: 1,
        total: 1
      }
    });
    expect(summary).toContain(`# Run ${run.id}`);
    expect(summary).toContain("Task: Create MVP scaffold");
  });

  it("blocks read-mode runs when execution would require write permission", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const orchestrator = new RootOrchestrator({ store });

    const run = await orchestrator.runTask(
      createTaskSpec({
        title: "Read-only audit",
        permissionMode: "read"
      })
    );

    expect(run.status).toBe("blocked");
    expect(run.iterations).toBe(0);
    expect(run.events.some((event) => event.kind === "permission_denied" && event.action === "write_file")).toBe(true);
    expect(run.events.at(-1)?.kind).toBe("run_blocked");
  });

  it("blocks the run when reviewer returns blocked", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const roles: RoleProviders = {
      planner: new MockPlanner(),
      executor: new MockExecutor(),
      reviewer: {
        async review(input: { subtask: Subtask }): Promise<RoleReport> {
          return {
            role: "reviewer",
            status: "blocked",
            subtaskId: input.subtask.id,
            summary: "Reviewer found missing acceptance evidence.",
            contextDelta: {
              items: [
                {
                  kind: "blocked",
                  text: "Missing acceptance evidence.",
                  source: "reviewer"
                }
              ]
            }
          };
        }
      }
    };
    const orchestrator = new RootOrchestrator({ store, roles });

    const run = await orchestrator.runTask(createTaskSpec({ title: "Exercise blocked review" }));

    expect(run.status).toBe("blocked");
    expect(run.graph.subtasks[0]?.status).toBe("blocked");
    expect(run.events.some((event) => event.kind === "review_completed" && event.data?.status === "blocked")).toBe(true);
    expect(run.events.at(-1)?.kind).toBe("run_blocked");
  });

  it("treats resume maxIterations as additional iterations", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const roles: RoleProviders = {
      planner: {
        async plan(input: { spec: TaskSpec; context: Context; graph: Graph }): Promise<RoleReport> {
          if (input.graph.subtasks.length > 0) {
            return {
              role: "planner",
              status: "ok",
              summary: "Graph already planned."
            };
          }

          const createdAt = "2026-06-22T00:00:00.000Z";
          return {
            role: "planner",
            status: "ok",
            summary: "Planned two sequential tasks.",
            proposedSubtasks: [
              {
                id: "first",
                title: "First",
                dependsOn: [],
                createdAt,
                updatedAt: createdAt
              },
              {
                id: "second",
                title: "Second",
                dependsOn: ["first"],
                createdAt,
                updatedAt: createdAt
              }
            ]
          };
        }
      },
      executor: new MockExecutor(),
      reviewer: {
        async review(input: { subtask: Subtask; executorReport: RoleReport }): Promise<RoleReport> {
          return {
            role: "reviewer",
            status: "ok",
            subtaskId: input.subtask.id,
            summary: `Verified ${input.executorReport.summary}`
          };
        }
      }
    };
    const orchestrator = new RootOrchestrator({ store, roles });

    const initial = await orchestrator.runTask(createTaskSpec({ title: "Two-step run" }), { maxIterations: 1 });
    expect(initial.status).toBe("blocked");
    expect(initial.iterations).toBe(1);
    expect(initial.graph.subtasks.map((subtask) => subtask.status)).toEqual(["completed", "pending"]);

    const resumed = await orchestrator.resume(initial.id, { maxIterations: 1 });
    expect(resumed.status).toBe("completed");
    expect(resumed.iterations).toBe(2);
    expect(resumed.graph.subtasks.map((subtask) => subtask.status)).toEqual(["completed", "completed"]);
  });

  it("migrates stored runs that do not have events", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const runId = "legacy-run";
    await mkdir(join(root, ".orchestrator", "runs"), { recursive: true });
    await writeFile(
      join(root, ".orchestrator", "runs", `${runId}.json`),
      JSON.stringify({
        id: runId,
        spec: createTaskSpec({ id: "legacy-task", title: "Legacy" }),
        context: {
          runId,
          task: createTaskSpec({ id: "legacy-task", title: "Legacy" }),
          items: []
        },
        graph: {
          subtasks: [],
          conflicts: []
        },
        status: "completed",
        iterations: 0,
        permissionMode: "write",
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z"
      }),
      "utf8"
    );

    const loaded = await store.load(runId);

    expect(loaded.events).toEqual([]);
  });

  it("deduplicates legacy run files when a run directory exists for the same id", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const orchestrator = new RootOrchestrator({ store });
    const run = await orchestrator.runTask(createTaskSpec({ title: "Deduplicate run state" }));

    await writeFile(
      join(root, ".orchestrator", "runs", `${run.id}.json`),
      JSON.stringify({
        ...run,
        updatedAt: "2026-06-22T00:00:00.000Z"
      }),
      "utf8"
    );

    const runs = await store.list();

    expect(runs.filter((candidate) => candidate.id === run.id)).toHaveLength(1);
  });

  it("persists planner root contract and task tree artifacts from planner output", async () => {
    const root = await tempRoot();
    const store = new FileRunStore(root);
    const roles: RoleProviders = {
      planner: {
        async plan(): Promise<RoleReport> {
          const createdAt = "2026-06-22T00:00:00.000Z";
          return {
            role: "planner",
            status: "ok",
            summary: "Planned with root contract.",
            proposedSubtasks: [
              {
                id: "contract-task",
                title: "Apply contract",
                description: "Implement only the approved root goal.",
                dependsOn: [],
                assignedRole: "executor",
                createdAt,
                updatedAt: createdAt
              }
            ],
            data: {
              rootContract: {
                goal: "Approved root goal",
                nonGoals: ["Do not redesign UI"],
                mustFollow: ["Preserve existing behavior"],
                acceptanceCriteria: ["Behavior is preserved"],
                contextGuard: ["Reject unrelated UI changes"],
                repoConstraints: ["No commits"],
                userDecisions: ["User approved bounded scope"]
              },
              taskTree: {
                tasks: [
                  {
                    id: "contract-task",
                    title: "Apply contract",
                    description: "Implement only the approved root goal."
                  }
                ]
              }
            }
          };
        }
      },
      executor: new MockExecutor(),
      reviewer: {
        async review(input: { subtask: Subtask; executorReport: RoleReport }): Promise<RoleReport> {
          return {
            role: "reviewer",
            status: "ok",
            subtaskId: input.subtask.id,
            summary: `Verified ${input.executorReport.summary}`
          };
        }
      }
    };
    const orchestrator = new RootOrchestrator({ store, roles });

    const run = await orchestrator.runTask(createTaskSpec({ title: "Fallback title" }));
    const rootContract = JSON.parse(await readFile(store.pathForRootContract(run.id), "utf8"));
    const taskTree = JSON.parse(await readFile(store.pathForTaskTree(run.id), "utf8"));

    expect(rootContract).toMatchObject({
      goal: "Approved root goal",
      nonGoals: ["Do not redesign UI"],
      mustFollow: ["Preserve existing behavior", "Mock closed-loop run completes at least one bounded subtask."],
      acceptanceCriteria: ["Behavior is preserved"],
      contextGuard: ["Reject unrelated UI changes"],
      repoConstraints: ["No commits"],
      userDecisions: ["User approved bounded scope"]
    });
    expect(taskTree.tasks[0]).toMatchObject({
      id: "contract-task",
      title: "Apply contract",
      description: "Implement only the approved root goal.",
      status: "completed"
    });
  });
});

import { describe, expect, it } from "vitest";
import type { Context, Graph, Subtask, TaskSpec } from "../src/domain.js";
import { CodexCliExecutor, buildCodexCliCommand, createExecutorTaskSpec } from "../src/executors.js";

const spec: TaskSpec = {
  id: "task-1",
  title: "Build adapter boundary",
  description: "Prepare executor command construction.",
  acceptanceCriteria: ["Command can be inspected without execution."],
  permissionMode: "write"
};

const context: Context = {
  runId: "run-1",
  task: spec,
  items: [
    {
      id: "ctx-1",
      kind: "fact",
      text: "Existing graph is managed by root.",
      source: "root",
      createdAt: "2026-06-22T00:00:00.000Z"
    }
  ]
};

const graph: Graph = {
  subtasks: [],
  conflicts: []
};

const subtask: Subtask = {
  id: "subtask-1",
  title: "Prepare dry-run executor",
  description: "Generate the command and return a report.",
  dependsOn: [],
  status: "active",
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:00.000Z"
};

describe("CodexCliExecutor", () => {
  it("builds a dry-run command from a single bounded subtask", async () => {
    const task = createExecutorTaskSpec({
      runId: "run-1",
      spec,
      context,
      subtask,
      worktreeEnabled: true
    });
    const executor = new CodexCliExecutor({ mode: "codex-cli-dry-run", codexBinary: "codex" });
    const contextBefore = structuredClone(context);
    const graphBefore = structuredClone(graph);

    const report = await executor.execute({
      runId: "run-1",
      spec,
      context,
      graph,
      subtask,
      task
    });

    expect(report.status).toBe("ok");
    expect(report.subtaskId).toBe("subtask-1");
    expect(report.contextDelta?.items[0]?.text).toContain("Dry-run command:");
    expect(report.data?.dryRun).toBe(true);
    expect(report.data?.command).toEqual(buildCodexCliCommand(task, "codex"));
    expect(task.worktree.branchHint).toContain("orchestrator/");
    expect(context).toEqual(contextBefore);
    expect(graph).toEqual(graphBefore);
  });

  it("blocks real codex-cli mode unless execution is explicitly enabled later", async () => {
    const task = createExecutorTaskSpec({
      runId: "run-1",
      spec,
      context,
      subtask,
      worktreeEnabled: false
    });
    const executor = new CodexCliExecutor({ mode: "codex-cli" });

    const report = await executor.execute({
      runId: "run-1",
      spec,
      context,
      graph,
      subtask,
      task
    });

    expect(report.status).toBe("blocked");
    expect(report.summary).toContain("disabled");
    expect(report.data?.executorMode).toBe("codex-cli");
  });
});

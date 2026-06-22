import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoopRun } from "../src/domain.js";
import { createRunCliReport } from "../src/run-report.js";

describe("run CLI report", () => {
  it("creates a stable automation-friendly run summary", () => {
    const run = loopRun();
    const report = createRunCliReport(run, {
      pathForRun: (runId) => `/tmp/project/.orchestrator/runs/${runId}.json`
    });

    expect(report).toMatchObject({
      runId: "run-1",
      status: "blocked",
      iterations: 2,
      permissionMode: "write",
      task: {
        id: "task-1",
        title: "JSON smoke",
        description: "Exercise run report.",
        acceptanceCriteria: ["Report is machine-readable."]
      },
      counts: {
        pending: 1,
        active: 0,
        completed: 1,
        blocked: 1,
        failed: 0,
        total: 3
      },
      savedPath: "/tmp/project/.orchestrator/runs/run-1.json"
    });
    expect(report.run).toBe(run);
  });

  it("shows JSON support for run and resume in CLI usage", async () => {
    const cliSource = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(cliSource).toContain("task-loop-orchestrator run <title>");
    expect(cliSource).toContain("[--max-iterations n] [--json]");
    expect(cliSource).toContain("task-loop-orchestrator resume <runId> [--max-iterations n] [--json]");
  });
});

function loopRun(): LoopRun {
  return {
    id: "run-1",
    spec: {
      id: "task-1",
      title: "JSON smoke",
      description: "Exercise run report.",
      acceptanceCriteria: ["Report is machine-readable."],
      permissionMode: "write"
    },
    context: {
      runId: "run-1",
      task: {
        id: "task-1",
        title: "JSON smoke",
        description: "Exercise run report.",
        acceptanceCriteria: ["Report is machine-readable."],
        permissionMode: "write"
      },
      items: []
    },
    graph: {
      subtasks: [
        {
          id: "subtask-1",
          title: "Done",
          dependsOn: [],
          status: "completed",
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z"
        },
        {
          id: "subtask-2",
          title: "Waiting",
          dependsOn: [],
          status: "pending",
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z"
        },
        {
          id: "subtask-3",
          title: "Blocked",
          dependsOn: [],
          status: "blocked",
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z"
        }
      ],
      conflicts: []
    },
    events: [],
    status: "blocked",
    iterations: 2,
    permissionMode: "write",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoopRun } from "../src/domain.js";
import { createRunCliReport, createRunHistoryReport, createRunMarkdownReport } from "../src/run-report.js";

describe("run CLI report", () => {
  it("creates a stable automation-friendly run summary", () => {
    const run = loopRun();
    const report = createRunCliReport(run, {
      pathForRun: (runId) => `/tmp/project/.orchestrator/runs/${runId}`
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
      latestDecision: {
        action: "block",
        verdict: "owner_decision",
        reason: "Owner decision required: choose UI boundary.",
        subtaskId: "subtask-3"
      },
      ownerDecisionItems: [
        {
          subtaskId: "subtask-3",
          reason: "Owner decision required: choose UI boundary."
        }
      ],
      blockedSubtasks: [
        {
          id: "subtask-3",
          title: "Blocked",
          status: "blocked"
        }
      ],
      savedPath: "/tmp/project/.orchestrator/runs/run-1"
    });
    expect(report.run).toBe(run);
  });

  it("creates history and markdown summaries from stored run state", () => {
    const run = loopRun();
    const store = {
      pathForRun: (runId: string) => `/tmp/project/.orchestrator/runs/${runId}`
    };

    const history = createRunHistoryReport([run], store);
    const markdown = createRunMarkdownReport(run, store);

    expect(history).toMatchObject({
      status: "ok",
      runCount: 1,
      runs: [
        {
          runId: "run-1",
          status: "blocked",
          taskTitle: "JSON smoke",
          latestDecision: {
            action: "block",
            verdict: "owner_decision"
          },
          ownerDecisionItems: [
            {
              reason: "Owner decision required: choose UI boundary."
            }
          ]
        }
      ]
    });
    expect(markdown).toContain("# Run run-1");
    expect(markdown).toContain("## Latest Root Decision");
    expect(markdown).toContain("- action: block");
    expect(markdown).toContain("## Owner Decisions");
    expect(markdown).toContain("Owner decision required: choose UI boundary.");
  });

  it("shows JSON support for run and resume in CLI usage", async () => {
    const cliSource = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(cliSource).toContain("task-loop-orchestrator run <instruction>");
    expect(cliSource).toContain("[--max-iterations n] [--json]");
    expect(cliSource).toContain("task-loop-orchestrator status [runId] [--json] [--raw]");
    expect(cliSource).toContain("task-loop-orchestrator history [--json]");
    expect(cliSource).toContain("task-loop-orchestrator report [runId] [--json]");
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
    events: [
      {
        id: "event-1",
        kind: "graph_updated",
        message: "Blocked subtask-3.",
        role: "root",
        subtaskId: "subtask-3",
        createdAt: "2026-06-22T00:00:00.000Z",
        data: {
          rootDecision: {
            action: "block",
            verdict: "owner_decision",
            reason: "Owner decision required: choose UI boundary."
          }
        }
      }
    ],
    status: "blocked",
    iterations: 2,
    permissionMode: "write",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

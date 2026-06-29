import { describe, expect, it } from "vitest";
import type { LoopRun } from "../src/domain.js";
import { formatPlanPreview } from "../src/plan-preview.js";

describe("plan preview", () => {
  it("shows the root contract, task tree, and approval choices", () => {
    const output = formatPlanPreview(loopRun());

    expect(output).toContain("Plan approval");
    expect(output).toContain("Root contract:");
    expect(output).toContain("- Goal: Approved root goal");
    expect(output).toContain("- Non-goals:");
    expect(output).toContain("  - Do not redesign UI");
    expect(output).toContain("- Must follow:");
    expect(output).toContain("  - Preserve existing behavior");
    expect(output).toContain("- Acceptance criteria:");
    expect(output).toContain("  - Behavior is preserved");
    expect(output).toContain("- Context guard:");
    expect(output).toContain("  - Reject unrelated UI changes");
    expect(output).toContain("Task tree:");
    expect(output).toContain("1. [pending] Apply contract");
    expect(output).toContain("Implement only the approved root goal.");
    expect(output).toContain("Decision:");
    expect(output).toContain("- y: approve this plan and start execution");
    expect(output).toContain("- n: enter a revision request, or leave it blank to stop");
  });
});

function loopRun(): LoopRun {
  return {
    id: "run-1",
    spec: {
      id: "task-1",
      title: "Fallback task",
      description: "Fallback description.",
      acceptanceCriteria: ["Fallback acceptance."],
      permissionMode: "write"
    },
    context: {
      runId: "run-1",
      task: {
        id: "task-1",
        title: "Fallback task",
        description: "Fallback description.",
        acceptanceCriteria: ["Fallback acceptance."],
        permissionMode: "write"
      },
      items: []
    },
    graph: {
      subtasks: [
        {
          id: "task-a",
          title: "Apply contract",
          description: "Implement only the approved root goal.",
          dependsOn: [],
          status: "pending",
          assignedRole: "executor",
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z"
        }
      ],
      conflicts: []
    },
    events: [
      {
        id: "event-1",
        kind: "planned",
        message: "Planned with root contract.",
        role: "planner",
        createdAt: "2026-06-22T00:00:00.000Z",
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
                id: "task-a",
                title: "Apply contract",
                description: "Implement only the approved root goal."
              }
            ]
          }
        }
      }
    ],
    status: "running",
    iterations: 0,
    permissionMode: "write",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

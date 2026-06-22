import { describe, expect, it } from "vitest";
import type { Graph, Subtask } from "../src/domain.js";
import { completeSubtask, markSubtaskActive, selectNextSubtask } from "../src/graph.js";

function subtask(id: string, dependsOn: string[] = []): Subtask {
  return {
    id,
    title: id,
    dependsOn,
    status: "pending",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

describe("graph state transitions", () => {
  it("selects the first pending subtask whose dependencies are complete", () => {
    const graph: Graph = {
      subtasks: [subtask("a"), subtask("b", ["a"])],
      conflicts: []
    };

    expect(selectNextSubtask(graph)?.id).toBe("a");

    const completedA = completeSubtask(markSubtaskActive(graph, "a", "executor"), "a", "done", "verified");
    expect(selectNextSubtask(completedA)?.id).toBe("b");
    expect(completedA.nextCandidateId).toBe("b");
  });

  it("does not select more work while a worker is active", () => {
    const graph: Graph = {
      subtasks: [subtask("a"), subtask("b")],
      conflicts: []
    };

    const active = markSubtaskActive(graph, "a", "executor");

    expect(selectNextSubtask(active)).toBeUndefined();
    expect(active.subtasks.find((candidate) => candidate.id === "a")?.status).toBe("active");
  });

  it("rejects invalid completion transitions", () => {
    const graph: Graph = {
      subtasks: [subtask("a")],
      conflicts: []
    };

    expect(() => completeSubtask(graph, "a", "done")).toThrow("Cannot complete subtask a from pending.");
  });
});

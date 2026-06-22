import type { Graph, RoleName, Subtask } from "./domain.js";
import { nowIso } from "./ids.js";

export function createEmptyGraph(): Graph {
  return {
    subtasks: [],
    conflicts: []
  };
}

export function addSubtasks(graph: Graph, subtasks: Subtask[]): Graph {
  const existingIds = new Set(graph.subtasks.map((subtask) => subtask.id));
  const additions = subtasks.filter((subtask) => !existingIds.has(subtask.id));

  return {
    ...graph,
    subtasks: [...graph.subtasks, ...additions]
  };
}

export function selectNextSubtask(graph: Graph): Subtask | undefined {
  if (graph.activeWorker) {
    return undefined;
  }

  return graph.subtasks.find((subtask) => {
    if (subtask.status !== "pending") {
      return false;
    }

    return subtask.dependsOn.every((dependencyId) => {
      const dependency = graph.subtasks.find((candidate) => candidate.id === dependencyId);
      return dependency?.status === "completed";
    });
  });
}

export function markSubtaskActive(graph: Graph, subtaskId: string, role: RoleName): Graph {
  if (graph.activeWorker) {
    throw new Error(`Cannot activate ${subtaskId}; ${graph.activeWorker.subtaskId} is already active.`);
  }

  const now = nowIso();
  let found = false;
  const subtasks = graph.subtasks.map((subtask) => {
    if (subtask.id !== subtaskId) {
      return subtask;
    }

    if (subtask.status !== "pending") {
      throw new Error(`Cannot activate subtask ${subtaskId} from ${subtask.status}.`);
    }

    found = true;
    return {
      ...subtask,
      status: "active" as const,
      assignedRole: role,
      updatedAt: now
    };
  });

  if (!found) {
    throw new Error(`Subtask ${subtaskId} was not found.`);
  }

  return {
    ...graph,
    subtasks,
    activeWorker: {
      role,
      subtaskId,
      startedAt: now
    },
    nextCandidateId: undefined
  };
}

export function completeSubtask(
  graph: Graph,
  subtaskId: string,
  result: string,
  verification?: string
): Graph {
  const now = nowIso();
  let found = false;
  const subtasks = graph.subtasks.map((subtask) => {
    if (subtask.id !== subtaskId) {
      return subtask;
    }

    if (subtask.status !== "active") {
      throw new Error(`Cannot complete subtask ${subtaskId} from ${subtask.status}.`);
    }

    found = true;
    return {
      ...subtask,
      status: "completed" as const,
      result,
      verification,
      updatedAt: now
    };
  });

  if (!found) {
    throw new Error(`Subtask ${subtaskId} was not found.`);
  }

  const nextGraph = {
    ...graph,
    subtasks,
    activeWorker: undefined
  };
  const next = selectNextSubtask(nextGraph);

  return {
    ...nextGraph,
    nextCandidateId: next?.id
  };
}

export function blockSubtask(graph: Graph, subtaskId: string, reason: string): Graph {
  const now = nowIso();
  let found = false;
  const subtasks = graph.subtasks.map((subtask) => {
    if (subtask.id !== subtaskId) {
      return subtask;
    }

    found = true;
    return {
      ...subtask,
      status: "blocked" as const,
      result: reason,
      updatedAt: now
    };
  });

  if (!found) {
    throw new Error(`Subtask ${subtaskId} was not found.`);
  }

  return {
    ...graph,
    subtasks,
    activeWorker: graph.activeWorker?.subtaskId === subtaskId ? undefined : graph.activeWorker
  };
}

export function isGraphComplete(graph: Graph): boolean {
  return graph.subtasks.length > 0 && graph.subtasks.every((subtask) => subtask.status === "completed");
}

export function hasBlockedWork(graph: Graph): boolean {
  return graph.subtasks.some((subtask) => subtask.status === "blocked" || subtask.status === "failed");
}

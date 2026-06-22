import type { LoopRun, SubtaskStatus } from "./domain.js";
import type { FileRunStore } from "./store.js";

export interface RunCliReport {
  runId: string;
  status: LoopRun["status"];
  iterations: number;
  permissionMode: LoopRun["permissionMode"];
  task: {
    id: string;
    title: string;
    description?: string;
    acceptanceCriteria: string[];
  };
  counts: Record<SubtaskStatus, number> & {
    total: number;
  };
  savedPath: string;
  run: LoopRun;
}

export function createRunCliReport(run: LoopRun, store: Pick<FileRunStore, "pathForRun">): RunCliReport {
  return {
    runId: run.id,
    status: run.status,
    iterations: run.iterations,
    permissionMode: run.permissionMode,
    task: {
      id: run.spec.id,
      title: run.spec.title,
      description: run.spec.description,
      acceptanceCriteria: run.spec.acceptanceCriteria
    },
    counts: countSubtasks(run),
    savedPath: store.pathForRun(run.id),
    run
  };
}

export function countSubtasks(run: LoopRun): RunCliReport["counts"] {
  const counts = {
    pending: 0,
    active: 0,
    completed: 0,
    blocked: 0,
    failed: 0,
    total: run.graph.subtasks.length
  };

  for (const subtask of run.graph.subtasks) {
    counts[subtask.status] += 1;
  }

  return counts;
}

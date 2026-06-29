import type { ActiveWorker, LoopEvent, LoopRun, Subtask, SubtaskStatus } from "./domain.js";

export interface RootContractArtifact {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  goal: string;
  description?: string;
  nonGoals: string[];
  mustFollow: string[];
  acceptanceCriteria: string[];
  contextGuard: string[];
  repoConstraints: string[];
  userDecisions: string[];
  permissionMode: LoopRun["permissionMode"];
  updatedAt: string;
}

export interface TaskTreeArtifact {
  schemaVersion: 1;
  runId: string;
  tasks: TaskTreeNode[];
  conflicts: Array<{
    id: string;
    subtaskId?: string;
    description: string;
    createdAt: string;
  }>;
  updatedAt: string;
}

export interface TaskTreeNode {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  status: SubtaskStatus;
  assignedRole?: Subtask["assignedRole"];
  resultSummary?: string;
  verificationSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunStateArtifact {
  schemaVersion: 1;
  runId: string;
  status: LoopRun["status"];
  iterations: number;
  permissionMode: LoopRun["permissionMode"];
  counts: Record<SubtaskStatus, number> & {
    total: number;
  };
  activeWorker?: ActiveWorker;
  nextCandidateId?: string;
  lastEvent?: Pick<LoopEvent, "id" | "kind" | "message" | "createdAt" | "role" | "subtaskId">;
  createdAt: string;
  updatedAt: string;
}

const defaultContextGuard = [
  "Keep every executor task aligned with the approved root goal.",
  "Do not expand into non-goals or unrelated refactors.",
  "Treat reviewer pass as insufficient when the result violates the root contract."
];

const defaultRepoConstraints = [
  "Do not create branches, commits, pushes, pull requests, tags, releases, or Jira transitions unless a later explicit approval model enables them.",
  "Keep run state local under .orchestrator/."
];

export function createRootContractArtifact(run: LoopRun): RootContractArtifact {
  return {
    schemaVersion: 1,
    runId: run.id,
    taskId: run.spec.id,
    goal: run.spec.title,
    description: run.spec.description,
    nonGoals: [],
    mustFollow: [...run.spec.acceptanceCriteria],
    acceptanceCriteria: [...run.spec.acceptanceCriteria],
    contextGuard: [...defaultContextGuard],
    repoConstraints: [...defaultRepoConstraints],
    userDecisions: userDecisionSummaries(run),
    permissionMode: run.permissionMode,
    updatedAt: run.updatedAt
  };
}

export function createTaskTreeArtifact(run: LoopRun): TaskTreeArtifact {
  return {
    schemaVersion: 1,
    runId: run.id,
    tasks: run.graph.subtasks.map(subtaskToTaskTreeNode),
    conflicts: run.graph.conflicts.map((conflict) => ({
      id: conflict.id,
      subtaskId: conflict.subtaskId,
      description: conflict.description,
      createdAt: conflict.createdAt
    })),
    updatedAt: run.updatedAt
  };
}

export function createRunStateArtifact(run: LoopRun): RunStateArtifact {
  const lastEvent = run.events.at(-1);

  return {
    schemaVersion: 1,
    runId: run.id,
    status: run.status,
    iterations: run.iterations,
    permissionMode: run.permissionMode,
    counts: countSubtasks(run),
    activeWorker: run.graph.activeWorker,
    nextCandidateId: run.graph.nextCandidateId,
    lastEvent: lastEvent
      ? {
          id: lastEvent.id,
          kind: lastEvent.kind,
          message: lastEvent.message,
          createdAt: lastEvent.createdAt,
          role: lastEvent.role,
          subtaskId: lastEvent.subtaskId
        }
      : undefined,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

export function createRunSummaryMarkdown(run: LoopRun): string {
  const counts = countSubtasks(run);
  const lines = [
    `# Run ${run.id}`,
    "",
    `Status: ${run.status}`,
    `Task: ${run.spec.title}`,
    `Iterations: ${run.iterations}`,
    `Permission: ${run.permissionMode}`,
    `Subtasks: ${counts.completed}/${counts.total} completed`,
    "",
    "## Acceptance Criteria",
    ...listOrPlaceholder(run.spec.acceptanceCriteria),
    "",
    "## Tasks",
    ...tasksMarkdown(run.graph.subtasks),
    "",
    "## Last Event",
    run.events.at(-1) ? `- ${run.events.at(-1)?.kind}: ${run.events.at(-1)?.message}` : "- None",
    ""
  ];

  return `${lines.join("\n")}\n`;
}

export function countSubtasks(run: Pick<LoopRun, "graph">): RunStateArtifact["counts"] {
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

function subtaskToTaskTreeNode(subtask: Subtask): TaskTreeNode {
  return {
    id: subtask.id,
    title: subtask.title,
    description: subtask.description,
    dependsOn: [...subtask.dependsOn],
    status: subtask.status,
    assignedRole: subtask.assignedRole,
    resultSummary: summarizeText(subtask.result),
    verificationSummary: summarizeText(subtask.verification),
    createdAt: subtask.createdAt,
    updatedAt: subtask.updatedAt
  };
}

function userDecisionSummaries(run: LoopRun): string[] {
  return run.context.items
    .filter((item) => item.kind === "decision" && item.source === "root")
    .map((item) => item.text);
}

function tasksMarkdown(subtasks: Subtask[]): string[] {
  if (subtasks.length === 0) {
    return ["- None"];
  }

  return subtasks.map((subtask) => `- [${subtask.status}] ${subtask.title}`);
}

function listOrPlaceholder(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- None"];
}

function summarizeText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
}

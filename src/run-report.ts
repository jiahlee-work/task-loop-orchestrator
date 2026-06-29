import type { LoopEvent, LoopRun, ReviewVerdict, Subtask, SubtaskStatus } from "./domain.js";
import type { FileRunStore } from "./store.js";

export interface RunDecisionSummary {
  action: "complete" | "reschedule" | "block" | "fail";
  verdict?: ReviewVerdict;
  reason: string;
  subtaskId?: string;
  eventId: string;
  createdAt: string;
}

export interface RunOwnerDecisionSummary {
  subtaskId?: string;
  reason: string;
  createdAt: string;
}

export interface RunHistoryItem {
  runId: string;
  status: LoopRun["status"];
  taskTitle: string;
  counts: RunCliReport["counts"];
  latestDecision?: RunDecisionSummary;
  ownerDecisionItems: RunOwnerDecisionSummary[];
  savedPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunHistoryReport {
  status: "ok";
  runCount: number;
  runs: RunHistoryItem[];
}

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
  latestDecision?: RunDecisionSummary;
  ownerDecisionItems: RunOwnerDecisionSummary[];
  blockedSubtasks: Array<Pick<Subtask, "id" | "title" | "status" | "result">>;
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
    latestDecision: latestRootDecision(run),
    ownerDecisionItems: ownerDecisionItems(run),
    blockedSubtasks: run.graph.subtasks
      .filter((subtask) => subtask.status === "blocked" || subtask.status === "failed")
      .map((subtask) => ({
        id: subtask.id,
        title: subtask.title,
        status: subtask.status,
        result: subtask.result
      })),
    savedPath: store.pathForRun(run.id),
    run
  };
}

export function createRunHistoryReport(
  runs: LoopRun[],
  store: Pick<FileRunStore, "pathForRun">
): RunHistoryReport {
  return {
    status: "ok",
    runCount: runs.length,
    runs: runs.map((run) => ({
      runId: run.id,
      status: run.status,
      taskTitle: run.spec.title,
      counts: countSubtasks(run),
      latestDecision: latestRootDecision(run),
      ownerDecisionItems: ownerDecisionItems(run),
      savedPath: store.pathForRun(run.id),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    }))
  };
}

export function createRunMarkdownReport(run: LoopRun, store: Pick<FileRunStore, "pathForRun">): string {
  const report = createRunCliReport(run, store);
  const lines = [
    `# Run ${run.id}`,
    "",
    `Status: ${run.status}`,
    `Task: ${run.spec.title}`,
    `Iterations: ${run.iterations}`,
    `Permission: ${run.permissionMode}`,
    `Saved: ${report.savedPath}`,
    "",
    "## Counts",
    `- completed: ${report.counts.completed}`,
    `- pending: ${report.counts.pending}`,
    `- active: ${report.counts.active}`,
    `- blocked: ${report.counts.blocked}`,
    `- failed: ${report.counts.failed}`,
    `- total: ${report.counts.total}`,
    "",
    "## Latest Root Decision",
    ...(report.latestDecision
      ? [
          `- action: ${report.latestDecision.action}`,
          `- verdict: ${report.latestDecision.verdict ?? "unknown"}`,
          `- reason: ${report.latestDecision.reason}`,
          `- subtask: ${report.latestDecision.subtaskId ?? "none"}`
        ]
      : ["- none"]),
    "",
    "## Owner Decisions",
    ...(report.ownerDecisionItems.length > 0
      ? report.ownerDecisionItems.map((item) => `- ${item.subtaskId ?? "run"}: ${item.reason}`)
      : ["- none"]),
    "",
    "## Blocked Or Failed Subtasks",
    ...(report.blockedSubtasks.length > 0
      ? report.blockedSubtasks.map((item) => `- [${item.status}] ${item.title}: ${item.result ?? "no reason"}`)
      : ["- none"]),
    "",
    "## Recent Events",
    ...recentEvents(run, 10).map((event) => `- ${event.kind}: ${event.message}`),
    ""
  ];

  return `${lines.join("\n")}\n`;
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

function latestRootDecision(run: LoopRun): RunDecisionSummary | undefined {
  for (const event of [...run.events].reverse()) {
    const decision = parseRootDecision(event);
    if (decision) {
      return decision;
    }
  }

  return undefined;
}

function ownerDecisionItems(run: LoopRun): RunOwnerDecisionSummary[] {
  return run.events
    .map(parseRootDecision)
    .filter((decision): decision is RunDecisionSummary => decision?.verdict === "owner_decision")
    .map((decision) => ({
      subtaskId: decision.subtaskId,
      reason: decision.reason,
      createdAt: decision.createdAt
    }));
}

function parseRootDecision(event: LoopEvent): RunDecisionSummary | undefined {
  const decision = event.data?.rootDecision;
  if (!isRecord(decision)) {
    return undefined;
  }

  const action = decision.action;
  const reason = decision.reason;
  if (!isRootDecisionAction(action) || typeof reason !== "string") {
    return undefined;
  }

  return {
    action,
    verdict: isReviewVerdict(decision.verdict) ? decision.verdict : undefined,
    reason,
    subtaskId: event.subtaskId,
    eventId: event.id,
    createdAt: event.createdAt
  };
}

function recentEvents(run: LoopRun, count: number): LoopEvent[] {
  return run.events.slice(-count);
}

function isRootDecisionAction(value: unknown): value is RunDecisionSummary["action"] {
  return value === "complete" || value === "reschedule" || value === "block" || value === "fail";
}

function isReviewVerdict(value: unknown): value is ReviewVerdict {
  return value === "accept" || value === "request_changes" || value === "reschedule" || value === "owner_decision";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

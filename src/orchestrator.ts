import { appendEvent, appendStatusEvent } from "./audit.js";
import { appendContextDelta, createContext } from "./context.js";
import type { ContextItem, LoopRun, RoleReport, Subtask, TaskSpec } from "./domain.js";
import { createExecutorTaskSpec } from "./executors.js";
import {
  addSubtasks,
  blockSubtask,
  completeSubtask,
  createEmptyGraph,
  hasBlockedWork,
  isGraphComplete,
  markSubtaskActive,
  selectNextSubtask
} from "./graph.js";
import { createId, nowIso } from "./ids.js";
import { applyPermissionGate } from "./permission.js";
import { createMockToolProviders, type ToolProviders } from "./providers.js";
import { collectReviewEvidence } from "./reviewers.js";
import { createMockRoleProviders, type RoleProviders } from "./roles.js";
import { FileRunStore } from "./store.js";

export interface RootOrchestratorOptions {
  store?: FileRunStore;
  roles?: RoleProviders;
  tools?: ToolProviders;
  maxIterations?: number;
  worktreeEnabled?: boolean;
}

export interface RunTaskOptions {
  runId?: string;
  maxIterations?: number;
}

export class RootOrchestrator {
  private readonly store: FileRunStore;
  private readonly roles: RoleProviders;
  private readonly tools: ToolProviders;
  private readonly maxIterations: number;
  private readonly worktreeEnabled: boolean;

  constructor(options: RootOrchestratorOptions = {}) {
    this.store = options.store ?? new FileRunStore();
    this.roles = options.roles ?? createMockRoleProviders();
    this.tools = options.tools ?? createMockToolProviders();
    this.maxIterations = options.maxIterations ?? 10;
    this.worktreeEnabled = options.worktreeEnabled ?? false;
  }

  async runTask(spec: TaskSpec, options: RunTaskOptions = {}): Promise<LoopRun> {
    let run = await this.discover(spec, options.runId);
    await this.store.save(run);

    const targetIterations = run.iterations + (options.maxIterations ?? this.maxIterations);
    while (run.status === "running" && run.iterations < targetIterations) {
      run = await this.iterate(run);
      await this.store.save(run);
    }

    if (run.status === "running") {
      run = appendStatusEvent(
        {
          ...run,
          status: "blocked",
          updatedAt: nowIso()
        },
        "run_blocked",
        `Run reached max additional iterations (${targetIterations}).`
      );
      await this.store.save(run);
    }

    return run;
  }

  async resume(runId: string, options: RunTaskOptions = {}): Promise<LoopRun> {
    let run = await this.store.load(runId);
    if (run.status !== "running" && run.status !== "blocked") {
      return run;
    }

    run = {
      ...run,
      status: "running",
      updatedAt: nowIso()
    };

    const targetIterations = run.iterations + (options.maxIterations ?? this.maxIterations);
    while (run.status === "running" && run.iterations < targetIterations) {
      run = await this.iterate(run);
      await this.store.save(run);
    }

    if (run.status === "running") {
      run = appendStatusEvent(
        {
          ...run,
          status: "blocked",
          updatedAt: nowIso()
        },
        "run_blocked",
        `Resume reached max additional iterations (${targetIterations}).`
      );
      await this.store.save(run);
    }

    return run;
  }

  async discover(spec: TaskSpec, runId: string = createId("run")): Promise<LoopRun> {
    const now = nowIso();
    let run: LoopRun = {
      id: runId,
      spec,
      context: createContext(runId, spec),
      graph: createEmptyGraph(),
      events: [],
      status: "running",
      iterations: 0,
      permissionMode: spec.permissionMode,
      createdAt: now,
      updatedAt: now
    };

    const permission = applyPermissionGate(run, "read_state");
    run = permission.run;
    if (!permission.decision.allowed) {
      return run;
    }

    const repoStatus = await this.tools.repo.getStatus();
    const repoFact: ContextItem = {
      id: createId("ctx"),
      kind: "fact",
      text: `Repo status: ${repoStatus}`,
      source: "root",
      createdAt: nowIso()
    };
    run = {
      ...run,
      context: {
        ...run.context,
        items: [...run.context.items, repoFact]
      },
      updatedAt: nowIso()
    };
    run = appendEvent(run, {
      kind: "discovered",
      message: "Discovered task and repository snapshot.",
      role: "root",
      data: {
        taskId: spec.id,
        repoStatus
      }
    });
    return appendEvent(run, {
      kind: "context_updated",
      message: "Added repository snapshot to context.",
      role: "root",
      data: {
        itemId: repoFact.id
      }
    });
  }

  async plan(run: LoopRun): Promise<LoopRun> {
    const report = await this.roles.planner.plan({
      spec: run.spec,
      context: run.context,
      graph: run.graph
    });

    return appendEvent(this.applyRoleReport(run, report), {
      kind: "planned",
      message: report.summary,
      role: "planner",
      data: {
        proposedSubtasks: report.proposedSubtasks?.length ?? 0,
        status: report.status
      }
    });
  }

  selectNextSubtask(run: LoopRun): Subtask | undefined {
    return selectNextSubtask(run.graph);
  }

  async executeSubtask(run: LoopRun, subtask: Subtask): Promise<{ run: LoopRun; report: RoleReport }> {
    const activeGraph = markSubtaskActive(run.graph, subtask.id, "executor");
    const activeRun = appendEvent(
      {
        ...run,
        graph: activeGraph,
        updatedAt: nowIso()
      },
      {
        kind: "execution_started",
        message: `Executor started ${subtask.title}.`,
        role: "executor",
        subtaskId: subtask.id
      }
    );

    const report = await this.roles.executor.execute({
      runId: activeRun.id,
      spec: activeRun.spec,
      context: activeRun.context,
      graph: activeRun.graph,
      subtask: { ...subtask, status: "active" },
      task: createExecutorTaskSpec({
        runId: activeRun.id,
        spec: activeRun.spec,
        context: activeRun.context,
        subtask: { ...subtask, status: "active" },
        worktreeEnabled: this.worktreeEnabled
      })
    });

    return {
      run: appendEvent(this.applyRoleReport(activeRun, report), {
        kind: "execution_completed",
        message: report.summary,
        role: "executor",
        subtaskId: subtask.id,
        data: {
          status: report.status,
          ...(report.data ? { report: report.data } : {})
        }
      }),
      report
    };
  }

  async verifyResult(run: LoopRun, subtaskId: string, executorReport: RoleReport): Promise<LoopRun> {
    const subtask = run.graph.subtasks.find((candidate) => candidate.id === subtaskId);
    if (!subtask) {
      throw new Error(`Cannot verify missing subtask ${subtaskId}.`);
    }

    const evidence = await collectReviewEvidence({
      spec: run.spec,
      context: run.context,
      graph: run.graph,
      subtask,
      executorReport,
      repo: this.tools.repo
    });
    run = appendEvent(run, {
      kind: "verification_evidence_collected",
      message: `Collected ${evidence.length} reviewer evidence items.`,
      role: "root",
      subtaskId,
      data: {
        evidenceKinds: evidence.map((item) => item.kind)
      }
    });

    const reviewerReport = await this.roles.reviewer.review({
      spec: run.spec,
      context: run.context,
      graph: run.graph,
      subtask,
      executorReport,
      evidence
    });
    let nextRun = appendEvent(this.applyRoleReport(run, reviewerReport), {
      kind: "review_completed",
      message: reviewerReport.summary,
      role: "reviewer",
      subtaskId,
      data: {
        status: reviewerReport.status,
        ...(reviewerReport.data ? { report: reviewerReport.data } : {})
      }
    });

    if (executorReport.status === "ok" && reviewerReport.status === "ok") {
      nextRun = appendEvent(
        {
          ...nextRun,
          graph: completeSubtask(nextRun.graph, subtaskId, executorReport.summary, reviewerReport.summary),
          updatedAt: nowIso()
        },
        {
          kind: "graph_updated",
          message: `Marked ${subtaskId} completed.`,
          role: "root",
          subtaskId
        }
      );
    } else {
      nextRun = appendEvent(
        {
          ...nextRun,
          status: "blocked",
          graph: blockSubtask(nextRun.graph, subtaskId, reviewerReport.summary),
          updatedAt: nowIso()
        },
        {
          kind: "graph_updated",
          message: `Blocked ${subtaskId}.`,
          role: "root",
          subtaskId
        }
      );
    }

    return nextRun;
  }

  async iterate(run: LoopRun): Promise<LoopRun> {
    let nextRun = await this.plan(run);
    const nextSubtask = this.selectNextSubtask(nextRun);

    if (!nextSubtask) {
      return this.finalizeRun(nextRun);
    }

    nextRun = appendEvent(nextRun, {
      kind: "subtask_selected",
      message: `Selected ${nextSubtask.title}.`,
      role: "root",
      subtaskId: nextSubtask.id
    });

    const writeGate = applyPermissionGate(nextRun, "write_file");
    nextRun = writeGate.run;
    if (!writeGate.decision.allowed) {
      return nextRun;
    }

    const execution = await this.executeSubtask(nextRun, nextSubtask);
    nextRun = execution.run;

    const testGate = applyPermissionGate(nextRun, "run_tests");
    nextRun = testGate.run;
    if (!testGate.decision.allowed) {
      return nextRun;
    }

    nextRun = await this.verifyResult(nextRun, nextSubtask.id, execution.report);

    return this.finalizeRun({
      ...nextRun,
      iterations: nextRun.iterations + 1,
      updatedAt: nowIso()
    });
  }

  private applyRoleReport(run: LoopRun, report: RoleReport): LoopRun {
    let graph = run.graph;
    let nextRun = run;
    if (report.proposedSubtasks) {
      graph = addSubtasks(
        graph,
        report.proposedSubtasks.map((subtask) => ({
          ...subtask,
          status: "pending",
          createdAt: subtask.createdAt ?? nowIso(),
          updatedAt: subtask.updatedAt ?? nowIso()
        }))
      );
      graph = {
        ...graph,
        nextCandidateId: selectNextSubtask(graph)?.id
      };
      nextRun = appendEvent(
        {
          ...nextRun,
          graph
        },
        {
          kind: "graph_updated",
          message: `Graph updated from ${report.role} report.`,
          role: "root",
          data: {
            proposedSubtasks: report.proposedSubtasks.length
          }
        }
      );
    }

    const context = appendContextDelta(nextRun.context, report.contextDelta);
    if (context !== nextRun.context) {
      nextRun = appendEvent(
        {
          ...nextRun,
          context
        },
        {
          kind: "context_updated",
          message: `Context updated from ${report.role} report.`,
          role: report.role,
          data: {
            items: report.contextDelta?.items.length ?? 0
          }
        }
      );
    }

    return {
      ...nextRun,
      context,
      graph,
      status: report.status === "failed" ? "failed" : run.status,
      updatedAt: nowIso()
    };
  }

  private finalizeRun(run: LoopRun): LoopRun {
    if (run.status === "failed") {
      return appendStatusEvent(run, "run_failed", "Run failed.");
    }

    if (isGraphComplete(run.graph)) {
      return appendStatusEvent(
        {
          ...run,
          status: "completed",
          updatedAt: nowIso()
        },
        "run_completed",
        "Run completed."
      );
    }

    if (hasBlockedWork(run.graph)) {
      return appendStatusEvent(
        {
          ...run,
          status: "blocked",
          updatedAt: nowIso()
        },
        "run_blocked",
        "Run blocked by graph state."
      );
    }

    return {
      ...run,
      updatedAt: nowIso()
    };
  }
}

export function createTaskSpec(input: {
  id?: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  permissionMode?: TaskSpec["permissionMode"];
}): TaskSpec {
  return {
    id: input.id ?? createId("task"),
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria ?? ["Mock closed-loop run completes at least one bounded subtask."],
    permissionMode: input.permissionMode ?? "write"
  };
}

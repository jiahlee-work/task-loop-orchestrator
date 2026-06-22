import type {
  Context,
  ExecutorTaskSpec,
  Graph,
  ProposedSubtask,
  ReviewEvidence,
  RoleReport,
  Subtask,
  TaskSpec
} from "./domain.js";
import { createContextDeltaItem } from "./context.js";
import { createId, nowIso } from "./ids.js";

export interface PlannerProvider {
  plan(input: { spec: TaskSpec; context: Context; graph: Graph }): Promise<RoleReport>;
}

export interface ExecutorProviderInput {
  runId: string;
  spec: TaskSpec;
  context: Context;
  graph: Graph;
  subtask: Subtask;
  task: ExecutorTaskSpec;
}

export interface ExecutorProvider {
  execute(input: ExecutorProviderInput): Promise<RoleReport>;
}

export interface ReviewerProviderInput {
  spec: TaskSpec;
  context: Context;
  graph: Graph;
  subtask: Subtask;
  executorReport: RoleReport;
  evidence?: ReviewEvidence[];
}

export interface ReviewerProvider {
  review(input: ReviewerProviderInput): Promise<RoleReport>;
}

export interface RoleProviders {
  planner: PlannerProvider;
  executor: ExecutorProvider;
  reviewer: ReviewerProvider;
}

export class MockPlanner implements PlannerProvider {
  async plan(input: { spec: TaskSpec; context: Context; graph: Graph }): Promise<RoleReport> {
    if (input.graph.subtasks.length > 0) {
      return {
        role: "planner",
        status: "ok",
        summary: "Existing graph already has planned subtasks."
      };
    }

    const now = nowIso();
    const proposedSubtask: ProposedSubtask = {
      id: createId("subtask"),
      title: "Implement MVP scaffold loop",
      description: input.spec.description ?? "Create the minimum closed-loop scaffold.",
      dependsOn: [],
      assignedRole: "executor",
      createdAt: now,
      updatedAt: now
    };

    return {
      role: "planner",
      status: "ok",
      summary: "Planned one bounded MVP scaffold subtask.",
      contextDelta: createContextDeltaItem("decision", "Use one bounded mock implementation subtask for the MVP run.", "planner"),
      proposedSubtasks: [proposedSubtask]
    };
  }
}

export class MockExecutor implements ExecutorProvider {
  async execute(input: ExecutorProviderInput): Promise<RoleReport> {
    return {
      role: "executor",
      status: "ok",
      subtaskId: input.subtask.id,
      summary: `Completed bounded work: ${input.subtask.title}.`,
      contextDelta: createContextDeltaItem("completed", `Executor completed ${input.subtask.id}.`, "executor")
    };
  }
}

export class MockReviewer implements ReviewerProvider {
  async review(input: ReviewerProviderInput): Promise<RoleReport> {
    if (input.executorReport.status !== "ok") {
      return {
        role: "reviewer",
        status: "blocked",
        subtaskId: input.subtask.id,
        summary: "Executor did not return an ok report.",
        contextDelta: createContextDeltaItem("blocked", `Reviewer blocked ${input.subtask.id}.`, "reviewer")
      };
    }

    return {
      role: "reviewer",
      status: "ok",
      subtaskId: input.subtask.id,
      summary: `Verified result for ${input.subtask.title}.`,
      contextDelta: createContextDeltaItem("fact", `Reviewer verified ${input.subtask.id}.`, "reviewer")
    };
  }
}

export function createMockRoleProviders(): RoleProviders {
  return {
    planner: new MockPlanner(),
    executor: new MockExecutor(),
    reviewer: new MockReviewer()
  };
}

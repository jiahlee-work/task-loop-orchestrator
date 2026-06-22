import type { Context, ExecutorMode, ExecutorTaskSpec, RoleReport, Subtask, TaskSpec } from "./domain.js";
import { createContextDeltaItem } from "./context.js";
import type { ExecutorProvider, ExecutorProviderInput } from "./roles.js";

export interface CodexCliExecutorOptions {
  mode: Extract<ExecutorMode, "codex-cli-dry-run" | "codex-cli">;
  codexBinary?: string;
  allowExecution?: boolean;
}

export function summarizeTaskSpec(spec: TaskSpec): string {
  const criteria = spec.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
  return [`${spec.title}`, spec.description, criteria ? `Acceptance criteria:\n${criteria}` : undefined]
    .filter(Boolean)
    .join("\n\n");
}

export function summarizeContext(context: Context): string {
  if (context.items.length === 0) {
    return "No context items recorded.";
  }

  return context.items.map((item) => `[${item.kind}] ${item.text}`).join("\n");
}

export function createExecutorTaskSpec(input: {
  runId: string;
  spec: TaskSpec;
  context: Context;
  subtask: Subtask;
  worktreeEnabled: boolean;
}): ExecutorTaskSpec {
  return {
    runId: input.runId,
    subtaskId: input.subtask.id,
    taskSpecSummary: summarizeTaskSpec(input.spec),
    boundedGoal: input.subtask.description ?? input.subtask.title,
    nonGoals: [
      "Do not mutate orchestrator context directly.",
      "Do not mutate orchestrator graph directly.",
      "Do not process more than the assigned subtask.",
      "Do not commit, push, merge, release, or transition external tickets."
    ],
    contextSummary: summarizeContext(input.context),
    permissionMode: input.spec.permissionMode,
    worktree: {
      enabled: input.worktreeEnabled,
      branchHint: createBranchHint(input.runId, input.subtask.id)
    }
  };
}

export function buildCodexCliCommand(task: ExecutorTaskSpec, codexBinary = "codex"): string[] {
  const prompt = [
    "You are an Executor in a role-split task orchestrator.",
    `Run ID: ${task.runId}`,
    `Subtask ID: ${task.subtaskId}`,
    `Permission mode: ${task.permissionMode}`,
    `Worktree enabled: ${task.worktree.enabled}`,
    `Branch hint: ${task.worktree.branchHint}`,
    "",
    "Task spec:",
    task.taskSpecSummary,
    "",
    "Bounded goal:",
    task.boundedGoal,
    "",
    "Non-goals:",
    task.nonGoals.map((nonGoal) => `- ${nonGoal}`).join("\n"),
    "",
    "Context:",
    task.contextSummary,
    "",
    "Return a concise RoleReport-style summary and context_delta only."
  ].join("\n");

  return [codexBinary, "exec", "--json", "--", prompt];
}

export class CodexCliExecutor implements ExecutorProvider {
  private readonly codexBinary: string;
  private readonly allowExecution: boolean;
  private readonly mode: Extract<ExecutorMode, "codex-cli-dry-run" | "codex-cli">;

  constructor(options: CodexCliExecutorOptions) {
    this.mode = options.mode;
    this.codexBinary = options.codexBinary ?? "codex";
    this.allowExecution = options.allowExecution ?? false;
  }

  async execute(input: ExecutorProviderInput): Promise<RoleReport> {
    const command = buildCodexCliCommand(input.task, this.codexBinary);

    if (this.mode === "codex-cli" && !this.allowExecution) {
      return {
        role: "executor",
        status: "blocked",
        subtaskId: input.subtask.id,
        summary: "Codex CLI execution is disabled; use codex-cli-dry-run or explicitly enable execution later.",
        contextDelta: createContextDeltaItem(
          "blocked",
          `Codex CLI execution blocked before running command: ${command.join(" ")}`,
          "executor"
        ),
        data: {
          executorMode: this.mode,
          command,
          dryRun: false
        }
      };
    }

    return {
      role: "executor",
      status: "ok",
      subtaskId: input.subtask.id,
      summary: `Dry-run Codex CLI command prepared for ${input.subtask.title}.`,
      contextDelta: createContextDeltaItem("completed", `Dry-run command: ${command.join(" ")}`, "executor"),
      data: {
        executorMode: this.mode,
        command,
        dryRun: true,
        worktree: input.task.worktree
      }
    };
  }
}

function createBranchHint(runId: string, subtaskId: string): string {
  const compactRunId = runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  const compactSubtaskId = subtaskId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return `orchestrator/${compactRunId}-${compactSubtaskId}`.toLowerCase();
}

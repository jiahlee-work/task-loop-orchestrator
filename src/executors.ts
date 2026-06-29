import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { Context, ExecutorMode, ExecutorTaskSpec, RoleReport, Subtask, TaskSpec } from "./domain.js";
import { createContextDeltaItem } from "./context.js";
import { runCommand, type CommandRunner } from "./providers.js";
import type { ExecutorProvider, ExecutorProviderInput } from "./roles.js";

export interface CodexCliExecutorOptions {
  mode: Extract<ExecutorMode, "codex-cli-dry-run" | "codex-cli">;
  codexBinary?: string;
  allowExecution?: boolean;
  rootDir?: string;
  workspaceRoot?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  model?: string;
  runner?: CommandRunner;
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

export function buildCodexCliCommand(
  task: ExecutorTaskSpec,
  options:
    | string
    | {
        codexBinary?: string;
        cwd?: string;
        sandbox?: "read-only" | "workspace-write" | "danger-full-access";
        model?: string;
      } = {}
): string[] {
  const normalizedOptions = typeof options === "string" ? { codexBinary: options } : options;
  const codexBinary = normalizedOptions.codexBinary ?? "codex";
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

  return [
    codexBinary,
    "exec",
    "--json",
    "--sandbox",
    normalizedOptions.sandbox ?? "workspace-write",
    "--ask-for-approval",
    "never",
    "--skip-git-repo-check",
    ...(normalizedOptions.cwd ? ["--cd", normalizedOptions.cwd] : []),
    ...(normalizedOptions.model ? ["--model", normalizedOptions.model] : []),
    "--",
    prompt
  ];
}

export class CodexCliExecutor implements ExecutorProvider {
  private readonly codexBinary: string;
  private readonly allowExecution: boolean;
  private readonly mode: Extract<ExecutorMode, "codex-cli-dry-run" | "codex-cli">;
  private readonly rootDir: string;
  private readonly workspaceRoot: string;
  private readonly sandbox: "read-only" | "workspace-write" | "danger-full-access";
  private readonly model: string | undefined;
  private readonly runner: CommandRunner;

  constructor(options: CodexCliExecutorOptions) {
    this.mode = options.mode;
    this.codexBinary = options.codexBinary ?? "codex";
    this.allowExecution = options.allowExecution ?? false;
    this.rootDir = options.rootDir ?? process.cwd();
    this.workspaceRoot = options.workspaceRoot ?? ".orchestrator/dev-workspaces";
    this.sandbox = options.sandbox ?? "workspace-write";
    this.model = options.model;
    this.runner = options.runner ?? runCommand;
  }

  async execute(input: ExecutorProviderInput): Promise<RoleReport> {
    const workspace = resolveWorkspace(this.rootDir, this.workspaceRoot, input.runId, input.subtask.id);
    const command = buildCodexCliCommand(input.task, {
      codexBinary: this.codexBinary,
      cwd: workspace,
      sandbox: this.sandbox,
      model: this.model
    });

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

    if (this.mode === "codex-cli") {
      await mkdir(workspace, { recursive: true });
      const [binary, ...args] = command;
      const result = await this.runner(binary ?? this.codexBinary, args, workspace);
      if (result.exitCode !== 0) {
        return {
          role: "executor",
          status: "failed",
          subtaskId: input.subtask.id,
          summary: `Codex CLI failed for ${input.subtask.title}.`,
          contextDelta: createContextDeltaItem("blocked", `Codex CLI failed in ${workspace}.`, "executor"),
          data: {
            executorMode: this.mode,
            command,
            workspace,
            dryRun: false,
            exitCode: result.exitCode,
            stderr: truncate(result.stderr.trim(), 1000),
            stdout: truncate(result.stdout.trim(), 1000)
          }
        };
      }

      return {
        role: "executor",
        status: "ok",
        subtaskId: input.subtask.id,
        summary: `Codex CLI completed ${input.subtask.title}.`,
        contextDelta: createContextDeltaItem("completed", `Codex CLI completed ${input.subtask.id} in ${workspace}.`, "executor"),
        data: {
          executorMode: this.mode,
          command,
          workspace,
          dryRun: false,
          stdout: truncate(result.stdout.trim(), 2000),
          stderr: truncate(result.stderr.trim(), 1000),
          worktree: input.task.worktree
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
        workspace,
        dryRun: true,
        worktree: input.task.worktree
      }
    };
  }
}

function resolveWorkspace(rootDir: string, workspaceRoot: string, runId: string, subtaskId: string): string {
  const base = isAbsolute(workspaceRoot) ? workspaceRoot : join(rootDir, workspaceRoot);
  return resolve(base, sanitizePathPart(runId), sanitizePathPart(subtaskId));
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "workspace";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function createBranchHint(runId: string, subtaskId: string): string {
  const compactRunId = runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  const compactSubtaskId = subtaskId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return `orchestrator/${compactRunId}-${compactSubtaskId}`.toLowerCase();
}

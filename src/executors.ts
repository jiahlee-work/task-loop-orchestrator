import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Context, ExecutorMode, ExecutorTaskSpec, RoleReport, Subtask, TaskSpec } from "./domain.js";
import { createContextDeltaItem } from "./context.js";
import { runCommand, type CommandRunner } from "./providers.js";
import type { RootContractArtifact } from "./run-state.js";
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
  rootContract?: RootContractArtifact;
  worktreeEnabled: boolean;
}): ExecutorTaskSpec {
  const rootContract = input.rootContract ?? fallbackRootContract(input.runId, input.spec);
  return {
    runId: input.runId,
    subtaskId: input.subtask.id,
    rootContract: {
      goal: rootContract.goal,
      description: rootContract.description,
      nonGoals: [...rootContract.nonGoals],
      mustFollow: [...rootContract.mustFollow],
      acceptanceCriteria: [...rootContract.acceptanceCriteria],
      contextGuard: [...rootContract.contextGuard],
      repoConstraints: [...rootContract.repoConstraints],
      userDecisions: [...rootContract.userDecisions]
    },
    assignedTask: {
      id: input.subtask.id,
      title: input.subtask.title,
      description: input.subtask.description,
      dependsOn: [...input.subtask.dependsOn]
    },
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
    "Only use the approved root contract and the assigned task below.",
    "Do not infer extra scope from the full run history.",
    `Run ID: ${task.runId}`,
    `Subtask ID: ${task.subtaskId}`,
    `Permission mode: ${task.permissionMode}`,
    `Worktree enabled: ${task.worktree.enabled}`,
    `Branch hint: ${task.worktree.branchHint}`,
    "Execution workspace: a Git worktree copy of the target repository.",
    "",
    "Approved root contract:",
    formatRootContract(task.rootContract),
    "",
    "Assigned task:",
    formatAssignedTask(task.assignedTask),
    "",
    "Non-goals:",
    uniqueStrings([...task.rootContract.nonGoals, ...task.nonGoals]).map((nonGoal) => `- ${nonGoal}`).join("\n"),
    "",
    "Context guard:",
    listOrNone(task.rootContract.contextGuard),
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
      const worktreeCommand = ["worktree", "add", "--detach", workspace, "HEAD"];
      await mkdir(dirname(workspace), { recursive: true });
      const worktreeResult = await this.runner("git", worktreeCommand, this.rootDir);
      if (worktreeResult.exitCode !== 0) {
        return {
          role: "executor",
          status: "failed",
          subtaskId: input.subtask.id,
          summary: `Failed to prepare Codex worktree for ${input.subtask.title}.`,
          contextDelta: createContextDeltaItem("blocked", `Git worktree setup failed for ${workspace}.`, "executor"),
          data: {
            executorMode: this.mode,
            workspace,
            dryRun: false,
            prepareCommand: ["git", ...worktreeCommand],
            exitCode: worktreeResult.exitCode,
            stderr: truncate(worktreeResult.stderr.trim(), 1000),
            stdout: truncate(worktreeResult.stdout.trim(), 1000)
          }
        };
      }

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

function fallbackRootContract(runId: string, spec: TaskSpec): RootContractArtifact {
  return {
    schemaVersion: 1,
    runId,
    taskId: spec.id,
    goal: spec.title,
    description: spec.description,
    nonGoals: [],
    mustFollow: [...spec.acceptanceCriteria],
    acceptanceCriteria: [...spec.acceptanceCriteria],
    contextGuard: [
      "Keep the assigned task aligned with the approved root goal.",
      "Do not expand into unrelated work.",
      "Stop and report when the assigned task conflicts with the root contract."
    ],
    repoConstraints: [
      "Do not create branches, commits, pushes, pull requests, tags, releases, or Jira transitions unless explicitly approved."
    ],
    userDecisions: [],
    permissionMode: spec.permissionMode,
    updatedAt: new Date(0).toISOString()
  };
}

function formatRootContract(contract: ExecutorTaskSpec["rootContract"]): string {
  return [
    `Goal: ${contract.goal}`,
    contract.description ? `Description: ${contract.description}` : undefined,
    `Must follow:\n${listOrNone(contract.mustFollow)}`,
    `Acceptance criteria:\n${listOrNone(contract.acceptanceCriteria)}`,
    `Repo constraints:\n${listOrNone(contract.repoConstraints)}`,
    contract.userDecisions.length > 0 ? `User decisions:\n${listOrNone(contract.userDecisions)}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

function formatAssignedTask(task: ExecutorTaskSpec["assignedTask"]): string {
  return [
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : undefined,
    `Depends on: ${task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none"}`
  ]
    .filter(Boolean)
    .join("\n");
}

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- none";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

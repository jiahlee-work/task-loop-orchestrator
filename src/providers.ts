import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitHubCheckStatus,
  GitHubCheckSummary,
  GitHubPullRequestSummary,
  GitHubRepositoryInfo
} from "./domain.js";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args?: string[], cwd?: string) => Promise<CommandResult>;

export interface RepoSnapshot {
  status: string;
  diff?: string;
}

export interface RepoProvider {
  getStatus(): Promise<string>;
  getDiff(): Promise<string>;
  runCommand(command: string, args?: string[]): Promise<CommandResult>;
  prepareWorktree?(input: { branchHint: string; dryRun: boolean }): Promise<{ command: string[]; dryRun: boolean }>;
}

export interface GitHubProvider {
  getRepositoryInfo(): Promise<GitHubRepositoryInfo | undefined>;
  listPullRequests(): Promise<GitHubPullRequestSummary[]>;
  getCheckStatus(ref?: string): Promise<GitHubCheckSummary>;
}

export interface JiraProvider {
  getIssue?(key: string): Promise<unknown>;
  transitionIssue?(input: { key: string; transition: string }): Promise<unknown>;
}

export interface ToolProviders {
  repo: RepoProvider;
  github?: GitHubProvider;
  jira?: JiraProvider;
}

export class NoopRepoProvider implements RepoProvider {
  async getStatus(): Promise<string> {
    return "repo provider not configured";
  }

  async getDiff(): Promise<string> {
    return "";
  }

  async runCommand(): Promise<CommandResult> {
    return {
      exitCode: 0,
      stdout: "",
      stderr: ""
    };
  }
}

export class MockRepoProvider implements RepoProvider {
  constructor(private readonly snapshot: RepoSnapshot = { status: "mock repo status: clean", diff: "" }) {}

  async getStatus(): Promise<string> {
    return this.snapshot.status;
  }

  async getDiff(): Promise<string> {
    return this.snapshot.diff ?? "";
  }

  async runCommand(command: string, args: string[] = []): Promise<CommandResult> {
    return {
      exitCode: 0,
      stdout: `mock command: ${[command, ...args].join(" ")}`,
      stderr: ""
    };
  }

  async prepareWorktree(input: { branchHint: string; dryRun: boolean }): Promise<{ command: string[]; dryRun: boolean }> {
    return {
      command: ["git", "worktree", "add", "-b", input.branchHint, `.worktrees/${input.branchHint}`],
      dryRun: input.dryRun
    };
  }
}

export class GitRepoProvider implements RepoProvider {
  constructor(
    private readonly rootDir: string = process.cwd(),
    private readonly runner: CommandRunner = runCommand
  ) {}

  async getStatus(): Promise<string> {
    const result = await this.runGit(["status", "--short"]);
    return result.stdout.trim();
  }

  async getDiff(): Promise<string> {
    const headDiff = await this.runGit(["diff", "--stat", "HEAD"]);
    if (headDiff.exitCode === 0) {
      return headDiff.stdout.trim();
    }

    const fallbackDiff = await this.runGit(["diff", "--stat"]);
    return fallbackDiff.stdout.trim();
  }

  async runCommand(command: string, args: string[] = []): Promise<CommandResult> {
    return this.runner(command, args, this.rootDir);
  }

  async prepareWorktree(input: { branchHint: string; dryRun: boolean }): Promise<{ command: string[]; dryRun: boolean }> {
    const command = ["git", "worktree", "add", "-b", input.branchHint, `.worktrees/${input.branchHint}`];
    return {
      command,
      dryRun: input.dryRun
    };
  }

  private async runGit(args: string[]): Promise<CommandResult> {
    return this.runCommand("git", args);
  }
}

export class GitHubCliProvider implements GitHubProvider {
  constructor(
    private readonly rootDir: string = process.cwd(),
    private readonly runner: CommandRunner = runCommand,
    private readonly ghBinary: string = "gh"
  ) {}

  async getRepositoryInfo(): Promise<GitHubRepositoryInfo | undefined> {
    const result = await this.runGh(["repo", "view", "--json", "name,owner,url,defaultBranchRef"]);
    if (result.exitCode !== 0) {
      return undefined;
    }

    const parsed = parseJson(result.stdout);
    if (!isRecord(parsed)) {
      return undefined;
    }

    const owner = isRecord(parsed.owner) && typeof parsed.owner.login === "string" ? parsed.owner.login : "unknown";
    const defaultBranch =
      isRecord(parsed.defaultBranchRef) && typeof parsed.defaultBranchRef.name === "string"
        ? parsed.defaultBranchRef.name
        : "unknown";

    return {
      name: typeof parsed.name === "string" ? parsed.name : "unknown",
      owner,
      url: typeof parsed.url === "string" ? parsed.url : "",
      defaultBranch
    };
  }

  async listPullRequests(): Promise<GitHubPullRequestSummary[]> {
    const result = await this.runGh([
      "pr",
      "list",
      "--json",
      "number,title,state,headRefName,baseRefName,url,isDraft"
    ]);
    if (result.exitCode !== 0) {
      return [];
    }

    const parsed = parseJson(result.stdout);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRecord).map((item) => ({
      number: typeof item.number === "number" ? item.number : 0,
      title: typeof item.title === "string" ? item.title : "",
      state: typeof item.state === "string" ? item.state : "unknown",
      headRefName: typeof item.headRefName === "string" ? item.headRefName : "",
      baseRefName: typeof item.baseRefName === "string" ? item.baseRefName : "",
      url: typeof item.url === "string" ? item.url : "",
      isDraft: typeof item.isDraft === "boolean" ? item.isDraft : false
    }));
  }

  async getCheckStatus(ref?: string): Promise<GitHubCheckSummary> {
    const target = ref ?? "HEAD";
    const result = await this.runGh(["pr", "checks", target, "--json", "name,state,bucket,description,workflow"]);
    if (result.exitCode !== 0) {
      return {
        status: classifyGhFailure(result.stderr),
        summary: result.stderr.trim() || `Unable to read GitHub checks for ${target}.`,
        ref: target,
        source: "github"
      };
    }

    const parsed = parseJson(result.stdout);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        status: "not_found",
        summary: `No GitHub checks found for ${target}.`,
        ref: target,
        source: "github",
        details: []
      };
    }

    const details = parsed.filter(isRecord).map((item) => ({
      name: typeof item.name === "string" ? item.name : typeof item.workflow === "string" ? item.workflow : "unknown",
      status: normalizeCheckStatus(item.state, item.bucket),
      summary: typeof item.description === "string" ? item.description : undefined
    }));
    const status = aggregateCheckStatus(details.map((detail) => detail.status));

    return {
      status,
      summary: summarizeCheckStatus(status, details.length),
      ref: target,
      source: "github",
      details
    };
  }

  private runGh(args: string[]): Promise<CommandResult> {
    return this.runner(this.ghBinary, args, this.rootDir);
  }
}

export function createMockToolProviders(): ToolProviders {
  return {
    repo: new MockRepoProvider()
  };
}

export function createGitToolProviders(rootDir: string = process.cwd(), github?: GitHubProvider): ToolProviders {
  return {
    repo: new GitRepoProvider(rootDir),
    ...(github ? { github } : {})
  };
}

export async function runCommand(command: string, args: string[] = [], cwd: string = process.cwd()): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    return {
      exitCode: 0,
      stdout,
      stderr
    };
  } catch (error) {
    return commandErrorToResult(error);
  }
}

function commandErrorToResult(error: unknown): CommandResult {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { code?: number | string; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      exitCode: typeof maybeError.code === "number" ? maybeError.code : 1,
      stdout: typeof maybeError.stdout === "string" ? maybeError.stdout : maybeError.stdout?.toString() ?? "",
      stderr: typeof maybeError.stderr === "string" ? maybeError.stderr : maybeError.stderr?.toString() ?? ""
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: String(error)
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function classifyGhFailure(stderr: string): GitHubCheckStatus {
  const normalized = stderr.toLowerCase();
  if (
    normalized.includes("command not found") ||
    normalized.includes("authentication") ||
    normalized.includes("not logged") ||
    normalized.includes("could not resolve")
  ) {
    return "unknown";
  }

  if (normalized.includes("not found") || normalized.includes("no pull requests")) {
    return "not_found";
  }

  return "unknown";
}

function normalizeCheckStatus(state: unknown, bucket: unknown): GitHubCheckStatus {
  const value = `${typeof state === "string" ? state : ""} ${typeof bucket === "string" ? bucket : ""}`.toLowerCase();
  if (value.includes("pass") || value.includes("success")) {
    return "success";
  }

  if (value.includes("fail") || value.includes("cancel")) {
    return "failure";
  }

  if (value.includes("error")) {
    return "error";
  }

  if (value.includes("pending") || value.includes("progress") || value.includes("queued") || value.includes("waiting")) {
    return "pending";
  }

  return "unknown";
}

function aggregateCheckStatus(statuses: GitHubCheckStatus[]): GitHubCheckStatus {
  if (statuses.some((status) => status === "error")) {
    return "error";
  }

  if (statuses.some((status) => status === "failure")) {
    return "failure";
  }

  if (statuses.some((status) => status === "pending")) {
    return "pending";
  }

  if (statuses.length > 0 && statuses.every((status) => status === "success")) {
    return "success";
  }

  return "unknown";
}

function summarizeCheckStatus(status: GitHubCheckStatus, count: number): string {
  return `GitHub checks ${status} (${count} check${count === 1 ? "" : "s"}).`;
}

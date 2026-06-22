import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RepoSnapshot {
  status: string;
  diff?: string;
}

export interface RepoProvider {
  getStatus(): Promise<string>;
  getDiff(): Promise<string>;
  runCommand(command: string, args?: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  prepareWorktree?(input: { branchHint: string; dryRun: boolean }): Promise<{ command: string[]; dryRun: boolean }>;
}

export interface GitHubProvider {
  getPullRequest?(id: string): Promise<unknown>;
  createPullRequest?(input: { title: string; body: string; branch: string }): Promise<unknown>;
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

  async runCommand(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

  async runCommand(command: string, args: string[] = []): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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
  constructor(private readonly rootDir: string = process.cwd()) {}

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

  async runCommand(command: string, args: string[] = []): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: this.rootDir,
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

  async prepareWorktree(input: { branchHint: string; dryRun: boolean }): Promise<{ command: string[]; dryRun: boolean }> {
    const command = ["git", "worktree", "add", "-b", input.branchHint, `.worktrees/${input.branchHint}`];
    return {
      command,
      dryRun: input.dryRun
    };
  }

  private async runGit(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.runCommand("git", args);
  }
}

export function createMockToolProviders(): ToolProviders {
  return {
    repo: new MockRepoProvider()
  };
}

export function createGitToolProviders(rootDir: string = process.cwd()): ToolProviders {
  return {
    repo: new GitRepoProvider(rootDir)
  };
}

function commandErrorToResult(error: unknown): { exitCode: number; stdout: string; stderr: string } {
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

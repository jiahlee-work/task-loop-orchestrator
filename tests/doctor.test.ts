import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkNodeVersion, initProject, runDoctor, type DoctorCheck } from "../src/index.js";
import type { CommandRunner, GitHubProvider } from "../src/providers.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("doctor", () => {
  it("warns when the current directory is not a git repository and config is missing", async () => {
    const root = await tempRoot();

    const report = await runDoctor(root);

    expect(report.status).toBe("warn");
    expect(check(report.checks, "git_repository")).toMatchObject({
      status: "warn",
      recommendedAction: "Run doctor from a Git repository, or initialize one with git init.",
      suggestions: [
        {
          label: "Initialize Git repository",
          command: ["git", "init"],
          reason: "Create a local Git repository.",
          destructive: false
        }
      ]
    });
    expect(check(report.checks, "config")).toMatchObject({
      status: "warn",
      recommendedAction: "Run task-loop-orchestrator init.",
      suggestions: [
        {
          label: "Initialize orchestrator project",
          command: ["task-loop-orchestrator", "init"],
          reason: "Create orchestrator config and ignore local state.",
          destructive: false
        }
      ]
    });
    expect(check(report.checks, "gitignore")).toMatchObject({
      status: "warn",
      recommendedAction: "Run task-loop-orchestrator init.",
      suggestions: [
        {
          label: "Initialize orchestrator project",
          command: ["task-loop-orchestrator", "init"],
          reason: "Create .gitignore and add .orchestrator/.",
          destructive: false
        }
      ]
    });
    expect(check(report.checks, "store_path")).toMatchObject({
      status: "pass",
      summary: ".orchestrator directory is not created yet, and the project root is writable."
    });
    expect(check(report.checks, "github")).toMatchObject({
      status: "pass",
      recommendedAction: "Run doctor with --github gh-cli to check read-only GitHub access.",
      suggestions: [
        {
          label: "Check GitHub read access",
          command: ["task-loop-orchestrator", "doctor", "--github", "gh-cli"],
          reason: "Re-run doctor with read-only GitHub diagnostics enabled.",
          destructive: false
        }
      ]
    });
  });

  it("passes config and gitignore checks after init in a git repository", async () => {
    const root = await tempRoot();
    await execFileAsync("git", ["init"], { cwd: root });
    await initProject(root);

    const report = await runDoctor(root);

    expect(check(report.checks, "git_repository").status).toBe("pass");
    expect(check(report.checks, "config").status).toBe("pass");
    expect(check(report.checks, "gitignore").status).toBe("pass");
    expect(check(report.checks, "store_path").status).toBe("pass");
    expect(check(report.checks, "git_repository").suggestions).toBeUndefined();
    expect(check(report.checks, "config").suggestions).toBeUndefined();
    expect(check(report.checks, "gitignore").suggestions).toBeUndefined();
  });

  it("checks Node.js version without depending on the current process version", () => {
    expect(checkNodeVersion("24.0.0")).toMatchObject({ status: "pass" });
    expect(checkNodeVersion("23.9.0")).toMatchObject({
      status: "fail",
      recommendedAction: "Install Node.js 24 or newer."
    });
  });

  it("reports GitHub gh-cli diagnostics as pass when read-only checks resolve", async () => {
    const root = await tempRoot();
    const githubProvider = mockGitHubProvider({
      repository: {
        name: "task-loop-orchestrator",
        owner: "jiahlee-work",
        url: "https://github.com/jiahlee-work/task-loop-orchestrator",
        defaultBranch: "main"
      },
      checks: {
        status: "success",
        summary: "GitHub checks success (1 check).",
        ref: "HEAD",
        source: "github",
        details: [{ name: "verify", status: "success", summary: "success" }]
      }
    });

    const report = await runDoctor(root, { githubMode: "gh-cli", githubProvider });

    expect(check(report.checks, "github_repository")).toMatchObject({ status: "pass" });
    expect(check(report.checks, "github_checks")).toMatchObject({ status: "pass" });
  });

  it("reports GitHub gh-cli failures as warnings", async () => {
    const root = await tempRoot();
    const githubProvider = mockGitHubProvider({
      repository: undefined,
      checks: {
        status: "unknown",
        summary: "gh is not authenticated",
        ref: "HEAD",
        source: "github"
      }
    });

    const report = await runDoctor(root, { githubMode: "gh-cli", githubProvider });

    expect(report.status).toBe("warn");
    expect(check(report.checks, "github_repository")).toMatchObject({ status: "warn" });
    expect(check(report.checks, "github_checks")).toMatchObject({
      status: "warn",
      recommendedAction: "Confirm gh authentication and repository check availability.",
      suggestions: expect.arrayContaining([
        {
          label: "Check GitHub CLI auth",
          command: ["gh", "auth", "status"],
          reason: "Inspect local gh authentication state.",
          destructive: false
        }
      ])
    });
  });

  it("reports missing Jira CLI only when Jira diagnostics are enabled", async () => {
    const root = await tempRoot();
    const calls: Array<{ command: string; args: string[] }> = [];
    const commandRunner: CommandRunner = async (command, args = []) => {
      calls.push({ command, args });
      if (command === "jira") {
        return { exitCode: 1, stdout: "", stderr: "jira: command not found" };
      }

      if (command === "git") {
        return { exitCode: 0, stdout: "true\n", stderr: "" };
      }

      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const defaultReport = await runDoctor(root, { commandRunner });
    expect(defaultReport.checks.some((item) => item.id === "jira_cli")).toBe(false);
    expect(calls.some((call) => call.command === "jira")).toBe(false);

    const jiraReport = await runDoctor(root, { commandRunner, jira: true });

    expect(jiraReport.status).toBe("warn");
    expect(check(jiraReport.checks, "jira_cli")).toMatchObject({
      status: "warn",
      recommendedAction: "Install and authenticate the Jira CLI before using run --jira.",
      suggestions: [
        {
          label: "Install Jira CLI with Homebrew",
          command: ["brew", "install", "jira-cli"],
          reason: "Install the jira command on macOS.",
          destructive: false
        },
        {
          label: "Initialize Jira CLI auth",
          command: ["jira", "init"],
          reason: "Configure the Jira site and credentials.",
          destructive: false
        }
      ]
    });
    expect(calls.map((call) => [call.command, ...call.args])).toContainEqual(["jira", "version"]);
  });

  it("shows doctor in CLI usage", async () => {
    const cliSource = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(cliSource).toContain("task-loop-orchestrator doctor [--github none|gh-cli] [--jira] [--json]");
  });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-doctor-"));
  tempDirs.push(dir);
  return dir;
}

function check(checks: DoctorCheck[], id: string): DoctorCheck {
  const result = checks.find((item) => item.id === id);
  if (!result) {
    throw new Error(`Missing doctor check ${id}.`);
  }

  return result;
}

function mockGitHubProvider(input: {
  repository: Awaited<ReturnType<GitHubProvider["getRepositoryInfo"]>>;
  checks: Awaited<ReturnType<GitHubProvider["getCheckStatus"]>>;
}): GitHubProvider {
  return {
    async getRepositoryInfo() {
      return input.repository;
    },
    async listPullRequests() {
      return [];
    },
    async getCheckStatus() {
      return input.checks;
    }
  };
}

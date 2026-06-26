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
      recommendedAction: "Run tlo init.",
      suggestions: [
        {
          label: "Initialize orchestrator project",
          command: ["tlo", "init"],
          reason: "Create orchestrator config and ignore local state.",
          destructive: false
        }
      ]
    });
    expect(check(report.checks, "gitignore")).toMatchObject({
      status: "warn",
      recommendedAction: "Run tlo init.",
      suggestions: [
        {
          label: "Initialize orchestrator project",
          command: ["tlo", "init"],
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
          command: ["tlo", "doctor", "--github", "gh-cli"],
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

  it("reports missing Jira MCP and CLI fallback only when Jira diagnostics are enabled", async () => {
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
    expect(defaultReport.checks.some((item) => item.id.startsWith("jira_mcp"))).toBe(false);
    expect(calls.some((call) => call.command === "jira")).toBe(false);

    const jiraReport = await runDoctor(root, {
      commandRunner,
      jira: true,
      jiraMcpSessionFactory: async () => {
        throw new Error("mcp unavailable");
      }
    });

    expect(jiraReport.status).toBe("warn");
    expect(check(jiraReport.checks, "jira_mcp_credentials")).toMatchObject({
      status: "warn",
      recommendedAction: "Run tlo setup jira to save local Jira MCP credentials.",
      suggestions: [
        {
          label: "Set up Jira MCP",
          command: ["tlo", "setup", "jira"],
          reason: "Save local Jira MCP credentials in .orchestrator/jira.env.",
          destructive: false
        }
      ]
    });
    expect(check(jiraReport.checks, "jira_cli_fallback")).toMatchObject({
      status: "warn",
      recommendedAction: "Install and authenticate the Jira CLI before using tlo run ISSUE-KEY.",
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
    expect(calls.some((call) => call.command === "uvx")).toBe(false);
  });

  it("reports missing uvx before trying to start the Jira MCP server", async () => {
    const root = await tempRoot();
    let sessionStarted = false;

    const report = await runDoctor(root, {
      commandRunner: async (command) => {
        if (command === "git") {
          return { exitCode: 0, stdout: "true\n", stderr: "" };
        }
        if (command === "uvx") {
          return { exitCode: 1, stdout: "", stderr: "uvx: command not found" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      jira: true,
      jiraConfig: jiraMcpConfig(),
      jiraMcpSessionFactory: async () => {
        sessionStarted = true;
        throw new Error("should not start");
      }
    });

    expect(check(report.checks, "jira_mcp_credentials")).toMatchObject({ status: "pass" });
    expect(check(report.checks, "jira_mcp_command")).toMatchObject({
      status: "warn",
      recommendedAction: "Install uv so the uvx command is available.",
      suggestions: [
        {
          label: "Install uv with Homebrew",
          command: ["brew", "install", "uv"],
          reason: "Install uvx for running mcp-atlassian.",
          destructive: false
        }
      ]
    });
    expect(sessionStarted).toBe(false);
  });

  it("reports Jira MCP server startup failures separately from missing tools", async () => {
    const root = await tempRoot();

    const report = await runDoctor(root, {
      commandRunner: async (command) =>
        command === "git" || command === "uvx"
          ? { exitCode: 0, stdout: "ok\n", stderr: "" }
          : { exitCode: 0, stdout: "", stderr: "" },
      jira: true,
      jiraConfig: jiraMcpConfig(),
      jiraMcpSessionFactory: async () => {
        throw new Error("server failed");
      }
    });

    expect(check(report.checks, "jira_mcp_command")).toMatchObject({ status: "pass" });
    expect(check(report.checks, "jira_mcp_server")).toMatchObject({
      status: "warn",
      recommendedAction: "Check that uvx and mcp-atlassian can start, and confirm Jira credentials are valid."
    });
    expect(report.checks.some((item) => item.id === "jira_mcp_tool")).toBe(false);
  });

  it("reports a missing jira_get_issue tool after the MCP server starts", async () => {
    const root = await tempRoot();

    const report = await runDoctor(root, {
      commandRunner: async (command) =>
        command === "git" || command === "uvx"
          ? { exitCode: 0, stdout: "ok\n", stderr: "" }
          : { exitCode: 0, stdout: "", stderr: "" },
      jira: true,
      jiraConfig: jiraMcpConfig(),
      jiraMcpSessionFactory: async () => ({
        async listTools() {
          return { tools: [{ name: "jira_search" }] };
        },
        async callTool() {
          return { content: [] };
        },
        async close() {}
      })
    });

    expect(check(report.checks, "jira_mcp_server")).toMatchObject({ status: "pass" });
    expect(check(report.checks, "jira_mcp_tool")).toMatchObject({
      status: "warn",
      recommendedAction: "Confirm the mcp-atlassian version and Jira tool configuration."
    });
  });

  it("passes Jira MCP diagnostics when the issue read tool is available", async () => {
    const root = await tempRoot();

    const report = await runDoctor(root, {
      commandRunner: async (command) =>
        command === "git" || command === "uvx"
          ? { exitCode: 0, stdout: "true\n", stderr: "" }
          : { exitCode: 0, stdout: "", stderr: "" },
      jira: true,
      jiraConfig: jiraMcpConfig(),
      jiraMcpSessionFactory: async () => ({
        async listTools() {
          return { tools: [{ name: "jira_get_issue" }] };
        },
        async callTool() {
          return { content: [] };
        },
        async close() {}
      })
    });

    expect(check(report.checks, "jira_mcp_credentials")).toMatchObject({ status: "pass" });
    expect(check(report.checks, "jira_mcp_command")).toMatchObject({ status: "pass" });
    expect(check(report.checks, "jira_mcp_server")).toMatchObject({ status: "pass" });
    expect(check(report.checks, "jira_mcp_tool")).toMatchObject({ status: "pass" });
    expect(report.checks.some((item) => item.id === "jira_cli_fallback")).toBe(false);
  });

  it("shows doctor in CLI usage", async () => {
    const cliSource = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(cliSource).toContain("task-loop-orchestrator doctor [jira] [--github none|gh-cli] [--json]");
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

function jiraMcpConfig() {
  return {
    provider: "mcp-atlassian" as const,
    fallback: "cli" as const,
    mcp: {
      command: "uvx",
      args: ["mcp-atlassian"],
      toolName: "jira_get_issue",
      issueKeyArgument: "issue_key",
      env: {
        JIRA_URL: "https://jira.example.com",
        JIRA_USERNAME: "bot@example.com",
        JIRA_API_TOKEN: "token"
      }
    }
  };
}

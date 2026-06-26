import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTaskSpecFromJiraIssue,
  GitHubCliProvider,
  GitRepoProvider,
  JiraCliProvider,
  JiraMcpProvider,
  type CommandRunner
} from "../src/providers.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-git-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GitRepoProvider", () => {
  it("reads git status from an isolated temp repository", async () => {
    const root = await tempRoot();
    await execFileAsync("git", ["init"], { cwd: root });
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");

    const provider = new GitRepoProvider(root);

    await expect(provider.getStatus()).resolves.toContain("?? note.txt");
  });

  it("handles git diff stat without relying on the caller repository", async () => {
    const root = await tempRoot();
    await execFileAsync("git", ["init"], { cwd: root });

    const provider = new GitRepoProvider(root);

    await expect(provider.getDiff()).resolves.toBe("");
  });
});

describe("GitHubCliProvider", () => {
  it("reads repository info and pull requests with read-only gh commands", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner: CommandRunner = async (command, args = [], cwd) => {
      calls.push({ command, args, cwd });
      if (args[0] === "repo") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            name: "task-loop-orchestrator",
            owner: { login: "jiahlee-work" },
            url: "https://github.com/jiahlee-work/task-loop-orchestrator",
            defaultBranchRef: { name: "main" }
          }),
          stderr: ""
        };
      }

      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            number: 7,
            title: "Read-only checkpoint",
            state: "OPEN",
            headRefName: "feature/checkpoint",
            baseRefName: "main",
            url: "https://github.com/example/pr/7",
            isDraft: true
          }
        ]),
        stderr: ""
      };
    };
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getRepositoryInfo()).resolves.toEqual({
      name: "task-loop-orchestrator",
      owner: "jiahlee-work",
      url: "https://github.com/jiahlee-work/task-loop-orchestrator",
      defaultBranch: "main"
    });
    await expect(provider.listPullRequests()).resolves.toEqual([
      {
        number: 7,
        title: "Read-only checkpoint",
        state: "OPEN",
        headRefName: "feature/checkpoint",
        baseRefName: "main",
        url: "https://github.com/example/pr/7",
        isDraft: true
      }
    ]);
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ["gh", "repo", "view", "--json", "name,owner,url,defaultBranchRef,nameWithOwner"],
      ["gh", "pr", "list", "--json", "number,title,state,headRefName,baseRefName,url,isDraft"]
    ]);
  });

  it("aggregates gh check JSON into a check summary", async () => {
    const runner: CommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify([
        { name: "typecheck", state: "SUCCESS", bucket: "pass", description: "ok" },
        { name: "test", state: "SUCCESS", bucket: "pass", description: "ok" }
      ]),
      stderr: ""
    });
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getCheckStatus("main")).resolves.toMatchObject({
      status: "success",
      summary: "GitHub checks success (2 checks).",
      ref: "main",
      source: "github"
    });
  });

  it("degrades gh missing or auth failure into unknown check status", async () => {
    const runner: CommandRunner = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "gh: command not found or not logged into any GitHub hosts"
    });
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getCheckStatus("main")).resolves.toMatchObject({
      status: "unknown",
      source: "github"
    });
  });

  it("falls back from PR checks to commit check-runs through gh api", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = async (command, args = []) => {
      calls.push([command, ...args]);
      if (args[0] === "pr" && args[1] === "checks") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "no pull requests found for branch \"main\""
        };
      }

      if (args[0] === "repo") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            nameWithOwner: "jiahlee-work/task-loop-orchestrator",
            defaultBranchRef: { name: "main" },
            url: "https://github.com/jiahlee-work/task-loop-orchestrator"
          }),
          stderr: ""
        };
      }

      return {
        exitCode: 0,
        stdout: JSON.stringify([
          { name: "CI / typecheck", status: "completed", conclusion: "success" },
          { name: "CI / test", status: "completed", conclusion: "success" }
        ]),
        stderr: ""
      };
    };
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getCheckStatus("main")).resolves.toMatchObject({
      status: "success",
      summary: "GitHub checks success (2 checks).",
      details: [
        { name: "CI / typecheck", status: "success", summary: "success" },
        { name: "CI / test", status: "success", summary: "success" }
      ]
    });
    expect(calls).toEqual([
      ["gh", "pr", "checks", "main", "--json", "name,state,bucket,description,workflow"],
      ["gh", "repo", "view", "--json", "name,owner,url,defaultBranchRef,nameWithOwner"],
      ["gh", "api", "repos/jiahlee-work/task-loop-orchestrator/commits/main/check-runs", "--jq", ".check_runs"]
    ]);
  });

  it("aggregates check-runs with failure and pending precedence", async () => {
    const runner: CommandRunner = async (_command, args = []) => {
      if (args[0] === "pr") {
        return { exitCode: 1, stdout: "", stderr: "no pull requests found" };
      }

      if (args[0] === "repo") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ name: "repo", owner: { login: "owner" }, defaultBranchRef: { name: "main" } }),
          stderr: ""
        };
      }

      return {
        exitCode: 0,
        stdout: JSON.stringify([
          { name: "CI / build", status: "completed", conclusion: "success" },
          { name: "CI / test", status: "completed", conclusion: "failure" },
          { name: "CI / deploy-preview", status: "queued", conclusion: null }
        ]),
        stderr: ""
      };
    };
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getCheckStatus("main")).resolves.toMatchObject({
      status: "failure",
      summary: "GitHub checks failure (3 checks)."
    });
  });

  it("degrades gh api auth failure into unknown check status", async () => {
    const runner: CommandRunner = async (_command, args = []) => {
      if (args[0] === "pr") {
        return { exitCode: 1, stdout: "", stderr: "no pull requests found" };
      }

      if (args[0] === "repo") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ nameWithOwner: "owner/repo", defaultBranchRef: { name: "main" } }),
          stderr: ""
        };
      }

      return {
        exitCode: 1,
        stdout: "",
        stderr: "HTTP 401: Requires authentication"
      };
    };
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getCheckStatus("main")).resolves.toMatchObject({
      status: "unknown",
      summary: "HTTP 401: Requires authentication",
      source: "github"
    });
  });
});

describe("JiraCliProvider", () => {
  it("reads a Jira issue through a read-only raw JSON command", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner: CommandRunner = async (command, args = [], cwd) => {
      calls.push({ command, args, cwd });
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          key: "ABC-123",
          self: "https://jira.example.com/rest/api/3/issue/ABC-123",
          fields: {
            summary: "Add billing export",
            description: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Users need a CSV export from billing." }]
                }
              ]
            },
            status: { name: "To Do" },
            issuetype: { name: "Story" },
            assignee: { displayName: "Jane Developer" },
            reporter: { displayName: "Product Owner" },
            labels: ["billing", "export"],
            acceptanceCriteria: "- Export includes invoice id\n- Export includes amount",
            comment: {
              comments: [
                {
                  author: { displayName: "Designer" },
                  body: {
                    content: [
                      {
                        content: [{ text: "Keep the button near the existing download action." }]
                      }
                    ]
                  },
                  created: "2026-06-25T00:00:00.000+0900"
                }
              ]
            }
          }
        }),
        stderr: ""
      };
    };
    const provider = new JiraCliProvider("/tmp/repo", runner);

    await expect(provider.getIssue("ABC-123")).resolves.toEqual({
      key: "ABC-123",
      title: "Add billing export",
      description: "Users need a CSV export from billing.",
      status: "To Do",
      issueType: "Story",
      url: "https://jira.example.com/rest/api/3/issue/ABC-123",
      assignee: "Jane Developer",
      reporter: "Product Owner",
      labels: ["billing", "export"],
      comments: [
        {
          author: "Designer",
          body: "Keep the button near the existing download action.",
          createdAt: "2026-06-25T00:00:00.000+0900"
        }
      ],
      acceptanceCriteria: ["Export includes invoice id", "Export includes amount"]
    });
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ["jira", "issue", "view", "ABC-123", "--raw"]
    ]);
  });

  it("degrades missing CLI or unreadable issue results to undefined", async () => {
    const provider = new JiraCliProvider("/tmp/repo", async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "jira: command not found"
    }));

    await expect(provider.getIssue("ABC-404")).resolves.toBeUndefined();
  });

  it("converts a Jira issue into a TaskSpec for planner input", () => {
    const spec = createTaskSpecFromJiraIssue(
      {
        key: "ABC-123",
        title: "Add billing export",
        description: "Users need a CSV export from billing.",
        status: "To Do",
        issueType: "Story",
        url: "https://jira.example.com/browse/ABC-123",
        labels: [],
        comments: [{ author: "Designer", body: "Keep the button near the existing download action." }],
        acceptanceCriteria: ["Export includes invoice id", "Export includes amount"]
      },
      "write",
      "Prefer a CSV-compatible filename."
    );

    expect(spec).toMatchObject({
      id: "ABC-123",
      title: "ABC-123: Add billing export",
      permissionMode: "write",
      acceptanceCriteria: ["Export includes invoice id", "Export includes amount"]
    });
    expect(spec.description).toContain("Jira: https://jira.example.com/browse/ABC-123");
    expect(spec.description).toContain("Status: To Do");
    expect(spec.description).toContain("Users need a CSV export from billing.");
    expect(spec.description).toContain("User note:\nPrefer a CSV-compatible filename.");
    expect(spec.description).toContain("Designer: Keep the button near the existing download action.");
  });
});

describe("JiraMcpProvider", () => {
  it("reads a Jira issue through an MCP jira_get_issue tool", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const provider = new JiraMcpProvider(
      {
        command: "uvx",
        args: ["mcp-atlassian"],
        toolName: "jira_get_issue",
        issueKeyArgument: "issue_key",
        env: {
          JIRA_URL: "https://jira.example.com",
          JIRA_USERNAME: "bot@example.com",
          JIRA_API_TOKEN: "token"
        }
      },
      "/tmp/repo",
      async () => ({
        async listTools() {
          return { tools: [{ name: "jira_get_issue" }] };
        },
        async callTool(name, args) {
          calls.push({ name, args });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  key: "ABC-123",
                  fields: {
                    summary: "Read Jira through MCP",
                    description: "MCP issue body.",
                    status: { name: "To Do" }
                  }
                })
              }
            ]
          };
        },
        async close() {}
      })
    );

    await expect(provider.hasIssueTool()).resolves.toBe(true);
    await expect(provider.getIssue("ABC-123")).resolves.toMatchObject({
      key: "ABC-123",
      title: "Read Jira through MCP",
      description: "MCP issue body.",
      status: "To Do"
    });
    expect(calls).toEqual([{ name: "jira_get_issue", args: { issue_key: "ABC-123" } }]);
  });
});

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultOrchestratorConfig } from "../src/config.js";
import { jiraEnvPath, loadJiraConfigWithLocalEnv, setupJiraMcp } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("jira setup", () => {
  it("writes local Jira MCP credentials with owner-only permissions", async () => {
    const root = await tempRoot();

    const report = await setupJiraMcp({
      rootDir: root,
      url: "https://jira.example.com",
      username: "user@example.com",
      apiToken: "secret-token",
      skipCheck: true
    });

    const path = jiraEnvPath(root);
    await expect(readFile(path, "utf8")).resolves.toBe(
      "JIRA_URL=https://jira.example.com\nJIRA_USERNAME=user@example.com\nJIRA_API_TOKEN=secret-token\n"
    );
    expect(report).toMatchObject({
      status: "saved",
      envFile: path,
      authMode: "cloud-api-token",
      mcpCheck: { status: "skipped" }
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("loads saved Jira env into the MCP config", async () => {
    const root = await tempRoot();
    await setupJiraMcp({
      rootDir: root,
      url: "https://jira.example.com",
      username: "user@example.com",
      apiToken: "secret-token",
      skipCheck: true
    });

    await expect(loadJiraConfigWithLocalEnv(root, defaultOrchestratorConfig.jira)).resolves.toMatchObject({
      mcp: {
        env: {
          JIRA_URL: "https://jira.example.com",
          JIRA_USERNAME: "user@example.com",
          JIRA_API_TOKEN: "secret-token"
        }
      }
    });
  });

  it("verifies the MCP issue tool when setup check is enabled", async () => {
    const root = await tempRoot();
    const report = await setupJiraMcp({
      rootDir: root,
      url: "https://jira.example.com",
      username: "user@example.com",
      apiToken: "secret-token",
      mcpSessionFactory: async () => ({
        async listTools() {
          return { tools: [{ name: "jira_get_issue" }] };
        },
        async callTool() {
          return { content: [] };
        },
        async close() {}
      })
    });

    expect(report).toMatchObject({
      status: "ready",
      mcpCheck: {
        status: "pass",
        summary: "Jira MCP server exposes jira_get_issue."
      },
      nextCommand: "task-loop-orchestrator run --jira ISSUE-KEY"
    });
  });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-jira-setup-"));
  tempDirs.push(dir);
  return dir;
}

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultOrchestratorConfig, loadOrchestratorConfig } from "../src/config.js";

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadOrchestratorConfig", () => {
  it("returns defaults when orchestrator.config.json is absent", async () => {
    const root = await tempRoot();

    await expect(loadOrchestratorConfig(root)).resolves.toEqual(defaultOrchestratorConfig);
  });

  it("loads supported executor, permission, worktree, and max iteration settings", async () => {
    const root = await tempRoot();
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "orchestrator.config.json"),
      JSON.stringify({
        executor: "codex-cli-dry-run",
        planner: "mock",
        reviewer: "local-evidence",
        github: "gh-cli",
        jira: {
          provider: "cli",
          fallback: "none",
          mcp: {
            command: "custom-mcp",
            args: ["--stdio"],
            toolName: "custom_jira_get_issue",
            issueKeyArgument: "key",
            env: {
              JIRA_URL: "https://jira.example.com"
            }
          }
        },
        gemini: {
          endpoint: "https://example.test/gemini",
          model: "custom-gemini-model",
          apiKey: "inline-key"
        },
        codex: {
          binary: "custom-codex",
          sandbox: "read-only",
          workspaceRoot: ".orchestrator/custom-workspaces",
          model: "codex-test"
        },
        openai: {
          endpoint: "https://example.test/openai/v1",
          model: "gpt-test",
          apiKey: "openai-inline-key"
        },
        permissionMode: "maintainer",
        worktree: {
          enabled: true
        },
        maxIterations: 3
      }),
      "utf8"
    );

    await expect(loadOrchestratorConfig(root)).resolves.toEqual({
      executor: "codex-cli-dry-run",
      planner: "mock",
      reviewer: "local-evidence",
      github: "gh-cli",
      jira: {
        provider: "cli",
        fallback: "none",
        mcp: {
          command: "custom-mcp",
          args: ["--stdio"],
          toolName: "custom_jira_get_issue",
          issueKeyArgument: "key",
          env: {
            JIRA_URL: "https://jira.example.com"
          }
        }
      },
      gemini: {
        endpoint: "https://example.test/gemini",
        model: "custom-gemini-model",
        apiKey: "inline-key"
      },
      codex: {
        binary: "custom-codex",
        sandbox: "read-only",
        workspaceRoot: ".orchestrator/custom-workspaces",
        model: "codex-test"
      },
      openai: {
        endpoint: "https://example.test/openai/v1",
        model: "gpt-test",
        apiKey: "openai-inline-key"
      },
      permissionMode: "maintainer",
      worktree: {
        enabled: true
      },
      maxIterations: 3
    });
  });
});

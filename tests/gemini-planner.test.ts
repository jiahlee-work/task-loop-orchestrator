import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Context, Graph, TaskSpec } from "../src/domain.js";
import { geminiEnvPath, loadGeminiConfigWithLocalEnv, setupGemini } from "../src/index.js";
import { GeminiPlanner } from "../src/gemini-planner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Gemini planner", () => {
  it("converts Gemini JSON into bounded proposed subtasks", async () => {
    const planner = new GeminiPlanner({
      config: {
        endpoint: "https://gemini.example.test",
        model: "gemini-test",
        apiKey: "secret"
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        summary: "Plan shell refactor",
                        rootContract: {
                          goal: "Refactor chat shell and sidebar structure",
                          nonGoals: ["Do not redesign the chat UI"],
                          mustFollow: ["Keep the shell layout stable"],
                          acceptanceCriteria: ["Shell layout remains stable.", "Sidebar behavior remains unchanged."],
                          contextGuard: ["Reject executor output that changes visible layout unexpectedly."],
                          repoConstraints: ["Do not create commits or PRs."],
                          userDecisions: ["User asked to preserve UI behavior."]
                        },
                        taskTree: {
                          tasks: [
                            {
                              title: "Extract sidebar shell",
                              description: "Move sidebar layout into a bounded shell component.",
                              dependsOn: []
                            },
                            {
                              title: "Wire chat content",
                              description: "Connect chat body to the new shell.",
                              dependsOn: ["Extract sidebar shell"]
                            }
                          ]
                        }
                      })
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200 }
        )
    });

    const report = await planner.plan({
      spec,
      context,
      graph
    });

    expect(report.status).toBe("ok");
    expect(report.summary).toBe("Plan shell refactor");
    expect(report.proposedSubtasks).toHaveLength(2);
    expect(report.proposedSubtasks?.[0]).toMatchObject({
      title: "Extract sidebar shell",
      description: "Move sidebar layout into a bounded shell component.",
      assignedRole: "executor"
    });
    expect(report.proposedSubtasks?.[1]?.dependsOn).toEqual([report.proposedSubtasks?.[0]?.id]);
    expect(report.data).toMatchObject({
      provider: "gemini",
      model: "gemini-test",
      rootContract: {
        goal: "Refactor chat shell and sidebar structure",
        nonGoals: ["Do not redesign the chat UI"],
        acceptanceCriteria: ["Shell layout remains stable.", "Sidebar behavior remains unchanged."],
        contextGuard: ["Reject executor output that changes visible layout unexpectedly."]
      },
      taskTree: {
        tasks: [
          {
            title: "Extract sidebar shell",
            sourceDependsOn: []
          },
          {
            title: "Wire chat content",
            sourceDependsOn: ["Extract sidebar shell"]
          }
        ]
      }
    });
  });

  it("returns a failed planner report when the API key is missing", async () => {
    const planner = new GeminiPlanner({
      config: {
        endpoint: "https://gemini.example.test",
        model: "gemini-test"
      }
    });

    const report = await planner.plan({ spec, context, graph });

    expect(report.status).toBe("failed");
    expect(report.summary).toContain("tlo setup gemini");
  });
});

describe("Gemini setup", () => {
  it("writes local Gemini credentials with owner-only permissions", async () => {
    const root = await tempRoot();

    const report = await setupGemini({
      rootDir: root,
      apiKey: "secret-key",
      model: "gemini-test",
      skipCheck: true
    });

    const path = geminiEnvPath(root);
    await expect(readFile(path, "utf8")).resolves.toContain("GEMINI_API_KEY=secret-key\n");
    await expect(readFile(path, "utf8")).resolves.toContain("GEMINI_MODEL=gemini-test\n");
    expect(report).toMatchObject({
      status: "saved",
      envFile: path,
      model: "gemini-test",
      check: { status: "skipped" },
      nextCommand: "tlo doctor gemini"
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("loads saved Gemini env into planner config", async () => {
    const root = await tempRoot();
    await setupGemini({
      rootDir: root,
      apiKey: "secret-key",
      model: "gemini-test",
      skipCheck: true
    });

    await expect(
      loadGeminiConfigWithLocalEnv(root, {
        endpoint: "https://gemini.example.test",
        model: "fallback-model"
      })
    ).resolves.toMatchObject({
      endpoint: "https://generativelanguage.googleapis.com",
      model: "gemini-test",
      apiKey: "secret-key"
    });
  });
});

const spec: TaskSpec = {
  id: "OUC-10",
  title: "OUC-10: 채팅 Shell 및 Sidebar 구조 리팩터링",
  description: "Refactor shell and sidebar structure.",
  acceptanceCriteria: ["Shell layout remains stable."],
  permissionMode: "write"
};

const context: Context = {
  runId: "run-1",
  task: spec,
  items: [
    {
      id: "ctx-1",
      kind: "fact",
      text: "Repo status: clean",
      source: "root",
      createdAt: "2026-06-26T00:00:00.000Z"
    }
  ]
};

const graph: Graph = {
  subtasks: [],
  conflicts: []
};

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-gemini-"));
  tempDirs.push(dir);
  return dir;
}

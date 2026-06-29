import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Context, Graph, RoleReport, Subtask, TaskSpec } from "../src/domain.js";
import { loadOpenAIConfigWithLocalEnv, openAIEnvPath, setupOpenAI } from "../src/index.js";
import { OpenAIReviewer } from "../src/openai-reviewer.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("OpenAI reviewer", () => {
  it("converts OpenAI JSON review output into a reviewer report", async () => {
    const reviewer = new OpenAIReviewer({
      config: {
        endpoint: "https://openai.example.test/v1",
        model: "gpt-test",
        apiKey: "secret"
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              verdict: "accept",
              summary: "Evidence is sufficient.",
              reasons: ["Executor succeeded.", "Diff evidence exists."]
            })
          }),
          { status: 200 }
        )
    });

    const report = await reviewer.review({
      spec,
      context,
      graph,
      subtask,
      executorReport,
      evidence: [{ kind: "diff_stat", summary: "src/app.ts | 2 +-", data: { raw: "src/app.ts | 2 +-" } }]
    });

    expect(report.status).toBe("ok");
    expect(report.summary).toBe("Evidence is sufficient.");
    expect(report.data).toMatchObject({
      verdict: "accept",
      provider: "openai",
      model: "gpt-test",
      readOnly: true
    });
  });

  it("blocks when OpenAI API key is missing", async () => {
    const reviewer = new OpenAIReviewer({
      config: {
        endpoint: "https://openai.example.test/v1",
        model: "gpt-test"
      }
    });

    const report = await reviewer.review({ spec, context, graph, subtask, executorReport, evidence: [] });

    expect(report.status).toBe("blocked");
    expect(report.summary).toContain("tlo setup openai");
  });
});

describe("OpenAI setup", () => {
  it("writes local OpenAI credentials with owner-only permissions", async () => {
    const root = await tempRoot();

    const report = await setupOpenAI({
      rootDir: root,
      apiKey: "secret-key",
      model: "gpt-test",
      skipCheck: true
    });

    const path = openAIEnvPath(root);
    await expect(readFile(path, "utf8")).resolves.toContain("OPENAI_API_KEY=secret-key\n");
    await expect(readFile(path, "utf8")).resolves.toContain("OPENAI_MODEL=gpt-test\n");
    expect(report).toMatchObject({
      status: "saved",
      envFile: path,
      model: "gpt-test",
      check: { status: "skipped" },
      nextCommand: "tlo doctor openai"
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("loads saved OpenAI env into reviewer config", async () => {
    const root = await tempRoot();
    await setupOpenAI({
      rootDir: root,
      apiKey: "secret-key",
      model: "gpt-test",
      skipCheck: true
    });

    await expect(
      loadOpenAIConfigWithLocalEnv(root, {
        endpoint: "https://openai.example.test/v1",
        model: "fallback-model"
      })
    ).resolves.toMatchObject({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-test",
      apiKey: "secret-key"
    });
  });
});

const spec: TaskSpec = {
  id: "task-1",
  title: "Review task",
  description: "Review executor output.",
  acceptanceCriteria: ["Evidence is sufficient."],
  permissionMode: "write"
};

const context: Context = {
  runId: "run-1",
  task: spec,
  items: []
};

const graph: Graph = {
  subtasks: [],
  conflicts: []
};

const subtask: Subtask = {
  id: "subtask-1",
  title: "Implement change",
  dependsOn: [],
  status: "active",
  createdAt: "2026-06-29T00:00:00.000Z",
  updatedAt: "2026-06-29T00:00:00.000Z"
};

const executorReport: RoleReport = {
  role: "executor",
  status: "ok",
  subtaskId: subtask.id,
  summary: "Executor completed work."
};

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-openai-"));
  tempDirs.push(dir);
  return dir;
}

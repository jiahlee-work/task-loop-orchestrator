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
        reviewer: "local-evidence",
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
      reviewer: "local-evidence",
      permissionMode: "maintainer",
      worktree: {
        enabled: true
      },
      maxIterations: 3
    });
  });
});

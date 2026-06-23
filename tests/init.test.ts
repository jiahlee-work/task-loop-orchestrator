import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOrchestratorConfig } from "../src/config.js";
import { initProject } from "../src/init.js";

describe("project init", () => {
  it("creates config and gitignore files in a new project", async () => {
    const root = await makeTempDir();

    try {
      const report = await initProject(root);

      expect(report.files.config.status).toBe("created");
      expect(report.files.gitignore.status).toBe("created");
      await expect(readJson(join(root, "orchestrator.config.json"))).resolves.toEqual(defaultOrchestratorConfig);
      await expect(readFile(join(root, ".gitignore"), "utf8")).resolves.toBe(".orchestrator/\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing config unless force is enabled", async () => {
    const root = await makeTempDir();
    const configPath = join(root, "orchestrator.config.json");
    const customConfig = `${JSON.stringify({ executor: "codex-cli-dry-run", maxIterations: 3 }, null, 2)}\n`;

    try {
      await writeFile(configPath, customConfig, "utf8");
      const report = await initProject(root);

      expect(report.files.config.status).toBe("skipped");
      expect(report.files.config.reason).toContain("already exists");
      await expect(readFile(configPath, "utf8")).resolves.toBe(customConfig);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("overwrites an existing config when force is enabled", async () => {
    const root = await makeTempDir();
    const configPath = join(root, "orchestrator.config.json");

    try {
      await writeFile(configPath, "{\"executor\":\"codex-cli-dry-run\"}\n", "utf8");
      const report = await initProject(root, { force: true });

      expect(report.files.config.status).toBe("updated");
      await expect(readJson(configPath)).resolves.toEqual(defaultOrchestratorConfig);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("appends gitignore without reordering existing content", async () => {
    const root = await makeTempDir();
    const gitignorePath = join(root, ".gitignore");

    try {
      await writeFile(gitignorePath, "node_modules/\ndist", "utf8");
      const report = await initProject(root);

      expect(report.files.gitignore.status).toBe("updated");
      await expect(readFile(gitignorePath, "utf8")).resolves.toBe("node_modules/\ndist\n.orchestrator/\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps gitignore idempotent when orchestrator data is already ignored", async () => {
    const root = await makeTempDir();
    const gitignorePath = join(root, ".gitignore");

    try {
      await writeFile(gitignorePath, "node_modules/\n.orchestrator/\n", "utf8");
      const report = await initProject(root);

      expect(report.files.gitignore.status).toBe("skipped");
      expect(report.files.gitignore.reason).toContain("already ignored");
      await expect(readFile(gitignorePath, "utf8")).resolves.toBe("node_modules/\n.orchestrator/\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("shows init in CLI usage", async () => {
    const cliSource = await readFile(join(process.cwd(), "src", "cli.ts"), "utf8");

    expect(cliSource).toContain("task-loop-orchestrator init [--force] [--json]");
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "task-loop-init-"));
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

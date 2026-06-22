import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("package metadata", () => {
  it("defines an installable CLI package contract", async () => {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
      engines?: Record<string, string>;
      files?: string[];
      packageManager?: string;
      scripts?: Record<string, string>;
    };

    expect(packageJson.bin).toEqual({
      "task-loop-orchestrator": "./dist/cli.js"
    });
    expect(packageJson.engines?.node).toBe(">=24");
    expect(packageJson.packageManager).toMatch(/^pnpm@/);
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist", "schemas", "orchestrator.config.example.json"]));
    expect(packageJson.scripts?.prepack).toBe("pnpm run build");
    expect(packageJson.scripts?.postbuild).toContain("chmodSync");
    expect(packageJson.scripts?.["package:smoke"]).toBe("node scripts/package-smoke.mjs");
  });

  it("keeps the CLI source executable through a node shebang", async () => {
    const cliSource = await readFile(join(root, "src", "cli.ts"), "utf8");

    expect(cliSource.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("documents package smoke coverage and diagnostics", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");

    expect(readme).toContain("installs the tarball into a temporary project");
    expect(readme).toContain("`checkpoint`, `pr-plan`, `pr-exec`, `approve-pr`, and `checks`");
    expect(readme).toContain("step label, command, cwd, exit code");
    expect(readme).toContain("never creates GitHub PRs, merges, pushes, releases, or publishes to npm");
  });
});

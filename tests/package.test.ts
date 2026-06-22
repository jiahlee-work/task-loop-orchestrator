import { readFile } from "node:fs/promises";
import { normalize } from "node:path";
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
    expect(packageJson.scripts?.["release:check"]).toBe("node scripts/release-check.mjs");
  });

  it("guards the npm pack artifact allowlist", async () => {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
      exports?: unknown;
    };

    expect(normalize(packageJson.bin?.["task-loop-orchestrator"] ?? "")).toBe(normalize("dist/cli.js"));
    expect(packageJson.files?.sort()).toEqual(["dist", "orchestrator.config.example.json", "schemas"]);
    expect(packageJson.scripts?.prepack).toMatch(/\bpnpm run build\b/);
    expect(packageJson.exports).toBeUndefined();
  });

  it("keeps the CLI source executable through a node shebang", async () => {
    const cliSource = await readFile(join(root, "src", "cli.ts"), "utf8");

    expect(cliSource.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("documents and implements CLI version output", async () => {
    const cliSource = await readFile(join(root, "src", "cli.ts"), "utf8");
    const readme = await readFile(join(root, "README.md"), "utf8");

    expect(cliSource).toContain("task-loop-orchestrator --version");
    expect(cliSource).toContain('args.command === "--version" || args.command === "-v"');
    expect(readme).toContain("node dist/cli.js --version");
    expect(readme).toContain('"$tmpdir/node_modules/.bin/task-loop-orchestrator" --version');
  });

  it("documents package smoke coverage and diagnostics", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");

    expect(readme).toContain("installs the tarball into a temporary project");
    expect(readme).toContain("pnpm run release:check");
    expect(readme).toContain("`dist`, `schemas`, and `orchestrator.config.example.json`");
    expect(readme).toContain("`checkpoint`, `pr-plan`, `pr-exec`, `approve-pr`, and `checks`");
    expect(readme).toContain("step label, command, cwd, exit code");
    expect(readme).toContain("never creates GitHub PRs, merges, pushes, releases, or publishes to npm");
  });
});

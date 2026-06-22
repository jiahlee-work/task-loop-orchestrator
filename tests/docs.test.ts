import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("quickstart documentation", () => {
  it("documents runtime requirements and clone-based local execution", async () => {
    const quickstart = await readQuickstart();

    expectContainsAll(quickstart, [
      "Node.js 24 or newer",
      "pnpm",
      "corepack enable",
      "pnpm install --frozen-lockfile",
      "pnpm run build",
      "node dist/cli.js --help",
      "node dist/cli.js --version"
    ]);
  });

  it("documents local tarball install entry points", async () => {
    const quickstart = await readQuickstart();

    expectContainsAll(quickstart, [
      "npm pack --pack-destination",
      "npm install /tmp/task-loop-orchestrator-0.1.0.tgz",
      "npx task-loop-orchestrator --help",
      "npx task-loop-orchestrator --version",
      '"$tmpdir/node_modules/.bin/task-loop-orchestrator" --help',
      '"$tmpdir/node_modules/.bin/task-loop-orchestrator" --version'
    ]);
  });

  it("documents the first project command flow and GitHub checks fallback", async () => {
    const quickstart = await readQuickstart();

    expectContainsAll(quickstart, [
      "npx task-loop-orchestrator doctor --json",
      "npx task-loop-orchestrator init --json",
      'npx task-loop-orchestrator run "Quickstart smoke" --max-iterations 1 --json',
      "npx task-loop-orchestrator status --json",
      "npx task-loop-orchestrator checks HEAD --json",
      "npx task-loop-orchestrator checkpoint --json",
      "npx task-loop-orchestrator checkpoint --github gh-cli --json",
      "GitHub remote",
      "readable check-runs",
      "graceful JSON status",
      "unknown",
      "not_found"
    ]);
  });

  it("keeps release verification docs aligned with package scripts and write boundaries", async () => {
    const quickstart = await readQuickstart();
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["release:check"]).toBeDefined();
    expect(packageJson.scripts?.["package:artifacts"]).toBeDefined();
    expectContainsAll(quickstart, [
      "pnpm run release:check",
      "pnpm run package:artifacts",
      "does not publish",
      "tag",
      "create releases",
      "push",
      "create PRs",
      "merge"
    ]);
  });
});

async function readQuickstart() {
  return readFile(join(root, "docs", "quickstart.md"), "utf8");
}

function expectContainsAll(value: string, expectedFragments: string[]) {
  for (const fragment of expectedFragments) {
    expect(value).toContain(fragment);
  }
}

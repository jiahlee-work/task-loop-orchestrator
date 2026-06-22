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

describe("release checklist documentation", () => {
  it("documents local verification commands and release check coverage", async () => {
    const checklist = await readReleaseChecklist();
    const releaseCheck = await readFile(join(root, "scripts", "release-check.mjs"), "utf8");
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["release:check"]).toBeDefined();
    expectContainsAll(checklist, [
      "pnpm install --frozen-lockfile",
      "pnpm run release:check",
      "pnpm run typecheck",
      "pnpm test",
      "pnpm run build",
      "pnpm run lint",
      "pnpm run package:smoke",
      "node dist/cli.js --version",
      "node dist/cli.js checks HEAD --json"
    ]);
    expectContainsAll(releaseCheck, [
      '"typecheck"',
      '"test"',
      '"build"',
      '"package artifacts"',
      '"lint"',
      '"package smoke"',
      '"version"',
      '"checks"'
    ]);
  });

  it("documents package artifact review and safety boundaries", async () => {
    const checklist = await readReleaseChecklist();

    expectContainsAll(checklist, [
      "package.json",
      "name and version",
      "bin.task-loop-orchestrator",
      "dist/cli.js",
      "files",
      "dist",
      "schemas",
      "orchestrator.config.example.json",
      "pnpm run package:artifacts",
      "npm pack --dry-run --json",
      "GitHub Actions `verify`",
      "npm publish",
      "GitHub release",
      "git tag",
      "release tag",
      "GitHub PRs or issues",
      "write-side GitHub actions"
    ]);
  });
});

describe("changelog documentation", () => {
  it("keeps the 0.1.0 unreleased feature summary intact", async () => {
    const changelog = await readChangelog();

    expectContainsAll(changelog, [
      "## 0.1.0 - Unreleased",
      "### Added",
      "Root orchestrator loop",
      "`run`, `resume`, and `status`",
      "File-backed run, checkpoint, and approval storage",
      "`.orchestrator/`",
      "`init`, `doctor`, and `--version`",
      "`checkpoint` and `checks`",
      "`pr-plan`, `approve-pr`, and dry-run `pr-exec`",
      "Stable CLI JSON envelope",
      "schema metadata",
      "sample smoke fixtures",
      "drift tests",
      "Installable package contract",
      "Node 24 requirement",
      "`npm pack` artifact allowlist",
      "installed binary package smoke"
    ]);
  });

  it("keeps the 0.1.0 non-goals explicit", async () => {
    const changelog = await readChangelog();

    expectContainsAll(changelog, [
      "### Not Included",
      "npm publish",
      "GitHub release",
      "tag creation",
      "PR creation",
      "PR mutation",
      "merge",
      "release",
      "issue transition",
      "branch creation",
      "commit",
      "push",
      "Jira/GitHub network write integrations"
    ]);
  });
});

describe("release readiness documentation", () => {
  it("keeps README linked to the release preparation document set", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");

    expectContainsAll(readme, [
      "[docs/quickstart.md](docs/quickstart.md)",
      "[docs/release-checklist.md](docs/release-checklist.md)",
      "[CHANGELOG.md](CHANGELOG.md)",
      "pnpm run release:check",
      "pnpm run package:artifacts",
      "pnpm run package:smoke"
    ]);
  });

  it("keeps release commands and package artifact metadata connected", async () => {
    const quickstart = await readQuickstart();
    const checklist = await readReleaseChecklist();
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["release:check"]).toBeDefined();
    expect(packageJson.scripts?.["package:artifacts"]).toBeDefined();
    expect(packageJson.scripts?.["package:smoke"]).toBeDefined();
    expect(packageJson.scripts?.prepack).toBeDefined();
    expect(packageJson.files?.sort()).toEqual(["dist", "orchestrator.config.example.json", "schemas"]);
    expectContainsAll(quickstart, ["pnpm run release:check", "pnpm run package:artifacts"]);
    expectContainsAll(checklist, ["pnpm run release:check", "pnpm run package:artifacts"]);
  });

  it("keeps safety boundaries visible across release readiness docs", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const quickstart = await readQuickstart();
    const checklist = await readReleaseChecklist();
    const changelog = await readChangelog();

    expectContainsAll(readme, ["never create GitHub PRs", "publish to npm"]);
    expectContainsAll(quickstart, ["does not publish", "create releases", "push", "create PRs", "merge"]);
    expectContainsAll(checklist, ["Do not run `npm publish`", "Do not create a GitHub release", "Do not create or push a release tag"]);
    expectContainsAll(changelog, ["npm publish", "GitHub release", "tag creation", "GitHub write actions"]);
  });
});

async function readQuickstart() {
  return readFile(join(root, "docs", "quickstart.md"), "utf8");
}

async function readReleaseChecklist() {
  return readFile(join(root, "docs", "release-checklist.md"), "utf8");
}

async function readChangelog() {
  return readFile(join(root, "CHANGELOG.md"), "utf8");
}

function expectContainsAll(value: string, expectedFragments: string[]) {
  for (const fragment of expectedFragments) {
    expect(value).toContain(fragment);
  }
}

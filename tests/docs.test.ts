import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliJsonCommands } from "../src/cli-json.js";

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
      "[docs/commands.md](docs/commands.md)",
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

describe("command reference documentation", () => {
  it("documents every implemented CLI command", async () => {
    const commands = await readCommands();
    const cliSource = await readFile(join(root, "src", "cli.ts"), "utf8");
    const usageSignatures = extractCliUsageSignatures(cliSource);
    const commandHeadings = extractCommandReferenceHeadings(commands);

    expect(usageSignatures).toEqual([
      "--help",
      "--version",
      "init [--force] [--json]",
      "doctor [--github none|gh-cli] [--json]",
      "run <title> [--description text] [--permission read|write|maintainer] [--executor mock|codex-cli-dry-run|codex-cli] [--reviewer mock|local-evidence] [--max-iterations n] [--json]",
      "status [runId] [--json] [--raw]",
      "resume <runId> [--max-iterations n] [--json]",
      "checkpoint [runId] [--github none|gh-cli] [--json]",
      "pr-plan [runId] [--json]",
      "approve-pr [runId] --approved-by name [--reason text] [--json]",
      "pr-exec [runId] [--execute] [--approval approvalId] [--approved-by name] [--json]",
      "checks [ref] [--json]"
    ]);
    expect(commandHeadings).toEqual([
      "--help",
      "--version",
      "init",
      "doctor",
      "run",
      "resume",
      "status",
      "checkpoint",
      "checks",
      "pr-plan",
      "approve-pr",
      "pr-exec"
    ]);

    const documentedCommands = new Set(commandHeadings);
    for (const signature of usageSignatures) {
      expect(documentedCommands.has(commandNameFromSignature(signature))).toBe(true);
    }
  });

  it("documents JSON support and write-side boundaries", async () => {
    const commands = await readCommands();
    const readme = await readFile(join(root, "README.md"), "utf8");
    const quickstart = await readQuickstart();

    expect(readme).toContain("[docs/commands.md](docs/commands.md)");
    expect(quickstart).toContain("[commands.md](commands.md)");
    expectContainsAll(commands, [
      "JSON: supported with `--json`",
      "JSON: not supported",
      "read-only",
      "writes local bootstrap files only",
      "writes run state under `.orchestrator/runs/`",
      "saves checkpoint JSON under `.orchestrator/checkpoints/`",
      "writes an approval record under `.orchestrator/approvals/`",
      "dry-run by default",
      "executedCommands` remains empty",
      "does not create GitHub PRs",
      "merge",
      "push",
      "publish",
      "create tags",
      "create GitHub releases"
    ]);
  });

  it("keeps per-command JSON support labels aligned with CLI JSON commands", async () => {
    const commands = await readCommands();
    const jsonSupportByCommand = extractCommandReferenceJsonSupport(commands);
    const supportedInDocs = [...jsonSupportByCommand.entries()]
      .filter(([, jsonLine]) => jsonLine.includes("supported with `--json`"))
      .map(([command]) => command)
      .sort();
    const unsupportedInDocs = [...jsonSupportByCommand.entries()]
      .filter(([, jsonLine]) => jsonLine.includes("not supported"))
      .map(([command]) => command)
      .sort();

    expect(supportedInDocs).toEqual([...cliJsonCommands].sort());
    expect(unsupportedInDocs).toEqual(["--help", "--version"]);
  });

  it("keeps per-command write-side boundaries explicit", async () => {
    const commands = await readCommands();
    const sections = extractCommandReferenceSections(commands);

    expectSectionContains(sections, "--help", ["read-only", "no files or external systems are modified"]);
    expectSectionContains(sections, "--version", ["read-only", "no files or external systems are modified"]);
    expectSectionContains(sections, "doctor", ["read-only", "read-only GitHub CLI diagnostics", "instead of writing repository state"]);
    expectSectionContains(sections, "status", ["read-only", "does not modify local state or external systems"]);
    expectSectionContains(sections, "checks", ["read-only", "unknown", "not_found"]);
    expectSectionContains(sections, "pr-plan", ["read-only planning", "command candidates", "does not execute them"]);

    expectSectionContains(sections, "init", ["writes local bootstrap files only", "orchestrator.config.json", ".gitignore"]);
    expectSectionContains(sections, "run", ["writes run state", ".orchestrator/runs/", "do not call external write-side systems"]);
    expectSectionContains(sections, "resume", ["updates local run state"]);
    expectSectionContains(sections, "checkpoint", ["saves checkpoint JSON", ".orchestrator/checkpoints/", "appends a run audit event"]);
    expectSectionContains(sections, "approve-pr", ["writes an approval record", ".orchestrator/approvals/", "does not create or modify"]);

    expectSectionContains(sections, "pr-exec", [
      "dry-run by default",
      "`--execute` requires approval data",
      "checks stale approvals",
      "blocks before write-side execution",
      "`executedCommands` remains empty",
      "branch creation",
      "commit",
      "push",
      "`gh pr create` are not run"
    ]);
  });

  it("keeps global write-side prohibitions visible in the command reference", async () => {
    const commands = await readCommands();

    expectContainsAll(commands, [
      "does not create GitHub PRs",
      "merge",
      "push",
      "publish",
      "create tags",
      "create GitHub releases"
    ]);
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

async function readCommands() {
  return readFile(join(root, "docs", "commands.md"), "utf8");
}

function expectContainsAll(value: string, expectedFragments: string[]) {
  for (const fragment of expectedFragments) {
    expect(value).toContain(fragment);
  }
}

function extractCliUsageSignatures(cliSource: string) {
  const usageMatch = cliSource.match(/console\.log\(`Usage:\n(?<usage>[\s\S]*?)`\);/);
  expect(usageMatch?.groups?.usage).toBeDefined();

  return usageMatch!.groups!.usage.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("task-loop-orchestrator "))
    .map((line) => line.replace(/^task-loop-orchestrator\s+/, ""));
}

function extractCommandReferenceHeadings(commandsDoc: string) {
  return [...commandsDoc.matchAll(/^### `([^`]+)`/gm)]
    .map((match) => commandNameFromSignature(match[1]))
    .filter((heading) => heading !== undefined);
}

function extractCommandReferenceSections(commandsDoc: string) {
  const sections = new Map<string, string>();
  const headingMatches = [...commandsDoc.matchAll(/^### `([^`]+)`/gm)];

  for (let index = 0; index < headingMatches.length; index += 1) {
    const match = headingMatches[index];
    const nextMatch = headingMatches[index + 1];
    sections.set(commandNameFromSignature(match[1]), commandsDoc.slice(match.index, nextMatch?.index));
  }

  return sections;
}

function extractCommandReferenceJsonSupport(commandsDoc: string) {
  const sections = extractCommandReferenceSections(commandsDoc);
  const jsonSupportByCommand = new Map<string, string>();

  for (const [command, section] of sections) {
    const jsonLine = section.match(/^JSON: (.+)$/m)?.[1];

    expect(jsonLine, `Missing JSON support line for ${command}`).toBeDefined();
    jsonSupportByCommand.set(command, jsonLine!);
  }

  return jsonSupportByCommand;
}

function expectSectionContains(sections: Map<string, string>, command: string, expectedFragments: string[]) {
  const section = sections.get(command);
  expect(section, `Missing command section for ${command}`).toBeDefined();
  expectContainsAll(section!, expectedFragments);
}

function commandNameFromSignature(signature: string) {
  return signature.split(/\s+/)[0].replace(/,$/, "");
}

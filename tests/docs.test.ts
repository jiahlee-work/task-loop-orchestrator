import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliJsonCommands } from "../src/cli-json.js";

const root = process.cwd();

describe("quickstart documentation", () => {
  it("documents runtime requirements and clone-based local execution", async () => {
    const quickstart = await readQuickstart();

    expectContainsAll(quickstart, [
      "Node.js 24 이상",
      "pnpm",
      "corepack enable",
      "pnpm install --frozen-lockfile",
      "pnpm run build",
      "pnpm setup",
      "pnpm add -g .",
      "node dist/cli.js --help",
      "node dist/cli.js --version",
      "tlo --help",
      "tlo doctor"
    ]);
  });

  it("documents the first project command flow and GitHub checks fallback", async () => {
    const quickstart = await readQuickstart();

    expectContainsAll(quickstart, [
      "tlo init",
      "tlo doctor",
      "tlo setup",
      "tlo setup jira",
      "tlo setup gemini",
      "tlo doctor codex",
      "tlo doctor jira",
      "tlo doctor gemini",
      "tlo run OUC-10",
      'tlo run OUC-10 --note "이번에는 UI 문구까지 같이 정리해줘"',
      'tlo run "README의 설치 흐름을 현재 CLI 기준으로 정리해줘"',
      'tlo run "Quickstart smoke" --max-iterations 1 --json',
      'tlo status "$run_id" --json',
      "`run --json`이 반환한 `runId`",
      "run_json=",
      "run_id=",
      "node -e",
      "`init`은 다시 실행해도",
      "tlo init",
      "tlo checks HEAD --json",
      "GitHub remote",
      "check-run",
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
      "pnpm run package:smoke",
      "publish",
      "tag",
      "GitHub release",
      "push",
      "PR 생성",
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
      "[docs/design/root-planning-tree.md](docs/design/root-planning-tree.md)",
      "[docs/release-checklist.md](docs/release-checklist.md)",
      "[docs/release-readiness.md](docs/release-readiness.md)",
      "[docs/roadmap.md](docs/roadmap.md)",
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

    expectContainsAll(readme, ["GitHub PR 생성", "npm publish"]);
    expectContainsAll(quickstart, ["npm publish", "GitHub release", "push", "PR 생성", "merge"]);
    expectContainsAll(checklist, ["Do not run `npm publish`", "Do not create a GitHub release", "Do not create or push a release tag"]);
    expectContainsAll(changelog, ["npm publish", "GitHub release", "tag creation", "GitHub write actions"]);
  });

  it("keeps the release readiness summary linked and scoped as a manual review document", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const checklist = await readReleaseChecklist();
    const readiness = await readReleaseReadiness();

    expect(readme).toContain("[docs/release-readiness.md](docs/release-readiness.md)");
    expect(checklist).toContain("[release-readiness.md](release-readiness.md)");
    expectContainsAll(readiness, [
      "# 0.1.0 Release Readiness Summary",
      "`0.1.0 - Unreleased`",
      "[`../CHANGELOG.md`](../CHANGELOG.md)",
      "[`quickstart.md`](quickstart.md)",
      "[`commands.md`](commands.md)",
      "[`roadmap.md`](roadmap.md)",
      "[`release-checklist.md`](release-checklist.md)",
      "[`json-output.md`](json-output.md)",
      "[`../schemas/cli-json.schema.json`](../schemas/cli-json.schema.json)",
      "pnpm run release:check",
      "pnpm run package:artifacts",
      "pnpm run package:smoke",
      "npm publish",
      "GitHub release creation",
      "git tag creation",
      "GitHub PR creation",
      "branch creation",
      "commit",
      "push",
      "external write-side integration",
      "not a release procedure"
    ]);
  });

  it("keeps the post-0.1.0 roadmap scoped as a candidate backlog", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const readiness = await readReleaseReadiness();
    const roadmap = await readRoadmap();

    expect(readme).toContain("[docs/roadmap.md](docs/roadmap.md)");
    expect(readiness).toContain("[`roadmap.md`](roadmap.md)");
    expectContainsAll(roadmap, [
      "# Post-0.1.0 Roadmap",
      "candidate backlog",
      "not a committed schedule",
      "not a release promise",
      "Approval-Gated Write Execution Model",
      "[`design/write-execution-model.md`](design/write-execution-model.md)",
      "Codex CLI Executor Hardening",
      "Root Planning Tree Model",
      "[`design/root-planning-tree.md`](design/root-planning-tree.md)",
      "Reviewer And Evidence Expansion",
      "Multi-Run Context And Graph UX",
      "Persistent Audit And Report Export",
      "GitHub Provider Expansion",
      "Jira Checkpoint Evidence Expansion",
      "Packaging And Publish Workflow",
      "Safety boundary",
      "no `npm publish`, git tag, or GitHub release without explicit human approval"
    ]);
  });

  it("keeps the root planning tree design visible and scoped as a draft", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const roadmap = await readRoadmap();
    const design = await readRootPlanningTreeDesign();

    expect(readme).toContain("[docs/design/root-planning-tree.md](docs/design/root-planning-tree.md)");
    expect(roadmap).toContain("[`design/root-planning-tree.md`](design/root-planning-tree.md)");
    expectContainsAll(design, [
      "# Root Planning Tree Model",
      "Status: design draft",
      "initial run directory artifact storage and Gemini root-contract/task-tree output implemented",
      "Gemini root-contract/task-tree output implemented",
      "Gemini Planner now requests `rootContract` and `taskTree` JSON",
      "This does not mean the full tree executor is implemented",
      "LLM의 대화 기억에 의존하지 않는다",
      "root가 만든 계약 문서를 파일로 고정한다",
      "tlo run OUC-10",
      "tlo run OUC-10 --note",
      "tlo run \"채팅 Sidebar 구조를 리팩터링해줘\"",
      ".orchestrator/runs/run_xxx/",
      "root-contract.json",
      "task-tree.json",
      "state.json",
      "summary.md",
      "flowchart TD",
      "Root Planner",
      "Reviewer checks result and context guard",
      "Matches root contract?",
      "Context Guard",
      "Reviewer가 pass를 반환해도 root 계약을 위반하면 해당 branch는 완료로 처리하지 않는다"
    ]);
  });

  it("keeps the write execution model as a disabled design draft", async () => {
    const commands = await readCommands();
    const roadmap = await readRoadmap();
    const design = await readWriteExecutionModel();
    const auditCliDesign = await readExecutionAuditCliDesign();

    expect(roadmap).toContain("[`design/write-execution-model.md`](design/write-execution-model.md)");
    expect(roadmap).toContain("[`design/execution-audit-cli.md`](design/execution-audit-cli.md)");
    expect(commands).toContain("[design/write-execution-model.md](design/write-execution-model.md)");
    expect(design).toContain("[`execution-audit-cli.md`](execution-audit-cli.md)");
    expectContainsAll(design, [
      "# Approval-Gated Write Execution Model",
      "Status: design draft with staged read-only, dry-run, execution-policy, and simulated-executor surfaces implemented; actual write execution is not enabled.",
      "does not enable write execution",
      "current CLI must continue to block before write-side command execution",
      "`pr-exec --execute` requires approval data",
      "`executedCommands` remains empty",
      "Stale approval",
      "Plan drift",
      "Command injection",
      "Dirty worktree",
      "approval id",
      "approved plan fingerprint",
      "checkpoint id",
      "expiresAt",
      "explicit `--execute`",
      "approval is not stale",
      "approval is not expired",
      "permission gate allows the specific action",
      "one bounded command at a time",
      "no shell interpolation",
      "stdout/stderr summaries",
      "Audit logs must avoid recording secrets",
      "Write Execution Readiness Report Contract",
      "Status: helper, formatter, CLI, and schema are enabled for audit-bundle readiness. File-based preflight input is enabled for both plain and JSON modes.",
      "Is this execution intent ready to run, blocked, or unknown?",
      "Which approval, precondition, permission, dry-run trace, policy, CI, and repository-state checks",
      "Known from the existing `ExecutionAuditBundle`",
      "Needed from a preflight evidence file or a future read-only preflight query",
      "Preflight Input File Contract",
      "Status: value parser, file loader, and plain/JSON CLI paths implemented.",
      "task-loop-orchestrator write-readiness --intent <intentId> --preflight <path>",
      "task-loop-orchestrator write-readiness --intent <intentId> --preflight <path> --json",
      "The preflight file is a read-only evidence input",
      "`schemaVersion: 1`",
      "`checks`: an array of preflight check evidence items",
      "optional `metadata`: `{ createdAt, tool }`",
      "`status`: `pass`, `blocked`, or `unknown`",
      "`source`: `preflight`",
      "The file loader reads a JSON file, parses it, and passes the parsed value to the value parser",
      "The value parser maps recognized preflight evidence into the existing `WriteExecutionReadinessPreflightInput` booleans",
      "Missing or unrecognized checks remain `unknown` rather than implying approval",
      "Preflight files must not contain raw command args, raw stdout, raw stderr, exit codes, `executedCommands`, stack traces, secrets, tokens, raw persisted file content, or full command output",
      "Parser and loader errors must not echo the raw preflight file path, raw file contents, or stack traces",
      "The JSON CLI path uses the existing CLI envelope and a command-specific payload",
      "`readinessStatus`: `\"ready\" | \"blocked\" | \"unknown\"`",
      "`ready`: boolean",
      "`blockers`: `{ category, code, message, source }[]`",
      "`checks`: `{ category, status, message, source }[]`",
      "`inputs`: `{ auditBundle: \"available\", preflight: \"missing\" | \"partial\" | \"available\" }`",
      "`executionEnabled: false`",
      "`writeExecution: \"disabled\"`",
      "`hasExecutionResults: false`",
      "`approval`, `precondition`, `permission`, `trace`, `policy`, `ci`, `repo_state`, and `unknown`",
      "if the audit bundle contains blocked traces, blocked reasons, or mismatched trace records, readiness is `blocked`",
      "if required preflight inputs are missing, readiness is `unknown`",
      "`ready` is returned only when the audit bundle has no blockers and every required preflight check is explicitly present and passing",
      "The pure formatter returns a short human-readable summary",
      "Write execution readiness: <intentId>",
      "Status: ready|blocked|unknown",
      "Ready: yes|no|unknown",
      "Inputs: auditBundle=available, preflight=missing|partial|available",
      "Use --json for the stable automation contract.",
      "Use --json for the stable automation contract.",
      "summarizeWriteExecutionReadiness(bundle, preflight?)",
      "formatWriteExecutionReadiness(report)",
      "parseWriteReadinessPreflightInput(value)",
      "loadWriteReadinessPreflightInput(path)",
      "does not parse files, write files, spawn commands, or mutate domain state",
      "The preflight parser accepts an already parsed `unknown` value",
      "it does not read files, echo raw content, write files, spawn commands, or mutate domain state",
      "The file loader is read-only",
      "does not echo paths, raw file contents, stacks, stdout/stderr, exit codes, command args, or execution results",
      "contract fixture coverage for blocked and ready JSON-like report shapes",
      "preflight value parser, file loader, plain/JSON CLI, and contract fixture coverage",
      "Package smoke covers the installed binary JSON, plain, and preflight readiness paths",
      "`write-runner --intent <intentId> [--preflight <path>] [--simulate|--execute] --json` is enabled as an audited dry-run, execution-policy, and simulated-executor boundary",
      "Write Readiness CLI And Schema Surface Draft",
      "Status: plain and JSON paths enabled for `write-readiness --intent <intentId> [--json]`; preflight input is enabled with `--preflight <path>` in both modes.",
      "does not unlock write execution",
      "task-loop-orchestrator write-readiness --intent <intentId> [--json]",
      "task-loop-orchestrator write-readiness --intent <intentId> --preflight <path>",
      "task-loop-orchestrator write-readiness --intent <intentId> --preflight <path> --json",
      "This is preferred over `execution-audit --intent <intentId> --readiness [--json]`",
      "readiness answers a distinct question from audit review",
      "reuses the audit bundle internally",
      "It does not run a preflight query.",
      "approval freshness, CI, repository state, fingerprint, and remote/ref checks remain `unknown`",
      "`--intent <intentId>`: required selector",
      "`--json`: optional",
      "`--all`: defer list output",
      "`--preflight <path>`: optional; read one preflight evidence JSON file through the safe loader/parser",
      "Plain output uses `formatWriteExecutionReadiness(report)`",
      "JSON is the stable automation contract",
      "`--preflight <path>` reads evidence only and must not echo raw file paths or raw file contents",
      "no file writes",
      "no external command execution",
      "no GitHub lookup",
      "no branch creation",
      "no commit",
      "no push",
      "no pull request creation or mutation",
      "The schema artifact includes `$defs` for the readiness payload contract",
      "the active command enum and command-specific branch now include `\"write-readiness\"`",
      "active command enum and command-specific branch now include `\"write-readiness\"`",
      "branch condition: `command: \"write-readiness\"`",
      "branch payload reference: `#/$defs/writeReadinessResponsePayload`",
      "`writeReadinessResponsePayload`",
      "`writeReadinessPayload`",
      "`writeReadinessBlocker`",
      "`writeReadinessCheck`",
      "`writeReadinessInputs`",
      "`writeReadinessErrorPayload`",
      "`readinessStatus`",
      "`intentId`",
      "`runId`",
      "`planId`",
      "`approvalId`",
      "`blockers`",
      "`checks`",
      "`inputs`",
      "`checkpointId` should remain optional",
      "`writeReadinessBlocker` should require `category`, `code`, `message`, and `source`",
      "`writeReadinessCheck` should require `category`, `status`, `code`, `message`, and `source`",
      "`writeReadinessInputs` should require `auditBundle` and `preflight`",
      "Schema tests compare these payload definitions against the contract fixture tests in `tests/write-readiness.test.ts`",
      "The `writeReadinessResponsePayload` allows success `writeReadinessPayload` or `writeReadinessErrorPayload`",
      "`additionalProperties: true`",
      `errorCode: "write_readiness_missing_intent"`,
      `errorCode: "write_readiness_intent_not_found"`,
      `errorCode: "invalid_execution_intent_file"`,
      `errorCode: "invalid_execution_trace_file"`,
      `errorCode: "write_readiness_preflight_missing_path"`,
      `errorCode: "write_readiness_preflight_file_not_found"`,
      `errorCode: "write_readiness_preflight_file_not_readable"`,
      `errorCode: "write_readiness_preflight_invalid_json"`,
      `errorCode: "write_readiness_preflight_invalid_schema"`,
      "`readiness: null`",
      "raw persisted file contents, stack traces, secrets, raw stdout, raw stderr, exit codes, raw command argv, or execution results",
      "Preflight CLI Success And Error Contract",
      "Status: plain and JSON paths enabled for `write-readiness --intent <intentId> --preflight <path>`.",
      "loadWriteReadinessPreflightInput(path)",
      "summarizeWriteExecutionReadiness(bundle, preflight)",
      "Valid preflight evidence can change `inputs.preflight` from `missing` to `partial` or `available`",
      "must never unlock write execution",
      "write_readiness_preflight_missing_path",
      "write_readiness_preflight_file_not_found",
      "write_readiness_preflight_file_not_readable",
      "write_readiness_preflight_invalid_json",
      "write_readiness_preflight_invalid_schema",
      "Invalid preflight files should fail with an error envelope, not partial readiness success",
      "Loader/parser failure must not fall back to `inputs.preflight: \"missing\"`",
      "Plain and JSON errors must not include the raw preflight path, raw file contents, stack traces, raw stdout, raw stderr, exit codes, raw command args, `executedCommands`, secrets, or tokens",
      "valid preflight JSON success path",
      "valid preflight plain success path shows the same readiness state through the formatter",
      "invalid JSON returns a safe JSON error envelope",
      "invalid JSON returns a safe plain error",
      "invalid preflight schema returns a safe JSON error envelope",
      "invalid preflight schema returns a safe plain error",
      "no smoke path runs command execution",
      "Keep `write-readiness --intent <intentId> [--json]` and `--preflight <path> [--json]` under schema/docs/package smoke coverage",
      "Keep `write-runner --intent <intentId> [--preflight <path>] [--simulate|--execute] --json` under schema/docs/package smoke coverage as a dry-run and simulation boundary",
      "Audited Write Runner Dry-Run And Simulation Boundary",
      "Status: JSON path enabled for `write-runner --intent <intentId> [--preflight <path>] [--simulate|--execute] --json`; plain output and actual command execution remain disabled.",
      "task-loop-orchestrator write-runner --intent <intentId> --json",
      "task-loop-orchestrator write-runner --intent <intentId> --preflight <path> --json",
      "task-loop-orchestrator write-runner --intent <intentId> --preflight <path> --simulate --json",
      "task-loop-orchestrator write-runner --intent <intentId> --preflight <path> --execute --json",
      "If readiness is `ready`, dry-run and simulate modes persist local dry-run trace records under `.orchestrator/execution-traces/` as audit artifacts",
      "If readiness is `blocked` or `unknown`, the CLI returns a blocked dry-run report and does not save new traces",
      "`localTracePersistence`",
      "`mode: \"dry_run\" | \"simulate\" | \"execute_disabled\"`",
      "`actualExecutionEnabled: false`",
      "`--simulate` uses a deterministic safe executor boundary",
      "`--execute` is accepted only to return an `execute_disabled` policy/report",
      "Simulation results report only safe symbolic fields",
      "they do not expose raw command args",
      "This boundary is not an execution engine",
      "must not use `child_process`, shell execution, GitHub write APIs",
      "actual write execution unlock as a separate milestone",
      "Persist execution intents without running commands",
      "Add a read-only write execution readiness report helper",
      "Add a read-only write execution readiness plain formatter",
      "Draft the readiness CLI/schema surface without enabling the production command or active schema branch",
      "Enable the read-only `write-readiness --intent <intentId> --json` path and command-specific schema branch",
      "Enable plain readiness output using the pure formatter after JSON behavior is stable",
      "Complete the read-only `--preflight <path> [--json]` surface after CLI error handling and package smoke are covered",
      "Enable the audited `write-runner --intent <intentId> [--preflight <path>] --json` dry-run boundary",
      "Add an opt-in execution policy and deterministic simulated executor boundary",
      "npm publish",
      "git tag creation",
      "GitHub release creation",
      "arbitrary shell command execution"
    ]);
    expectContainsAll(auditCliDesign, [
      "# Execution Audit Read-Only CLI Surface",
      "Status: JSON and plain read-only output enabled for `execution-audit --intent <intentId>` and `execution-audit --all`.",
      "do not enable command execution",
      "Write-side actions remain future work.",
      "task-loop-orchestrator execution-audit --intent <intentId>",
      "task-loop-orchestrator execution-audit --intent <intentId> --json",
      "task-loop-orchestrator execution-audit --all",
      "task-loop-orchestrator execution-audit --all --json",
      "`--intent <intentId>`",
      "`--all`: list audit bundles for all persisted intents.",
      "`--json`: optional",
      "existing CLI JSON envelope",
      "command: \"execution-audit\"",
      "ExecutionAuditBundle",
      "`executionEnabled: false`",
      "`writeExecution: \"disabled\"`",
      "`hasExecutionResults: false`",
      "`--all` JSON List Contract",
      "Status: enabled for `execution-audit --all --json`.",
      "task-loop-orchestrator execution-audit --all --json",
      "`status: \"ok\"`",
      "`bundleCount`",
      "`bundles`: `ExecutionAuditBundle[]`",
      "not return a bare array",
      "ordered by the underlying execution intent `createdAt` value in descending order, newest first",
      "Empty state is a successful list response",
      "\"bundleCount\": 0",
      "\"bundles\": []",
      "Invalid Persisted File Policy For `--all`",
      "fail-fast with a single JSON error envelope",
      "`errorCode: \"invalid_execution_intent_file\"`",
      "`errorCode: \"invalid_execution_trace_file\"`",
      "`details.kind`",
      "preferred over partial success",
      "silently skipping invalid files",
      "raw file contents, stack traces, secrets, stdout, stderr, exit codes, or execution results",
      "`executionAuditListPayload`",
      "ExecutionAuditBundle | executionAuditListPayload | executionAuditErrorPayload",
      "Relationship To Write Readiness",
      "[`write-execution-model.md`](write-execution-model.md#write-execution-readiness-report-contract)",
      "[`write-execution-model.md`](write-execution-model.md#write-readiness-cli-and-schema-surface-draft)",
      "The audit command itself does not decide to unlock write execution.",
      "no file writes",
      "no external command execution",
      "no `child_process` or shell execution",
      "no branch creation",
      "no commit",
      "no push",
      "no pull request creation or mutation",
      "no approval mutation",
      "no run status transition",
      "No persisted intents",
      "Intent not found",
      "No traces for an existing intent",
      "Trace mismatch",
      "JSON Error Envelope Draft",
      "Status: enabled for success bundles, list bundles, missing intents, missing `--intent`, and invalid persisted intent/trace files.",
      "`status`: `not_found` for missing records, or `error` for usage and invalid persisted file cases",
      "`errorCode`: stable machine-readable code",
      "`execution_intent_not_found`",
      "`execution_audit_missing_intent`",
      "`invalid_execution_intent_file`",
      "`invalid_execution_trace_file`",
      "`intent`: `null` for not-found responses",
      "`details`: optional structured context",
      "{ \"kind\": \"execution_intent\" }",
      "{ \"kind\": \"execution_trace\" }",
      "raw file contents, stack traces, secrets, stdout, stderr, and exit codes",
      "invalid persisted intent file",
      "invalid persisted trace file",
      "when `--json` is omitted, the same missing selector, not-found, and invalid persisted file cases are formatted with short safe plain errors instead of JSON envelopes",
      "ExecutionAuditBundle | executionAuditListPayload | executionAuditErrorPayload",
      "executionAuditResponsePayload",
      "no file writes, no external command execution, no branch creation, no commit, no push",
      "Plain Output Contract",
      "Status: enabled through pure formatter helpers.",
      "The CLI uses these formatters when `--json` is omitted.",
      "Plain output is for people reading terminal summaries",
      "Automation, UI integrations, scripts, and schema validation must continue to use `--json`",
      "header: `Execution audit: <intentId>`",
      "`Status`, `Run`, `Plan`, `Approval`, `Checkpoint`, and `Created`",
      "`Execution: disabled` and `Write execution: disabled`",
      "dry-run trace count, planned trace count, blocked trace count, and action summary",
      "mismatched trace count and trace ids",
      "one line per dry-run trace",
      "Execution audit bundles",
      "Bundles: <bundleCount>",
      "No execution audit bundles found.",
      "newest first by execution intent `createdAt`",
      "per-bundle summary line",
      "should not print every trace by default",
      "the JSON envelope is the stable machine-readable contract",
      "preserves non-zero exits for missing selectors, not found, invalid persisted files, and other errors",
      "Successful single-intent and list summaries exit zero",
      "formatExecutionAuditBundle",
      "formatExecutionAuditList",
      "formatExecutionAuditError",
      "pure helpers",
      "do not parse files, write files, spawn commands, or change approval/intent/trace state",
      "package smoke covers at least one installed-binary plain output path",
      "decide whether invalid persisted file envelopes need additional structured `details` beyond `kind`",
      "`schemas/cli-json.schema.json`",
      "`docs/json-output.md`",
      "`docs/commands.md` entry for the enabled command",
      "plain output wiring through pure formatters",
      "package smoke coverage for installed binary JSON and plain output",
      "actual command execution",
      "`gh pr create`",
      "npm publish",
      "GitHub release creation"
    ]);
  });
});

describe("documentation role boundaries", () => {
  it("keeps README as a link hub with minimal setup and first-run commands", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");

    expectContainsAll(readme, [
      "[docs/quickstart.md](docs/quickstart.md)",
      "[docs/commands.md](docs/commands.md)",
      "[docs/release-checklist.md](docs/release-checklist.md)",
      "[docs/release-readiness.md](docs/release-readiness.md)",
      "[docs/roadmap.md](docs/roadmap.md)",
      "[CHANGELOG.md](CHANGELOG.md)",
      "corepack enable",
      "pnpm install --frozen-lockfile",
      "pnpm run build",
      "pnpm setup",
      "pnpm add -g .",
      "node dist/cli.js --help",
      "node dist/cli.js --version",
      "tlo doctor",
      "tlo init",
      "tlo setup",
      "tlo setup jira",
      "tlo setup gemini",
      "tlo doctor codex",
      "tlo doctor jira",
      "tlo doctor gemini",
      "tlo run OUC-10",
      'tlo run "Quickstart smoke" --max-iterations 1 --json',
      'tlo status "$run_id" --json',
      "`run --json`이 반환한 `runId`",
      "기본 패턴",
      "node -e",
      "`init`은 다시 실행해도",
      "설정이 이상해 보일 때는 `tlo doctor`"
    ]);
    expect(readme).not.toContain("npx task-loop-orchestrator write-runner --intent intent_xxx --preflight readiness-preflight.json --simulate --json");
    expect(readme).not.toContain("npx task-loop-orchestrator execution-audit --all");
    expect(readme).not.toContain("mktemp -d");
    expect(readme).not.toContain("npm install --prefix");
    expect(readme).not.toContain("task-loop-orchestrator-0.1.0.tgz");
  });

  it("keeps detailed install, command, release, and changelog roles in dedicated docs", async () => {
    const quickstart = await readQuickstart();
    const commands = await readCommands();
    const checklist = await readReleaseChecklist();
    const changelog = await readChangelog();

    expectContainsAll(quickstart, [
      "pnpm run package:artifacts",
      "pnpm run package:smoke",
      "pnpm run release:check",
      "일반 사용 흐름은 clone"
    ]);
    expect(quickstart).not.toContain("npm install /tmp/task-loop-orchestrator-0.1.0.tgz");
    expect(quickstart).not.toContain("mktemp -d");
    expect(quickstart).not.toContain("npm install --prefix");
    expectContainsAll(commands, [
      "# CLI Command Reference",
      "Purpose:",
      "Example:",
      "JSON:",
      "Behavior:"
    ]);
    expectContainsAll(checklist, [
      "# 0.1.0 Release Checklist",
      "release-readiness.md",
      "## Local Verification",
      "pnpm run release:check",
      "## Package Artifact Review",
      "## Explicitly Out Of Scope"
    ]);
    expectContainsAll(await readRoadmap(), [
      "# Post-0.1.0 Roadmap",
      "design/write-execution-model.md",
      "## Candidate Backlog",
      "## Documentation And Test Maintenance"
    ]);
    expectContainsAll(changelog, [
      "## 0.1.0 - Unreleased",
      "### Added",
      "### Not Included"
    ]);
  });
});

describe("command json documentation boundaries", () => {
  it("keeps command reference linked to the dedicated JSON output contract", async () => {
    const commands = await readCommands();
    const jsonOutput = await readJsonOutput();

    expectContainsAll(commands, [
      "[json-output.md](json-output.md)",
      "Commands that produce JSON include the common CLI JSON metadata described in [json-output.md](json-output.md).",
      "JSON: supported with `--json`",
      "JSON: not supported"
    ]);
    expect(commands).not.toContain('"schemaVersion": 1');
    expectContainsAll(jsonOutput, [
      "# CLI JSON Output",
      "shared metadata envelope",
      "command-specific payload fields",
      "schemaVersion",
      "command",
      "createdAt",
      "Compatibility Policy",
      "Command-specific payload fields remain at the top level",
      "../schemas/cli-json.schema.json"
    ]);
  });

  it("keeps JSON output docs and schema enum covering every JSON command", async () => {
    const jsonOutput = await readJsonOutput();
    const schema = await readCliJsonSchema();

    expect(schema.required).toEqual(["schemaVersion", "command", "createdAt"]);
    expect(schema.properties.schemaVersion.const).toBe(1);
    expect(schema.properties.command.enum.sort()).toEqual([...cliJsonCommands].sort());

    for (const command of cliJsonCommands) {
      expect(jsonOutput, `docs/json-output.md should mention ${command}`).toContain(command);
    }
    expectContainsAll(jsonOutput, [
      "command-specific schema branch",
      "init",
      "doctor",
      "run",
      "resume",
      "status",
      "checkpoint",
      "checks",
      "pr-plan",
      "pr-exec",
      "approve-pr",
      "execution-audit",
      "write-readiness",
      "write-runner"
    ]);
  });

  it("keeps schema artifact and sample smoke links visible from JSON docs", async () => {
    const jsonOutput = await readJsonOutput();
    const schema = await readCliJsonSchema();

    expect(schema.$id).toContain("schemas/cli-json.schema.json");
    expectContainsAll(jsonOutput, [
      "[`../schemas/cli-json.schema.json`](../schemas/cli-json.schema.json)",
      "[`../tests/json-schema-samples.test.ts`](../tests/json-schema-samples.test.ts)",
      "common envelope",
      "command enum",
      "required top-level fields"
    ]);
  });

  it("keeps schema command branches mapped to documented payload definitions", async () => {
    const jsonOutput = await readJsonOutput();
    const schema = await readCliJsonSchema();
    const branchRefs = extractSchemaCommandBranchRefs(schema);
    const expectedBranchRefs = new Map([
      ["init", "#/$defs/initPayload"],
      ["doctor", "#/$defs/doctorPayload"],
      ["run", "#/$defs/runReportPayload"],
      ["resume", "#/$defs/runResponsePayload"],
      ["status", "#/$defs/runReportPayload"],
      ["history", "#/$defs/historyPayload"],
      ["report", "#/$defs/reportPayload"],
      ["checkpoint", "#/$defs/checkpointPayload"],
      ["checks", "#/$defs/checksPayload"],
      ["pr-plan", "#/$defs/prPlanPayload"],
      ["pr-exec", "#/$defs/prExecPayload"],
      ["approve-pr", "#/$defs/approvePrPayload"],
      ["execution-audit", "#/$defs/executionAuditResponsePayload"],
      ["write-readiness", "#/$defs/writeReadinessResponsePayload"],
      ["write-runner", "#/$defs/writeRunnerResponsePayload"]
    ]);

    expect([...branchRefs.keys()].sort()).toEqual([...cliJsonCommands].sort());
    expect(branchRefs).toEqual(expectedBranchRefs);

    for (const ref of new Set(expectedBranchRefs.values())) {
      const defName = ref.replace("#/$defs/", "");
      expect(schema.$defs[defName], `Missing schema $defs.${defName}`).toBeDefined();
      expect(jsonOutput, `docs/json-output.md should mention ${defName}`).toContain(defName);
    }
    expectContainsAll(jsonOutput, [
      "allOf",
      "$defs",
      "command-specific branch",
      "sample smoke"
    ]);
  });

  it("keeps payload required fields mentioned in JSON output docs", async () => {
    const jsonOutput = await readJsonOutput();
    const schema = await readCliJsonSchema();
    const payloadRefs = new Set(extractSchemaCommandBranchRefs(schema).values());

    expectContainsAll(jsonOutput, schema.required);
    for (const ref of payloadRefs) {
      const defName = ref.replace("#/$defs/", "");
      const requiredFields = schemaRequiredFieldsForDef(schema, defName);

      expect(requiredFields.length, `Missing required fields for $defs.${defName}`).toBeGreaterThan(0);
      for (const field of requiredFields) {
        expect(jsonOutput, `docs/json-output.md should mention $defs.${defName}.required field ${field}`).toContain(`\`${field}\``);
      }
    }
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
      "setup [--skip-check] [--skip-jira]",
      "setup jira [--url url] [--username email] [--api-token token|--personal-token token] [--skip-check]",
      "setup gemini [--api-key key] [--model model] [--skip-check]",
      "setup openai [--api-key key] [--model model] [--skip-check]",
      "doctor [codex|jira|gemini|openai] [--github none|gh-cli] [--json]",
      "run ISSUE-KEY [--note text] [--planner mock|gemini] [--permission read|write|maintainer] [--executor mock|codex-cli-dry-run|codex-cli] [--reviewer mock|local-evidence|openai] [--max-iterations n] [--json]",
      "run <instruction> [--description text] [--planner mock|gemini] [--permission read|write|maintainer] [--executor mock|codex-cli-dry-run|codex-cli] [--reviewer mock|local-evidence|openai] [--max-iterations n] [--json]",
      "status [runId] [--json] [--raw]",
      "history [--json]",
      "report [runId] [--json]",
      "resume <runId> [--max-iterations n] [--json]",
      "checkpoint [runId] [--github none|gh-cli] [--json]",
      "pr-plan [runId] [--json]",
      "approve-pr [runId] --approved-by name [--reason text] [--json]",
      "pr-exec [runId] [--execute] [--approval approvalId] [--approved-by name] [--json]",
      "execution-audit (--intent intentId|--all) [--json]",
      "write-readiness --intent intentId [--preflight path] [--json]",
      "write-runner --intent intentId [--preflight path] [--simulate|--execute] --json",
      "checks [ref] [--json]"
    ]);
    expect(commandHeadings).toEqual([
      "--help",
      "--version",
      "init",
      "setup",
      "doctor",
      "run",
      "resume",
      "status",
      "history",
      "report",
      "checkpoint",
      "checks",
      "pr-plan",
      "approve-pr",
      "pr-exec",
      "execution-audit",
      "write-readiness",
      "write-runner"
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
      "writes run state under `.orchestrator/runs/<runId>/`",
      "saves checkpoint JSON under `.orchestrator/checkpoints/`",
      "writes an approval record under `.orchestrator/approvals/`",
      "reads `.orchestrator/execution-intents/` and `.orchestrator/execution-traces/`",
      "writes local dry-run trace records under `.orchestrator/execution-traces/`",
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
    expect(unsupportedInDocs).toEqual(["--help", "--version", "setup"]);
  });

  it("keeps per-command write-side boundaries explicit", async () => {
    const commands = await readCommands();
    const sections = extractCommandReferenceSections(commands);

    expectSectionContains(sections, "--help", ["read-only", "no files or external systems are modified"]);
    expectSectionContains(sections, "--version", ["read-only", "no files or external systems are modified"]);
    expectSectionContains(sections, "setup", [".orchestrator/jira.env", "`0600`", "MCP server exposes the Jira issue read tool"]);
    expectSectionContains(sections, "doctor", [
      "read-only",
      "read-only GitHub CLI diagnostics",
      "optional Jira MCP availability",
      "instead of writing repository state"
    ]);
    expectSectionContains(sections, "status", ["read-only", "does not modify local state or external systems"]);
    expectSectionContains(sections, "checks", ["read-only", "unknown", "not_found"]);
    expectSectionContains(sections, "pr-plan", ["read-only planning", "command candidates", "does not execute them"]);
    expectSectionContains(sections, "execution-audit", [
      "read-only",
      ".orchestrator/execution-intents/",
      ".orchestrator/execution-traces/",
      "JSON error envelopes with disabled execution markers",
      "does not write files",
      "does not execute commands",
      "human-readable audit summary by default",
      "short safe plain errors otherwise"
    ]);
    expectSectionContains(sections, "write-readiness", [
      "read-only",
      ".orchestrator/execution-intents/",
      ".orchestrator/execution-traces/",
      "Plain and JSON modes can read a safe preflight evidence file with `--preflight <path>`",
      "loader/parser failures return short safe plain errors or JSON error envelopes instead of partial success",
      "Plain output is for human terminal review",
      "`--json` is the stable automation contract",
      "JSON error envelopes with disabled execution markers",
      "short safe plain errors otherwise",
      "does not write files",
      "does not execute commands",
      "does not query GitHub"
    ]);
    expectSectionContains(sections, "write-runner", [
      "dry-run",
      "Default mode is `dry_run`",
      "`--simulate` uses a deterministic safe executor boundary",
      "`--execute` returns an `execute_disabled` policy/report",
      ".orchestrator/execution-intents/",
      ".orchestrator/execution-traces/",
      "writes local dry-run trace records under `.orchestrator/execution-traces/` as audit artifacts",
      "`--json` is required",
      "does not execute commands",
      "does not create branches",
      "commits",
      "pushes",
      "GitHub PRs"
    ]);

    expectSectionContains(sections, "init", ["writes local bootstrap files only", "orchestrator.config.json", ".gitignore"]);
    expectSectionContains(sections, "run", [
      "writes run state",
      ".orchestrator/runs/<runId>/",
      "root-contract.json",
      "task-tree.json",
      "state.json",
      "summary.md",
      "do not call external write-side systems"
    ]);
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

  it("keeps command examples aligned with CLI and smoke flows", async () => {
    const commands = await readCommands();
    const sections = extractCommandReferenceSections(commands);
    const examples = extractCommandReferenceExamples(commands);
    const jsonSupportByCommand = extractCommandReferenceJsonSupport(commands);
    const smokeScript = await readFile(join(root, "scripts", "package-smoke.mjs"), "utf8");

    for (const command of extractCommandReferenceHeadings(commands)) {
      expectSectionContains(sections, command, ["Example:", "```bash"]);
      const commandExamples = examples.get(command) ?? [];
      expect(commandExamples.length, `Missing example command for ${command}`).toBeGreaterThan(0);
      for (const example of commandExamples) {
        expect(
          example.startsWith("task-loop-orchestrator ") || example.startsWith("tlo "),
          `Example should start with a CLI binary name: ${example}`
        ).toBe(true);
      }
    }

    const jsonCapableExamples = [...jsonSupportByCommand.entries()]
      .filter(([, jsonLine]) => jsonLine.includes("supported with `--json`"))
      .map(([command]) => examples.get(command)?.join("\n") ?? "");
    for (const exampleText of jsonCapableExamples) {
      expect(exampleText).toContain("--json");
    }
    expect(examples.get("--help")?.join("\n")).not.toContain("--json");
    expect(examples.get("--version")?.join("\n")).not.toContain("--json");

    for (const command of [
      "init",
      "doctor",
      "run",
      "resume",
      "status",
      "checkpoint",
      "pr-plan",
      "pr-exec",
      "approve-pr",
      "execution-audit",
      "write-readiness",
      "write-runner",
      "checks"
    ]) {
      expect(examples.has(command), `Missing command reference example for ${command}`).toBe(true);
    }
    expectContainsAll(smokeScript, [
      '"init", "--json"',
      '"doctor", "--json"',
      "git_repository",
      "config",
      "gitignore",
      "store_path",
      '"tlo", "init"',
      '"run", "Smoke task", "--planner", "mock", "--executor", "mock", "--reviewer", "mock", "--max-iterations", "1", "--json"',
      '"resume", loopReport.runId, "--max-iterations", "1", "--json"',
      '"status", "--json"',
      '"checkpoint", loopReport.runId, "--json"',
      '"status", loopReport.runId, "--json"',
      '"pr-plan", loopReport.runId, "--json"',
      '"pr-exec", loopReport.runId, "--json"',
      '"approve-pr", loopReport.runId, "--approved-by", "package-smoke", "--json"',
      '"execution-audit", "--intent", fixture.intentId, "--json"',
      '"write-readiness", "--intent", fixture.intentId, "--json"',
      '"write-readiness", "--intent", fixture.intentId, "--preflight", preflight.validPath, "--json"',
      '"write-runner", "--intent", fixture.intentId, "--preflight", preflight.validPath, "--json"',
      '"write-runner", "--intent", fixture.intentId, "--preflight", preflight.validPath, "--simulate", "--json"',
      '"write-runner", "--intent", fixture.intentId, "--preflight", preflight.validPath, "--execute", "--json"',
      '"write-runner", "--intent", fixture.intentId, "--json"',
      '"write-readiness", "--intent", fixture.intentId, "--preflight", preflight.validPath]',
      '"write-readiness", "--intent", fixture.intentId]',
      '"execution-audit", "--intent", fixture.intentId]',
      '"execution-audit", "--all"]',
      '"checks", "HEAD", "--json"'
    ]);
  });
});

async function readQuickstart() {
  return readFile(join(root, "docs", "quickstart.md"), "utf8");
}

async function readReleaseChecklist() {
  return readFile(join(root, "docs", "release-checklist.md"), "utf8");
}

async function readReleaseReadiness() {
  return readFile(join(root, "docs", "release-readiness.md"), "utf8");
}

async function readRoadmap() {
  return readFile(join(root, "docs", "roadmap.md"), "utf8");
}

async function readWriteExecutionModel() {
  return readFile(join(root, "docs", "design", "write-execution-model.md"), "utf8");
}

async function readRootPlanningTreeDesign() {
  return readFile(join(root, "docs", "design", "root-planning-tree.md"), "utf8");
}

async function readExecutionAuditCliDesign() {
  return readFile(join(root, "docs", "design", "execution-audit-cli.md"), "utf8");
}

async function readChangelog() {
  return readFile(join(root, "CHANGELOG.md"), "utf8");
}

async function readCommands() {
  return readFile(join(root, "docs", "commands.md"), "utf8");
}

async function readJsonOutput() {
  return readFile(join(root, "docs", "json-output.md"), "utf8");
}

async function readCliJsonSchema() {
  return JSON.parse(await readFile(join(root, "schemas", "cli-json.schema.json"), "utf8")) as {
    $id: string;
    required: string[];
    properties: {
      schemaVersion: { const: number };
      command: { enum: string[] };
      createdAt: { type: string; format: string };
    };
    $defs: Record<string, {
      $ref?: string;
      required?: string[];
    }>;
    allOf: Array<{
      if: {
        properties: {
          command: {
            const?: string;
            enum?: string[];
          };
        };
        required?: string[];
      };
      then: {
        $ref: string;
      };
    }>;
  };
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

function extractCommandReferenceExamples(commandsDoc: string) {
  const examples = new Map<string, string[]>();
  const sections = extractCommandReferenceSections(commandsDoc);

  for (const [command, section] of sections) {
    const exampleBlock = section.match(/Example:\n\n```bash\n(?<commands>[\s\S]*?)\n```/);
    expect(exampleBlock?.groups?.commands, `Missing bash example block for ${command}`).toBeDefined();
    examples.set(
      command,
      exampleBlock!.groups!.commands.split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    );
  }

  return examples;
}

function extractSchemaCommandBranchRefs(schema: Awaited<ReturnType<typeof readCliJsonSchema>>) {
  const branchRefs = new Map<string, string>();

  for (const branch of schema.allOf) {
    const commandCondition = branch.if.properties.command;
    const commands = commandCondition.enum ?? (commandCondition.const ? [commandCondition.const] : []);

    for (const command of commands) {
      branchRefs.set(command, branch.then.$ref);
    }
  }

  return branchRefs;
}

function schemaRequiredFieldsForDef(schema: Awaited<ReturnType<typeof readCliJsonSchema>>, defName: string) {
  const schemaDef = schema.$defs[defName];
  expect(schemaDef, `Missing schema $defs.${defName}`).toBeDefined();

  if (schemaDef.$ref) {
    return schemaRequiredFieldsForDef(schema, schemaDef.$ref.replace("#/$defs/", ""));
  }

  return schemaDef.required ?? [];
}

function expectSectionContains(sections: Map<string, string>, command: string, expectedFragments: string[]) {
  const section = sections.get(command);
  expect(section, `Missing command section for ${command}`).toBeDefined();
  expectContainsAll(section!, expectedFragments);
}

function commandNameFromSignature(signature: string) {
  return signature.split(/\s+/)[0].replace(/,$/, "");
}

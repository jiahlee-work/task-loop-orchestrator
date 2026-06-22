# task-loop-orchestrator

MVP scaffold for an AI role-split closed-loop task orchestrator.

## Requirements

- Node.js 24 or newer
- pnpm 11.5.2 via Corepack or a compatible local install

## Commands

```bash
pnpm run build
pnpm test
pnpm run typecheck
pnpm run lint
```

## Local Development

This project requires Node.js 24 or newer. Use pnpm through Corepack or a compatible pnpm 11.x install.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
node dist/cli.js --help
```

Run a local loop:

```bash
pnpm run build
node dist/cli.js run "Create MVP scaffold" --description "Exercise the mock closed loop"
node dist/cli.js run "Prepare executor adapter" --executor codex-cli-dry-run
node dist/cli.js run "Review evidence" --reviewer local-evidence
node dist/cli.js run "Machine-readable smoke" --max-iterations 1 --json
node dist/cli.js resume run_xxx --max-iterations 1 --json
node dist/cli.js status
node dist/cli.js status --json
node dist/cli.js status run_xxx --json --raw
node dist/cli.js checkpoint
node dist/cli.js checkpoint --json
node dist/cli.js checkpoint --github gh-cli --json
node dist/cli.js checks HEAD --json
node dist/cli.js pr-plan --json
node dist/cli.js approve-pr --approved-by maintainer --reason "Reviewed checkpoint and PR plan" --json
node dist/cli.js pr-exec --json
node dist/cli.js pr-exec --execute --approval approval_xxx --json
node dist/cli.js pr-exec --execute --approved-by maintainer --json
```

Runs are stored as JSON files under `.orchestrator/runs/<runId>.json`.
Checkpoint reports are stored as JSON files under `.orchestrator/checkpoints/<checkpointId>.json`.
Approval records are stored as JSON files under `.orchestrator/approvals/<approvalId>.json`.

## Local Package Install

The package is prepared for local installation through its `bin` entry, but it is not published to npm yet. `npm pack` runs the `prepack` script, which rebuilds `dist` before creating the tarball. The build also marks `dist/cli.js` executable for local tarball installs.

Run the repeatable package smoke before publishing or handing off an installable tarball:

```bash
pnpm run package:smoke
```

The smoke script packs the current checkout, installs the tarball into a temporary project, and runs the installed `task-loop-orchestrator` binary. It verifies the core `--json` flows for `init`, `doctor`, `run`, `resume`, `status`, `checkpoint`, `pr-plan`, `pr-exec`, `approve-pr`, and `checks`, while keeping all writes inside the temporary project.

If it fails, the error includes the package smoke step label, command, cwd, exit code, and short stdout/stderr excerpts. It never creates GitHub PRs, merges, pushes, releases, or publishes to npm.

```bash
pnpm run build
npm pack --dry-run
npm pack --pack-destination /tmp
```

Install the packed tarball into a temporary project and run the installed command:

```bash
tmpdir="$(mktemp -d)"
npm install --prefix "$tmpdir" /tmp/task-loop-orchestrator-0.1.0.tgz
"$tmpdir/node_modules/.bin/task-loop-orchestrator" --help
```

After installing the package in a target project, initialize local orchestrator files before the first run:

```bash
task-loop-orchestrator doctor
task-loop-orchestrator init
task-loop-orchestrator doctor --github gh-cli
task-loop-orchestrator run "Smoke task" --max-iterations 1 --json
task-loop-orchestrator checkpoint --github gh-cli --json
```

For a fuller smoke test, initialize a temporary Git repository before running the loop so repo evidence commands have a local repository to inspect:

```bash
tmpdir="$(mktemp -d)"
npm install --prefix "$tmpdir" /tmp/task-loop-orchestrator-0.1.0.tgz
git -C "$tmpdir" init
"$tmpdir/node_modules/.bin/task-loop-orchestrator" init --json
"$tmpdir/node_modules/.bin/task-loop-orchestrator" run "Smoke task" --max-iterations 1
```

`init [--force] [--json]` prepares a project for local orchestrator state:

- creates `orchestrator.config.json` from the default config when it does not exist
- creates `.gitignore` when missing
- appends `.orchestrator/` to `.gitignore` when needed
- preserves existing file contents and ordering
- skips an existing `orchestrator.config.json` unless `--force` is provided

Use `--json` to see structured `created`, `updated`, and `skipped` statuses for each file.

`doctor [--github none|gh-cli] [--json]` diagnoses the current project without writing files. Before `init`, it can point out missing config or `.gitignore` entries and recommend `task-loop-orchestrator init`. After `init`, it checks Node 24+, Git repository status, config loadability, `.orchestrator/` ignore coverage, and non-destructive store path accessibility.

With `--github gh-cli`, doctor also attempts read-only GitHub repository and check-status diagnostics through `gh`. Missing `gh`, failed auth, missing checks, or insufficient repository access are reported as graceful warnings with recommended actions; doctor does not create or modify GitHub resources.

Doctor JSON includes structured `suggestions` on checks when there is a useful follow-up command. Each suggestion has a label, command array, reason, and `destructive` flag so automation or UI layers can present the action safely. Suggestions are candidates only; doctor never executes them.

## Loop Model

The Root Orchestrator owns context and graph mutation. Planner, Executor, and Reviewer providers return reports and context deltas only.

Each run includes an audit trail in `events`. Current event kinds include discovery, planning, subtask selection, execution start/completion, review completion, context updates, graph updates, permission denial, and final run state events.

The verify step also records `verification_evidence_collected` before reviewer execution when local evidence is gathered.

Checkpoint generation records `integration_checkpoint_ready` on the run after a checkpoint report is saved.

`resume --max-iterations n` treats `n` as additional iterations from the loaded run's current `iterations` count.

`run --json`, `resume --json`, and `status --json` return a stable automation-friendly report with `runId`, status, iterations, permission mode, task summary, subtask counts, saved path, and the full run object. Prefer these JSON forms when integrating with scripts or UI. Use `status <runId> --json --raw` only when you need the stored raw `LoopRun` shape.

## JSON Output

JSON commands include lightweight schema metadata while preserving existing top-level payload fields:

```json
{
  "schemaVersion": 1,
  "command": "run",
  "createdAt": "2026-06-22T00:00:00.000Z"
}
```

The metadata is applied to every current `--json` command: `init`, `doctor`, `run`, `resume`, `status`, `checkpoint`, `checks`, `pr-plan`, `pr-exec`, and `approve-pr`. Command-specific payload fields remain at the top level for compatibility.

See [docs/json-output.md](docs/json-output.md) for the full CLI JSON contract. A machine-readable schema for the common envelope is available at [schemas/cli-json.schema.json](schemas/cli-json.schema.json).

## Permission Modes

- `read`: permits `read_state` only.
- `write`: permits `create_branch`, `write_file`, `run_tests`, `commit`, and `create_pr`. `push` is intentionally denied in write mode until an explicit approval flow exists.
- `maintainer`: permits privileged actions such as `push`, `merge_pr`, `jira_transition`, and `release`, but those actions are decision-ready boundaries for now and are not auto-executed by the mock loop.

Denied actions append a `permission_denied` event and block the run.

## Providers

External integrations are provider interfaces only at this stage. The default repo provider is mock-backed and does not call GitHub, Jira, Codex, or the network.

The CLI uses a read-focused Git repo provider for discovery. It reads `git status --short` and `git diff --stat` only. Branch and worktree creation are represented as permission-gated dry-run boundaries, not executed.

GitHub status is optional and disabled by default. `--github gh-cli` enables a read-only GitHub CLI provider for checkpoint checks. It uses `gh repo view`, `gh pr list`, and `gh pr checks`; it does not create or modify PRs, issues, releases, merges, or repository state. If `gh` is missing, unauthenticated, or cannot read the repository, checkpoint generation falls back to an `unknown` or `not_found` CI summary instead of failing.

When PR checks are not available, the GitHub CLI provider falls back to read-only `gh api repos/{owner}/{repo}/commits/{ref}/check-runs` so branch or commit check-runs can still populate checkpoint `ciCheck`. `gh auth status` is useful for local setup, but failed auth remains a graceful checkpoint fallback.

`checks [ref] [--json]` is a read-only shortcut for refreshing GitHub check status without creating a new checkpoint. The default ref is `HEAD`. Queued or in-progress GitHub Actions check-runs are reported as `pending`; missing checks or auth failures still return a JSON summary with exit code 0.

## Executor Modes

- `mock`: default executor; returns a deterministic mock `RoleReport`.
- `codex-cli-dry-run`: builds the Codex CLI command for one bounded subtask and records it in the executor report/context delta without running Codex.
- `codex-cli`: recognized by config and CLI, but actual execution is currently blocked unless a future explicit opt-in execution path is added.

Executor input is scoped to exactly one selected subtask. The Root Orchestrator passes `runId`, `subtaskId`, task summary, bounded goal, non-goals, context summary, permission mode, and worktree/branch hint. Executors must return `RoleReport` and optional `contextDelta`; they do not mutate context or graph directly.

## Config

Optional config file: `orchestrator.config.json`.

```json
{
  "executor": "mock",
  "reviewer": "mock",
  "github": "none",
  "permissionMode": "write",
  "worktree": {
    "enabled": false
  },
  "maxIterations": 10
}
```

CLI flags override config for the current command where supported, for example `--executor codex-cli-dry-run` or `--permission read`.

## Reviewer Modes

- `mock`: default reviewer; accepts successful executor reports so the basic smoke loop can complete.
- `local-evidence`: structured read-only reviewer adapter. It consumes collected evidence and returns a verdict without mutating context or graph.

Reviewer verdicts:

- `accept`: evidence is sufficient for this local adapter.
- `request_changes`: executor failed, executor only produced dry-run evidence, or reviewer cannot accept the result.
- `reschedule`: reserved for future scheduling/retry policy.
- `owner_decision`: human decision is needed, for example when acceptance criteria are missing.

Evidence currently includes executor summary, executor command when present, repo status, diff stat, test result placeholder, and acceptance criteria coverage. `local-evidence` is intentionally conservative: Codex dry-run output alone is not accepted as completed work.

## Integration Checkpoints

`checkpoint [runId] [--github none|gh-cli] [--json]` creates a read-only decision-ready brief for the latest run or a specific run. It reads repo status and diff stat, summarizes graph counts, lists conflict risks, carries owner decision items forward, and recommends the next action.

With `--github gh-cli`, checkpoint `ciCheck` is populated from GitHub checks when available. Without it, `ciCheck` remains a safe `not_run` placeholder.

After pushing to `main`, use `node dist/cli.js checks HEAD --json` for a quick CI refresh, or rerun `node dist/cli.js checkpoint --github gh-cli --json` when you want a new decision-ready checkpoint brief.

Checkpoint status:

- `clean`: all subtasks are complete and repo evidence has no attention markers.
- `needs_attention`: pending/active work, graph conflicts, or repo status/diff evidence needs review.
- `blocked`: blocked/failed subtasks or reviewer `owner_decision` items must be resolved.

Maintainer actions such as `create_pr`, `merge_pr`, and `release` are emitted only as decision-ready candidates. Checkpoint generation never creates branches, worktrees, commits, pushes, PRs, merges, releases, Jira transitions, or GitHub/Jira API calls.

## PR Plans

`pr-plan [runId] [--json]` creates a decision-ready PR preparation report for the latest run or a specific run. It uses the latest checkpoint for that run when available and reads local repo status/diff before suggesting any commands.

The plan includes a source branch hint, base branch, PR title/body, preconditions, blocked reasons, and command candidates for branch creation, commit, push, and PR creation. These commands are dry-run candidates only. The orchestrator does not create branches, commit, push, or call `gh pr create`.

A non-clean checkpoint or dirty repository is reported in `blockedReasons`; users must resolve those before treating the PR plan as ready for execution.

`approve-pr [runId] --approved-by name [--reason text] [--json]` creates and stores an audit-friendly approval record for the latest PR plan shape. The record includes the approved run id, checkpoint id, plan id, and a minimal plan snapshot: title, base branch, source branch hint, blocked reasons, and command candidate actions.

`pr-exec [runId] [--execute] [--approval approvalId] [--approved-by name] [--json]` creates an approval-aware execution preflight report from the PR plan. The default mode is dry-run and never executes commands. `--execute` requires approval data, but write execution is still blocked at the boundary until a later implementation adds an explicit, audited command runner. If `--approval` is omitted, `pr-exec` tries the latest stored approval for the run; `--approved-by` can still create an in-memory approval for one-off preflight checks.

Stored approvals are tied to the checkpoint that was current when approval was recorded. During `pr-exec --execute`, both explicit `--approval approvalId` and latest-approval lookup are checked against the current latest checkpoint for the run. If the checkpoint changed, the approval is treated as stale and execution preflight is blocked before any write command can run. In-memory approvals from `--approved-by` are created from the current plan and are not stale.

Current approval model:

- no `--execute`: returns `dry_run` with command candidates and no executed commands
- `--execute` without `--approved-by`: returns `blocked`
- `approve-pr --approved-by name`: persists an approval under `.orchestrator/approvals`
- `pr-exec --execute --approval approvalId`: loads the stored approval, blocks stale checkpoint approvals, then still blocks before branch/commit/push/PR creation because write execution is not implemented
- `pr-exec --execute --approved-by name`: creates an in-memory approval for preflight, then still blocks before write execution

## CI

GitHub Actions CI is defined in `.github/workflows/ci.yml` and runs on pull requests and pushes to `main`. It uses Node 24 with Corepack/pnpm cache, installs with `pnpm install --frozen-lockfile`, then runs typecheck, tests, build, and `pnpm run package:smoke`. The package smoke step verifies `npm pack`, temporary install, installed binary help, project bootstrap, JSON command contracts, read-only checkpoint/PR preflight flows, and CI check refresh diagnostics.

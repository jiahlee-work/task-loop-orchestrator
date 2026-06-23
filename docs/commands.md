# CLI Command Reference

This reference covers the commands currently implemented by `task-loop-orchestrator`. Commands that produce JSON include the common CLI JSON metadata described in [json-output.md](json-output.md).

The current CLI does not create GitHub PRs, merge, push, publish, create tags, or create GitHub releases. PR-related commands produce decision-ready plans, stored approvals, and dry-run or blocked preflight reports.

## Global Flags

### `--help`, `-h`

Purpose: Print command usage.

Example:

```bash
task-loop-orchestrator --help
```

JSON: not supported.

Behavior: read-only; no files or external systems are modified.

### `--version`, `-v`

Purpose: Print the installed CLI version.

Example:

```bash
task-loop-orchestrator --version
```

JSON: not supported.

Behavior: read-only; no files or external systems are modified.

## Project Setup

### `init [--force] [--json]`

Purpose: Prepare a project for local orchestrator state.

Example:

```bash
task-loop-orchestrator init --json
```

JSON: supported with `--json`.

Behavior: writes local bootstrap files only. It creates `orchestrator.config.json` when missing and ensures `.gitignore` contains `.orchestrator/`. Existing config is not overwritten unless `--force` is provided.

### `doctor [--github none|gh-cli] [--json]`

Purpose: Diagnose whether the current project is ready to use the orchestrator.

Example:

```bash
task-loop-orchestrator doctor --github gh-cli --json
```

JSON: supported with `--json`.

Behavior: read-only. With `--github gh-cli`, it performs read-only GitHub CLI diagnostics and reports missing `gh`, auth failures, or unavailable checks as warnings instead of writing repository state.

## Run Loop

### `run <title> [options] [--json]`

Purpose: Start a new closed-loop orchestrator run.

Example:

```bash
task-loop-orchestrator run "Quickstart smoke" --max-iterations 1 --json
```

Useful options:

- `--description text`
- `--permission read|write|maintainer`
- `--executor mock|codex-cli-dry-run|codex-cli`
- `--reviewer mock|local-evidence`
- `--max-iterations n`

JSON: supported with `--json`.

Behavior: writes run state under `.orchestrator/runs/`. Default mock roles and dry-run adapters do not call external write-side systems.

### `resume <runId> [--max-iterations n] [--json]`

Purpose: Continue an existing run for additional iterations.

Example:

```bash
task-loop-orchestrator resume run_xxx --max-iterations 1 --json
```

JSON: supported with `--json`.

Behavior: reads and updates local run state. `--max-iterations` is interpreted as additional iterations from the loaded run.

### `status [runId] [--json] [--raw]`

Purpose: Inspect the latest run or a specific run.

Example:

```bash
task-loop-orchestrator status --json
task-loop-orchestrator status run_xxx --json --raw
```

JSON: supported with `--json`. Use `--json --raw` to print the stored raw `LoopRun` shape.

Behavior: read-only. It does not modify local state or external systems.

## Integration Status

### `checkpoint [runId] [--github none|gh-cli] [--json]`

Purpose: Create a read-only integration checkpoint brief for the latest run or a specific run.

Example:

```bash
task-loop-orchestrator checkpoint --github gh-cli --json
```

JSON: supported with `--json`.

Behavior: reads local repo evidence and optionally read-only GitHub check summaries. It saves checkpoint JSON under `.orchestrator/checkpoints/` and appends a run audit event. It never creates branches, commits, pushes, PRs, merges, releases, Jira transitions, or GitHub/Jira write calls.

### `checks [ref] [--json]`

Purpose: Refresh GitHub check status without creating a checkpoint.

Example:

```bash
task-loop-orchestrator checks HEAD --json
```

JSON: supported with `--json`.

Behavior: read-only. It uses the GitHub CLI provider and gracefully returns `unknown` or `not_found` when `gh`, auth, repository data, or check-runs are unavailable.

## PR Planning And Approval

### `pr-plan [runId] [--json]`

Purpose: Build a decision-ready PR preparation plan from the latest run or a specific run.

Example:

```bash
task-loop-orchestrator pr-plan --json
```

JSON: supported with `--json`.

Behavior: read-only planning. It may include command candidates for branch creation, commit, push, and PR creation, but it does not execute them.

### `approve-pr [runId] --approved-by name [--reason text] [--json]`

Purpose: Store an audit-friendly approval record for the current PR plan shape.

Example:

```bash
task-loop-orchestrator approve-pr --approved-by maintainer --reason "Reviewed checkpoint and PR plan" --json
```

JSON: supported with `--json`.

Behavior: writes an approval record under `.orchestrator/approvals/`. It does not create or modify branches, commits, pushes, PRs, merges, releases, issues, or external systems.

### `pr-exec [runId] [--execute] [--approval approvalId] [--approved-by name] [--json]`

Purpose: Produce an approval-aware PR execution preflight report.

Example:

```bash
task-loop-orchestrator pr-exec --json
task-loop-orchestrator pr-exec --execute --approval approval_xxx --json
```

JSON: supported with `--json`.

Behavior: dry-run by default. `--execute` requires approval data, checks stale approvals, and still blocks before write-side execution in the current implementation. `executedCommands` remains empty; branch creation, commit, push, and `gh pr create` are not run. The future write execution design draft is documented in [design/write-execution-model.md](design/write-execution-model.md).

## Execution Audit

### `execution-audit --intent intentId --json`

Purpose: Inspect a persisted execution intent and its matching dry-run traces as a read-only audit bundle.

Example:

```bash
task-loop-orchestrator execution-audit --intent intent_xxx --json
```

JSON: supported with `--json`.

Behavior: read-only. It reads `.orchestrator/execution-intents/` and `.orchestrator/execution-traces/` through the local file store and returns the audit bundle described in [json-output.md](json-output.md). It does not write files, does not execute commands, and does not create branches, commits, pushes, PRs, merges, releases, approvals, tags, or GitHub releases. `--all` and plain output are not implemented yet.

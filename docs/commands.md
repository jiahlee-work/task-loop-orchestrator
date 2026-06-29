# CLI Command Reference

This reference covers the commands currently implemented by `task-loop-orchestrator`. The preferred installed command is `tlo`; the longer `task-loop-orchestrator` binary remains available for compatibility. Commands that produce JSON include the common CLI JSON metadata described in [json-output.md](json-output.md).

The current CLI does not create GitHub PRs, merge, push, publish, create tags, or create GitHub releases. PR-related commands produce decision-ready plans, stored approvals, and dry-run or blocked preflight reports.

## Global Flags

### `--help`, `-h`

Purpose: Print command usage.

Example:

```bash
tlo --help
```

JSON: not supported.

Behavior: read-only; no files or external systems are modified.

### `--version`, `-v`

Purpose: Print the installed CLI version.

Example:

```bash
tlo --version
```

JSON: not supported.

Behavior: read-only; no files or external systems are modified.

## Project Setup

### `init [--force] [--json]`

Purpose: Prepare a project for local orchestrator state.

Example:

```bash
tlo init --json
```

JSON: supported with `--json`.

Behavior: writes local bootstrap files only. It creates `orchestrator.config.json` when missing and ensures `.gitignore` contains `.orchestrator/`. Existing config is skipped unless `--force` is provided, so rerunning `init` is safe. The CLI resolves the target repository with `git rev-parse --show-toplevel`; if the current directory is not inside a Git repository, `init` uses the current directory and prints a warning because Codex execution needs Git worktree support.

### `setup [jira|gemini|openai] [options]`

Purpose: Save local provider credentials for the current project.

Example:

```bash
tlo setup
tlo setup jira
tlo setup jira --url https://company.atlassian.net --username me@company.com --api-token "$JIRA_API_TOKEN"
tlo setup gemini
tlo setup gemini --api-key "$GEMINI_API_KEY" --model gemini-2.5-flash
tlo setup openai
tlo setup openai --api-key "$OPENAI_API_KEY" --model gpt-5.1
```

JSON: not supported.

Behavior: without a provider argument, `setup` walks through Jira, Gemini, Codex CLI, and OpenAI in that order. Each slow provider check prints a progress line before it starts. Jira is optional in the all-in-one setup because it is only needed for issue-key runs such as `tlo run OUC-10`; skip it for direct runs such as `tlo run "task instruction"` or pass `--skip-jira` in non-interactive use. Codex CLI does not require a token in `tlo`; the CLI checks the local `codex` command and reuses the user's local `codex login` state. With a provider argument, `setup` updates only that provider, so `tlo setup jira` still requires Jira credentials. It writes provider env files such as `.orchestrator/jira.env`, `.orchestrator/gemini.env`, and `.orchestrator/openai.env` with file mode `0600`, so only the local file owner can read or update them. The files are under `.orchestrator/`, which `init` adds to `.gitignore`. Gemini setup expects a Gemini API key from [Google AI Studio API Keys](https://aistudio.google.com/app/apikey). OpenAI setup expects an OpenAI API key from [OpenAI API keys](https://platform.openai.com/api-keys). By default the command verifies that the configured MCP server exposes the Jira issue read tool, that the Gemini planner model responds, or that the OpenAI reviewer model responds; use `--skip-check` to save credentials without a live verification call.

### `doctor [codex|jira|gemini|openai] [--github none|gh-cli] [--json]`

Purpose: Diagnose whether the current project is ready to use the orchestrator.

Example:

```bash
tlo doctor --github gh-cli --json
tlo doctor codex
tlo doctor jira
tlo doctor gemini
tlo doctor openai
```

JSON: supported with `--json`.

Behavior: read-only. It checks Node.js, Git repository presence, config loading, `.gitignore`, store path access, Codex CLI command/auth readiness, optional read-only GitHub CLI diagnostics, optional Jira MCP availability, optional Gemini planner availability, and optional OpenAI reviewer availability instead of writing repository state. Codex diagnostics verify the local `codex` command and local login state; `tlo` does not ask for a Codex API key and reuses `codex login`. Jira MCP diagnostics distinguish missing `.orchestrator/jira.env` credentials, missing `uvx`, MCP server startup/query failures, and a missing `jira_get_issue` tool. Gemini diagnostics distinguish missing `.orchestrator/gemini.env` credentials from model/API verification failures. OpenAI diagnostics distinguish missing `.orchestrator/openai.env` credentials from model/API verification failures. When MCP is unavailable and CLI fallback is enabled, it also reports local Jira CLI availability. Warnings and failures include a short recommended action and safe command suggestions where available.

## Run Loop

### `run ISSUE-KEY [--note text] [options] [--json]`

Purpose: Start a new closed-loop orchestrator run.

Example:

```bash
tlo run ABC-123
tlo run ABC-123 --note "이번에는 UI 문구까지 같이 정리해줘"
tlo run "README의 설치 흐름을 현재 CLI 기준으로 정리해줘"
tlo run "Quickstart smoke" --max-iterations 1 --json
```

Useful options:

- `--description text`
- `--jira ISSUE-KEY` for scripts that prefer flags over positional input
- `--note text`
- `--planner mock|gemini`
- `--permission read|write|maintainer`
- `--executor mock|codex-cli-dry-run|codex-cli`
- `--reviewer mock|local-evidence|openai`
- `--max-iterations n`

JSON: supported with `--json`.

Behavior: `run` is the normal starting point and writes run state under `.orchestrator/runs/<runId>/` in the target repository. The user-facing run directory contains `root-contract.json`, `task-tree.json`, `state.json`, and `summary.md`; a compatibility `loop-run.json` snapshot remains for current `status`, `resume`, checkpoint, and PR-planning flows. It checks required provider setup before creating a run file. If the default Gemini Planner or OpenAI Reviewer credentials are missing, it exits with `Failed: Run`, explains the missing setup, and suggests the matching setup command. In a normal terminal, `run` reads the task, creates a Gemini root contract and task tree, prints the plan approval preview, and asks `Approve this plan and start execution? [y/N]`. If the user answers `n`, the CLI asks for a revision request and sends that revision back into planning; a blank revision stops before execution. If the user approves, Codex CLI creates a Git worktree from the target repository at `.orchestrator/dev-workspaces/<runId>/<subtaskId>/`, runs there with `workspace-write` sandboxing, then the OpenAI Reviewer reviews collected evidence. When the first argument is exactly a Jira issue key, the command reads that issue through the configured Jira provider and converts the issue plus optional `--note` into the run `TaskSpec`. Jira notes must use `--note`; inline forms such as `tlo run ABC-123 with "..."` are rejected so the input model stays unambiguous. If a direct task starts with an issue-like token, quote the whole task: `tlo run "ABC-123 refactor the sidebar"`. The default provider launches the `mcp-atlassian` MCP server directly through stdio when `JIRA_URL` and Jira auth environment variables are present; local Jira CLI remains a fallback. If issue reading fails, the output suggests `tlo doctor jira` or the specific setup command to run next. `--json` is intended for automation and does not ask interactive approval questions. It does not create GitHub PRs or Jira transitions; run providers do not call external write-side systems such as GitHub mutation, push, release, or publish.

### `resume <runId> [--max-iterations n] [--json]`

Purpose: Continue an existing run for additional iterations.

Example:

```bash
task-loop-orchestrator resume <runId> --max-iterations 1 --json
```

JSON: supported with `--json`.

Behavior: reads and updates local run state. Use the `runId` returned by `run --json`, then verify the resumed run with `status <runId> --json`. `--max-iterations` is interpreted as additional iterations from the loaded run. Missing run ids return a clear `not_found` JSON response when `--json` is used.

### `status [runId] [--json] [--raw]`

Purpose: Inspect the latest run or a specific run.

Example:

```bash
task-loop-orchestrator status --json
task-loop-orchestrator status <runId> --json --raw
```

JSON: supported with `--json`. Use `--json --raw` to print the stored raw `LoopRun` shape.

Behavior: read-only. It does not modify local state or external systems. Without `runId`, it reports the latest run; with `runId`, it reports that specific run. In an empty project, `status --json` returns `status: "not_found"` and `run: null` with a message that points back to `tlo run "task instruction" --json`.

### `history [--json]`

Purpose: List local runs with compact progress and root-decision summaries.

Example:

```bash
tlo history
tlo history --json
```

JSON: supported with `--json`.

Behavior: read-only. It lists runs from `.orchestrator/runs/` in newest-first order and includes each run's status, subtask counts, latest root decision, and owner-decision count. It does not modify local state or external systems.

### `report [runId] [--json]`

Purpose: Write a local markdown summary for a run.

Example:

```bash
tlo report
tlo report <runId> --json
```

JSON: supported with `--json`.

Behavior: writes only `.orchestrator/runs/<runId>/report.md` in the local project. Without `runId`, it uses the latest run. The report summarizes counts, latest root decision, owner-decision items, blocked or failed subtasks, and recent events. It does not create branches, commits, pushes, PRs, Jira transitions, releases, or external writes.

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

### `execution-audit (--intent intentId|--all) [--json]`

Purpose: Inspect one persisted execution intent and its matching dry-run traces, or list all persisted execution audit bundles, as read-only audit output.

Example:

```bash
task-loop-orchestrator execution-audit --intent intent_xxx
task-loop-orchestrator execution-audit --intent intent_xxx --json
task-loop-orchestrator execution-audit --all
task-loop-orchestrator execution-audit --all --json
```

JSON: supported with `--json`.

Behavior: read-only. It reads `.orchestrator/execution-intents/` and `.orchestrator/execution-traces/` through the local file store and returns a human-readable audit summary by default, or the audit bundle/list wrapper described in [json-output.md](json-output.md) when `--json` is used. Missing intents, missing `--intent`, and invalid persisted audit files return JSON error envelopes with disabled execution markers in JSON mode and short safe plain errors otherwise. It does not write files, does not execute commands, and does not create branches, commits, pushes, PRs, merges, releases, approvals, tags, or GitHub releases.

### `write-readiness --intent intentId [--preflight path] [--json]`

Purpose: Summarize whether one persisted execution intent is ready, blocked, or unknown using the read-only execution audit bundle.

Example:

```bash
task-loop-orchestrator write-readiness --intent intent_xxx
task-loop-orchestrator write-readiness --intent intent_xxx --json
task-loop-orchestrator write-readiness --intent intent_xxx --preflight readiness-preflight.json
task-loop-orchestrator write-readiness --intent intent_xxx --preflight readiness-preflight.json --json
```

JSON: supported with `--json`.

Behavior: read-only. It reads `.orchestrator/execution-intents/` and `.orchestrator/execution-traces/`, derives an audit bundle, and calls the readiness helper. Plain output is for human terminal review; `--json` is the stable automation contract. Plain and JSON modes can read a safe preflight evidence file with `--preflight <path>`; loader/parser failures return short safe plain errors or JSON error envelopes instead of partial success. Missing intents, missing `--intent`, and invalid persisted audit files return JSON error envelopes with disabled execution markers in JSON mode and short safe plain errors otherwise. It does not write files, does not execute commands, does not query GitHub, and does not create branches, commits, pushes, PRs, merges, releases, approvals, tags, or GitHub releases.

### `write-runner --intent intentId [--preflight path] [--simulate|--execute] --json`

Purpose: Produce an audited write runner dry-run or simulated execution boundary report for one persisted execution intent.

Example:

```bash
task-loop-orchestrator write-runner --intent intent_xxx --preflight readiness-preflight.json --json
task-loop-orchestrator write-runner --intent intent_xxx --preflight readiness-preflight.json --simulate --json
task-loop-orchestrator write-runner --intent intent_xxx --preflight readiness-preflight.json --execute --json
task-loop-orchestrator write-runner --intent intent_xxx --json
```

JSON: supported with `--json`.

Behavior: dry-run/simulate and JSON-only in the current implementation; `--json` is required. It reads `.orchestrator/execution-intents/` and `.orchestrator/execution-traces/`, optionally reads the same safe preflight evidence file accepted by `write-readiness`, and computes readiness before planning. Default mode is `dry_run`. `--simulate` uses a deterministic safe executor boundary that returns symbolic simulation results only; it does not run shell, git, or GitHub commands. `--execute` returns an `execute_disabled` policy/report and still performs no actual write execution. When readiness is `ready`, dry-run or simulate mode writes local dry-run trace records under `.orchestrator/execution-traces/` as audit artifacts and returns safe plan items without raw command arguments. When readiness is `blocked` or `unknown`, it returns a blocked dry-run report and does not save new traces. It does not execute commands, does not create branches, commits, pushes, GitHub PRs, merges, releases, approvals, tags, or GitHub releases, and does not expose raw stdout, stderr, exit codes, stacks, or executed command results.

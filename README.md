# task-loop-orchestrator

MVP scaffold for an AI role-split closed-loop task orchestrator.

## Commands

```bash
pnpm run build
pnpm test
pnpm run typecheck
pnpm run lint
```

Run a local loop:

```bash
pnpm run build
node dist/cli.js run "Create MVP scaffold" --description "Exercise the mock closed loop"
node dist/cli.js run "Prepare executor adapter" --executor codex-cli-dry-run
node dist/cli.js run "Review evidence" --reviewer local-evidence
node dist/cli.js status
node dist/cli.js status --json
node dist/cli.js checkpoint
node dist/cli.js checkpoint --json
node dist/cli.js checkpoint --github gh-cli --json
```

Runs are stored as JSON files under `.orchestrator/runs/<runId>.json`.
Checkpoint reports are stored as JSON files under `.orchestrator/checkpoints/<checkpointId>.json`.

## Loop Model

The Root Orchestrator owns context and graph mutation. Planner, Executor, and Reviewer providers return reports and context deltas only.

Each run includes an audit trail in `events`. Current event kinds include discovery, planning, subtask selection, execution start/completion, review completion, context updates, graph updates, permission denial, and final run state events.

The verify step also records `verification_evidence_collected` before reviewer execution when local evidence is gathered.

Checkpoint generation records `integration_checkpoint_ready` on the run after a checkpoint report is saved.

`resume --max-iterations n` treats `n` as additional iterations from the loaded run's current `iterations` count.

## Permission Modes

- `read`: permits `read_state` only.
- `write`: permits `create_branch`, `write_file`, `run_tests`, `commit`, and `create_pr`. `push` is intentionally denied in write mode until an explicit approval flow exists.
- `maintainer`: permits privileged actions such as `push`, `merge_pr`, `jira_transition`, and `release`, but those actions are decision-ready boundaries for now and are not auto-executed by the mock loop.

Denied actions append a `permission_denied` event and block the run.

## Providers

External integrations are provider interfaces only at this stage. The default repo provider is mock-backed and does not call GitHub, Jira, Codex, or the network.

The CLI uses a read-focused Git repo provider for discovery. It reads `git status --short` and `git diff --stat` only. Branch and worktree creation are represented as permission-gated dry-run boundaries, not executed.

GitHub status is optional and disabled by default. `--github gh-cli` enables a read-only GitHub CLI provider for checkpoint checks. It uses `gh repo view`, `gh pr list`, and `gh pr checks`; it does not create or modify PRs, issues, releases, merges, or repository state. If `gh` is missing, unauthenticated, or cannot read the repository, checkpoint generation falls back to an `unknown` or `not_found` CI summary instead of failing.

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

Checkpoint status:

- `clean`: all subtasks are complete and repo evidence has no attention markers.
- `needs_attention`: pending/active work, graph conflicts, or repo status/diff evidence needs review.
- `blocked`: blocked/failed subtasks or reviewer `owner_decision` items must be resolved.

Maintainer actions such as `create_pr`, `merge_pr`, and `release` are emitted only as decision-ready candidates. Checkpoint generation never creates branches, worktrees, commits, pushes, PRs, merges, releases, Jira transitions, or GitHub/Jira API calls.

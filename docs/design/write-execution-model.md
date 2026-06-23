# Approval-Gated Write Execution Model

Status: design draft, not enabled.

This document describes the model that should exist before `task-loop-orchestrator` can execute branch, commit, push, or PR creation commands. It is not an implementation plan approval and does not enable write execution. The current CLI must continue to block before write-side command execution.

## Current State

- `pr-plan` produces decision-ready command candidates only.
- `approve-pr` stores approval records under `.orchestrator/approvals/`.
- Execution intents can be persisted under `.orchestrator/execution-intents/` for future audited write execution.
- Execution intent read-only reports summarize stored intents for audit without running commands.
- Execution dry-run trace records can be persisted under `.orchestrator/execution-traces/` to model future command-runner audit entries without spawning commands.
- Execution audit bundles can group an intent with matching dry-run traces for read-only review while excluding unrelated trace records.
- The file store can assemble execution audit bundles from persisted intents and traces without writing files or running commands.
- The audit bundle JSON contract is covered by internal tests before any CLI read surface is enabled.
- A future read-only CLI surface for audit bundle lookup is drafted in [`execution-audit-cli.md`](execution-audit-cli.md) but is not enabled.
- `pr-exec` is dry-run/preflight oriented.
- `pr-exec --execute` requires approval data, checks stale approvals, and still returns a blocked report before branch, commit, push, or `gh pr create`.
- `executedCommands` remains empty in the current implementation.

## Threat Model

- Stale approval: approval was granted for an older checkpoint or plan.
- Plan drift: command candidates changed after approval.
- Command injection: untrusted task, run, or branch data changes the intended command.
- Wrong branch or ref: execution targets the wrong base branch, source branch, or commit.
- Dirty worktree: local state changed after checkpoint or approval.
- Failed or pending checks: CI status no longer satisfies the execution policy.
- Missing audit trail: approval, preflight, command result, or failure reason cannot be reconstructed.
- Secret leakage: command output logs tokens, credentials, or private diff content.

## Required State

Future write execution should require a persisted execution intent with:

- approval id
- approved plan fingerprint
- checkpoint id
- run id
- actor
- reason
- createdAt
- expiresAt
- target ref
- base branch
- source branch
- command candidates
- expected permission mode
- policy version

The plan fingerprint should cover at least the plan id, checkpoint id, run id, base branch, source branch hint, blocked reasons, and command candidate actions/arguments.

## Execution Preconditions

Write execution must remain blocked unless all preconditions pass:

- explicit `--execute` was provided
- approval exists and has status `approved`
- approval is not stale
- approval is not expired
- approved plan fingerprint matches the current plan fingerprint
- latest checkpoint matches the approved checkpoint id
- worktree is clean or the dirty state is explicitly part of the approved plan
- target ref and current branch match policy
- CI/check status satisfies policy
- permission gate allows the specific action
- command candidate is from the approved plan, not user-supplied free text
- command runner is configured for write execution and not in dry-run mode

## Command Runner Stages

The command runner should execute one bounded command at a time:

1. Prepare: resolve the approved command candidate and create an execution record.
2. Verify: re-read repo state, checkpoint state, approval state, and policy state.
3. Execute: run one bounded command with fixed args and no shell interpolation.
4. Record: persist exit code, timestamps, stdout/stderr summaries, and resulting repo state.
5. Stop: stop on failure, stale state, unexpected output, or policy mismatch.

Commands should use structured argv arrays rather than shell strings.

## Audit Requirements

Each execution attempt should record:

- execution intent id
- approval id
- plan id and plan fingerprint
- checkpoint id
- actor and reason
- command candidate action
- command argv
- startedAt and completedAt
- exit code
- stdout/stderr summaries
- before and after repo status
- before and after HEAD/ref information
- policy decision and failure reason

Audit logs must avoid recording secrets. Full stdout/stderr should not be persisted by default; summaries and redacted excerpts are safer.

## Rollout Slices

1. Persist execution intents without running commands.
2. Add read-only execution intent reports for audit before any command runner exists.
3. Add command runner dry-run trace records that mirror the future audit shape without spawning commands.
4. Add read-only audit bundles that group intents with matching dry-run traces.
5. Add store-level read-only audit bundle assembly from persisted intent and trace records.
6. Guard the audit bundle JSON contract with internal fixture-style tests before exposing it through CLI JSON.
7. Design the read-only `execution-audit` CLI surface before enabling it.
8. Add a single local-only command behind tests and explicit approval, such as branch creation in a temporary fixture repository.
9. Add commit execution only after staged-file policy and diff verification exist.
10. Add push only after remote/ref policy and CI handling are documented and tested.
11. Add GitHub PR creation only after push policy, approval freshness, and `gh pr create` argument construction are covered.

## Hard Non-Goals

These remain out of scope for this model until separately designed and explicitly approved:

- npm publish
- git tag creation
- GitHub release creation
- merge
- issue close or transition
- Jira transition
- arbitrary shell command execution
- long-running Codex CLI execution

## Open Questions

- How should plan fingerprints be serialized and versioned?
- What is the default approval expiration window?
- Which CI/check statuses are sufficient for `create_pr`?
- Should branch creation require a clean worktree or only a known HEAD?
- Where should redaction rules live for command output summaries?

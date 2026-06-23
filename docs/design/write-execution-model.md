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
- A read-only CLI surface for audit bundle lookup is enabled for `execution-audit --intent <intentId>` and `execution-audit --all` in both plain and JSON modes, as documented in [`execution-audit-cli.md`](execution-audit-cli.md).
- A pure write execution readiness helper can summarize an audit bundle plus optional future preflight input without enabling CLI/schema output or command execution.
- `write-readiness --intent <intentId> --json` is enabled as a read-only JSON readiness surface. Plain output and preflight inputs remain deferred.
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

## Write Execution Readiness Report Contract

Status: helper and formatter implemented; CLI and schema are not enabled.

Before any write runner is enabled, the system should be able to explain whether a persisted execution intent is ready for write execution. A readiness report answers three questions:

- Is this execution intent ready to run, blocked, or unknown?
- Which blocker prevents execution, and which safety category owns that blocker?
- Which approval, precondition, permission, dry-run trace, policy, CI, and repository-state checks are already satisfied versus still requiring a future preflight input?

The report is a read-only judgment surface. It must not write files, execute external commands, create branches, commit, push, create PRs, merge, publish, create tags, create GitHub releases, mutate approvals, or transition run state.

### Inputs

The first implementation should split known audit-bundle facts from future preflight facts.

Known from the existing `ExecutionAuditBundle`:

- intent id, run id, plan id, approval id, checkpoint id, status, actor, reason, and timestamps
- target ref, base branch, source branch, permission mode, and policy version
- dry-run trace count, planned trace count, blocked trace count, action summary, blocked reasons, and mismatched trace ids
- disabled markers: `executionEnabled: false`, `writeExecution: "disabled"`, and `hasExecutionResults: false`

Needed from a future preflight, but not queried by this design draft:

- approval freshness and expiration
- current plan fingerprint and approved plan fingerprint match
- current latest checkpoint id
- clean worktree and diff verification
- current branch, HEAD, target ref, and remote/ref policy
- CI/check status policy
- command runner configuration and permission-gate result

### JSON Surface Proposal

The first helper implementation is a JSON-like report object only; it is not exposed through CLI or the active schema. When a future CLI is implemented, JSON should use the existing CLI envelope and a command-specific payload. The proposed stable payload fields are:

- `readinessStatus`: `"ready" | "blocked" | "unknown"`
- `ready`: boolean
- `intentId`, `runId`, `planId`, `approvalId`, and `checkpointId`
- `blockers`: `{ category, code, message, source }[]`
- `checks`: `{ category, status, message, source }[]`
- `inputs`: `{ auditBundle: "available", preflight: "missing" | "available" }`
- `executionEnabled: false`
- `writeExecution: "disabled"`
- `hasExecutionResults: false`

Blocker categories stay small and automation-friendly: `approval`, `precondition`, `permission`, `trace`, `policy`, `ci`, `repo_state`, and `unknown`.

The first helper uses conservative readiness rules:

- if the audit bundle contains blocked traces, blocked reasons, or mismatched trace records, readiness is `blocked`
- if required preflight inputs are missing, readiness is `unknown`
- `ready` is returned only when the audit bundle has no blockers and every required preflight check is explicitly present and passing
- every report keeps `executionEnabled: false`, `writeExecution: "disabled"`, and `hasExecutionResults: false`

### Plain Output

The pure formatter returns a short human-readable summary:

- header: `Write execution readiness: <intentId>`
- status line: `Status: ready|blocked|unknown`
- ready line: `Ready: yes|no|unknown`
- intent linkage: run id, plan id, approval id, and checkpoint id
- disabled marker line: `Execution: disabled` and `Write execution: disabled`
- input line: `Inputs: auditBundle=available, preflight=missing|partial|available`
- blocker summary grouped by category, with stable empty output when there are no blockers
- check summary grouped by category, with stable empty output when there are no checks
- note: `Use --json for the stable automation contract.`

Plain output must not include raw JSON dumps, raw persisted file contents, stack traces, secrets, raw stdout, raw stderr, exit codes, `executedCommands`, or command execution output.

### Implementation Plan

The first implementation includes pure helpers:

- `summarizeWriteExecutionReadiness(bundle, preflight?)`
- `formatWriteExecutionReadiness(report)`

The helper reuses `ExecutionAuditBundle` rather than re-reading files. A later store or CLI layer may load the audit bundle first, then pass it to the readiness helper. The helper treats missing future preflight inputs as `unknown` checks, not as permission to execute. The formatter only reads a readiness report and does not parse files, write files, spawn commands, or mutate domain state.

Tests should cover:

- blocked readiness when the audit bundle has blocked traces or blocked reasons
- unknown readiness when approval freshness, CI, repo state, or fingerprint checks have no preflight input
- disabled markers on every report
- contract fixture coverage for blocked and ready JSON-like report shapes before CLI/schema enablement
- no execution result fields such as `executedCommands`, raw stdout, raw stderr, or exit code
- plain formatter safety and command-specific JSON schema branch only when the CLI surface is explicitly enabled

Package smoke covers the installed binary JSON readiness path only. Plain readiness output should not be added to smoke until the plain CLI path exists.

## Write Readiness CLI And Schema Surface Draft

Status: JSON path enabled for `write-readiness --intent <intentId> --json`; plain output and preflight inputs are not enabled. This section documents the read-only surface only; it does not unlock write execution.

### Recommended CLI Surface

The recommended first command is:

```bash
task-loop-orchestrator write-readiness --intent <intentId> [--json]
```

This is preferred over `execution-audit --intent <intentId> --readiness [--json]` because readiness answers a distinct question from audit review: whether an existing execution intent is ready, blocked, or unknown. A top-level `write-readiness` command keeps the automation contract discoverable, avoids overloading `execution-audit`, and still reuses the audit bundle internally.

The first CLI implementation is read-only and loads the existing audit bundle for the intent before calling `summarizeWriteExecutionReadiness(bundle)`. It does not run a preflight query yet. Without explicit preflight input, approval freshness, CI, repository state, fingerprint, and remote/ref checks remain `unknown`.

Initial options:

- `--intent <intentId>`: required selector for the persisted execution intent to evaluate.
- `--json`: required in the first CLI implementation; use it for automation, UI integrations, scripts, and schema validation.

Deferred options:

- `--all`: defer list output until single-intent readiness is stable.
- preflight flags such as `--with-repo-state`, `--with-checks`, or `--preflight`: defer until each input source has a read-only policy and test fixture.
- `--root <path>`: defer unless the broader CLI adopts root override semantics.

Plain output is deferred. JSON is the stable automation contract. The enabled JSON mode must preserve the same read-only safety boundary: no file writes, no external command execution, no GitHub lookup, no branch creation, no commit, no push, no pull request creation or mutation, no merge, no release, no tag, no approval mutation, and no run status transition.

### Future JSON Schema Surface

The schema artifact includes `$defs` for the readiness payload contract, and the active command enum and command-specific branch now include `"write-readiness"` for JSON responses:

- branch condition: `command: "write-readiness"`
- branch payload reference: `#/$defs/writeReadinessResponsePayload`

Schema `$defs`:

- `writeReadinessResponsePayload`
- `writeReadinessPayload`
- `writeReadinessBlocker`
- `writeReadinessCheck`
- `writeReadinessInputs`
- `writeReadinessErrorPayload`

The first `writeReadinessPayload` required fields should match the existing readiness contract fixture:

- `readinessStatus`
- `ready`
- `intentId`
- `runId`
- `planId`
- `approvalId`
- `blockers`
- `checks`
- `inputs`
- `executionEnabled`
- `writeExecution`
- `hasExecutionResults`

`checkpointId` should remain optional because older or partial audit data may not have one. `writeReadinessBlocker` should require `category`, `code`, `message`, and `source`. `writeReadinessCheck` should require `category`, `status`, `code`, `message`, and `source`. `writeReadinessInputs` should require `auditBundle` and `preflight`.

Schema tests compare these payload definitions against the contract fixture tests in `tests/write-readiness.test.ts`. The `writeReadinessResponsePayload` allows success `writeReadinessPayload` or `writeReadinessErrorPayload`. The schema must remain extensible with `additionalProperties: true` so future preflight evidence can be added without breaking existing consumers.

### Error Policy

The implementation should reuse the execution-audit loading path, but expose readiness-specific usage and lookup codes where the user asked for readiness:

- missing `--intent`: `status: "error"`, `errorCode: "write_readiness_missing_intent"`
- missing record: `status: "not_found"`, `errorCode: "write_readiness_intent_not_found"`, `intentId`, and `readiness: null`
- invalid persisted execution intent file: `status: "error"`, `errorCode: "invalid_execution_intent_file"`, with safe `details.kind`
- invalid persisted execution trace file: `status: "error"`, `errorCode: "invalid_execution_trace_file"`, with safe `details.kind`
- unsupported future preflight input: `status: "error"`, `errorCode: "write_readiness_preflight_unsupported"`

Error payloads should keep `executionEnabled: false`, `writeExecution: "disabled"`, and `hasExecutionResults: false`. They must not expose raw persisted file contents, stack traces, secrets, raw stdout, raw stderr, exit codes, raw command argv, or execution results.

### Rollout Plan For CLI And Schema

1. Keep `write-readiness --intent <intentId> --json` under schema/docs/package smoke coverage.
2. Add plain `write-readiness --intent <intentId>` output using `formatWriteExecutionReadiness(report)`.
3. Add optional read-only preflight input support only after each preflight source has a fixture and no-write policy.
4. Treat actual write execution unlock as a separate milestone that must first test approval freshness, clean worktree policy, diff verification, CI policy, and remote/ref policy.

## Rollout Slices

1. Persist execution intents without running commands.
2. Add read-only execution intent reports for audit before any command runner exists.
3. Add command runner dry-run trace records that mirror the future audit shape without spawning commands.
4. Add read-only audit bundles that group intents with matching dry-run traces.
5. Add store-level read-only audit bundle assembly from persisted intent and trace records.
6. Guard the audit bundle JSON contract with internal fixture-style tests before exposing it through CLI JSON.
7. Enable the read-only `execution-audit --intent <intentId> --json` lookup without command execution.
8. Enable the read-only `execution-audit --all --json` list lookup without command execution.
9. Enable `execution-audit` plain output using pure formatters without command execution.
10. Add a read-only write execution readiness report helper using audit bundle data and explicit future preflight inputs.
11. Add a read-only write execution readiness plain formatter without command execution.
12. Draft the readiness CLI/schema surface without enabling the production command or active schema branch.
13. Enable the read-only `write-readiness --intent <intentId> --json` path and command-specific schema branch.
14. Add plain readiness output only after JSON behavior is stable.
15. Add a single local-only command behind tests and explicit approval, such as branch creation in a temporary fixture repository.
16. Add commit execution only after staged-file policy and diff verification exist.
17. Add push only after remote/ref policy and CI handling are documented and tested.
18. Add GitHub PR creation only after push policy, approval freshness, and `gh pr create` argument construction are covered.

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

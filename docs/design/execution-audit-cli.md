# Execution Audit Read-Only CLI Surface

Status: design draft, not enabled.

This document describes a future read-only CLI surface for inspecting persisted execution intents, dry-run traces, and audit bundles. It is not implemented, does not enable command execution, and must not be described as an available command until a later implementation milestone adds tests, JSON schema coverage, and command documentation.

## MVP Command

The preferred first command is:

```bash
task-loop-orchestrator execution-audit --intent <intentId> --json
```

This starts with one JSON-only command that returns an `ExecutionAuditBundle` assembled by `FileRunStore.loadExecutionAuditBundle(intentId)`. A separate all-intents listing can follow after the single-intent contract is stable:

```bash
task-loop-orchestrator execution-audit --all --json
```

Alternative command families such as `execution-intents`, `execution-traces`, or `audit execution` are intentionally deferred. A single `execution-audit` surface keeps the first CLI contract focused on the review object users need before any write runner exists.

## Arguments

- `--intent <intentId>`: load one persisted execution intent and matching dry-run traces.
- `--all`: list audit bundles for all persisted intents.
- `--json`: required for the MVP. Plain output should be deferred until the JSON contract has shipped.
- `--root <path>`: defer unless the broader CLI adopts root override semantics. The current CLI uses `process.cwd()`.

`--intent` and `--all` should be mutually exclusive. If neither is provided, the command should return a not-found or usage error rather than guessing.

## JSON Output

The command should use the existing CLI JSON envelope:

- `schemaVersion: 1`
- `command: "execution-audit"`
- `createdAt`

The payload should preserve the current `ExecutionAuditBundle` top-level fields:

- `intent`
- `traces`
- `traceCount`
- `plannedTraceCount`
- `blockedTraceCount`
- `traceActionSummary`
- `blockedReasonCount`
- `blockedReasons`
- `mismatchedTraceCount`
- `mismatchedTraceIds`
- `executionEnabled: false`
- `writeExecution: "disabled"`
- `hasExecutionResults: false`

When `--all` is implemented, the payload should use a stable wrapper such as `bundles`, `bundleCount`, `executionEnabled`, `writeExecution`, and `hasExecutionResults` rather than returning a bare array.

## Safety Boundary

The command must be read-only:

- no file writes
- no external command execution
- no `child_process` or shell execution
- no branch creation
- no commit
- no push
- no pull request creation or mutation
- no merge
- no release
- no Jira or GitHub write-side action
- no approval mutation
- no run status transition

It may read `.orchestrator/execution-intents/` and `.orchestrator/execution-traces/` through `FileRunStore`. It must not create missing directories as a side effect beyond what existing read helpers already do; if that behavior matters for strict read-only semantics, the implementation milestone should split read-only directory access from current list helpers.

## Missing Data Behavior

- No persisted intents: return an enveloped JSON response with `status: "not_found"` and `intent: null` for `--intent`, or `bundles: []` and `bundleCount: 0` for `--all`.
- Intent not found: return `status: "not_found"`, `intentId`, and `intent: null`.
- No traces for an existing intent: return a valid bundle with `traces: []`, `traceCount: 0`, and disabled execution markers.
- Trace mismatch: include only matching traces in `traces`; report unrelated trace ids through `mismatchedTraceCount` and `mismatchedTraceIds`.
- Invalid persisted file: fail with a clear read/parse error and do not mutate files. A future JSON error envelope can be designed separately if needed.

## Implementation Requirements

Before enabling the command, the implementation milestone should add:

- `CliJsonCommand` support for `execution-audit`.
- `schemas/cli-json.schema.json` command enum and command-specific payload branch.
- `docs/json-output.md` command-specific schema documentation.
- `docs/commands.md` entry after the command exists.
- package smoke coverage for installed binary JSON output.
- docs drift tests that keep command usage, JSON support, and read-only behavior aligned.
- tests proving the command uses `FileRunStore` read helpers and does not execute commands.

## Hard Non-Goals

This design does not approve or implement:

- actual command execution
- command runner activation
- branch creation
- commit
- push
- `gh pr create`
- PR mutation
- merge
- release
- approval creation or mutation
- npm publish
- git tag creation
- GitHub release creation

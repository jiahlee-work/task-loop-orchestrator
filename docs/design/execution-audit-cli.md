# Execution Audit Read-Only CLI Surface

Status: partial MVP enabled for `execution-audit --intent <intentId> --json`; `--all` and plain output remain deferred.

This document describes the read-only CLI surface for inspecting persisted execution intents, dry-run traces, and audit bundles. The single-intent JSON command is implemented, but it does not enable command execution. Listing all intents, plain output, and write-side actions remain future work.

## MVP Command

The enabled first command is:

```bash
task-loop-orchestrator execution-audit --intent <intentId> --json
```

This starts with one JSON-only command that returns an `ExecutionAuditBundle` assembled by `FileRunStore.loadExecutionAuditBundle(intentId)`. A separate all-intents listing remains deferred until the single-intent contract is stable:

```bash
task-loop-orchestrator execution-audit --all --json
```

Alternative command families such as `execution-intents`, `execution-traces`, or `audit execution` are intentionally deferred. A single `execution-audit` surface keeps the first CLI contract focused on the review object users need before any write runner exists.

## Arguments

- `--intent <intentId>`: load one persisted execution intent and matching dry-run traces.
- `--all`: deferred; list audit bundles for all persisted intents in a later milestone.
- `--json`: required for the MVP. Plain output should be deferred until the JSON contract has shipped.
- `--root <path>`: defer unless the broader CLI adopts root override semantics. The current CLI uses `process.cwd()`.

`--intent` is required in the current implementation. `--all` is rejected as not implemented, and plain output is rejected because the MVP is JSON-only.

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

- No persisted intents: return an enveloped JSON response with `status: "not_found"` and `intent: null` for `--intent`, or `bundles: []` and `bundleCount: 0` for `--all` after `--all` is implemented.
- Intent not found: return `status: "not_found"`, `intentId`, and `intent: null`.
- No traces for an existing intent: return a valid bundle with `traces: []`, `traceCount: 0`, and disabled execution markers.
- Trace mismatch: include only matching traces in `traces`; report unrelated trace ids through `mismatchedTraceCount` and `mismatchedTraceIds`.
- Invalid persisted file: return an error envelope after the error contract is implemented; until then, fail with a clear read/parse error and do not mutate files.

## JSON Error Envelope Draft

Status: design draft, not enabled. The current command only returns enveloped JSON for successful audit bundles; missing intent and invalid persisted file cases still use the existing CLI error path.

The next implementation milestone should add an error payload that keeps the common CLI metadata envelope while separating success bundles from failures:

```json
{
  "schemaVersion": 1,
  "command": "execution-audit",
  "createdAt": "2026-06-22T00:00:00.000Z",
  "status": "not_found",
  "errorCode": "execution_intent_not_found",
  "message": "Execution intent was not found.",
  "intentId": "intent_xxx",
  "intent": null
}
```

Candidate top-level fields:

- `status`: `not_found` for missing records, or `error` for invalid persisted data and usage errors that are returned as JSON.
- `errorCode`: stable machine-readable code such as `execution_intent_not_found`, `execution_intents_empty`, `invalid_execution_intent_file`, `invalid_execution_trace_file`, `execution_audit_all_deferred`, `execution_audit_missing_intent`, or `execution_audit_json_required`.
- `message`: short human-readable explanation.
- `intentId`: included when the user supplied or implied a specific intent id.
- `intent`: `null` for not-found responses.
- `details`: optional structured context for invalid persisted files; avoid raw file contents and secrets.

The schema should model `ExecutionAuditBundle | executionAuditErrorPayload` rather than mixing error fields into the success bundle definition. The command-specific branch can stay conditional on `command: "execution-audit"` while allowing either the success payload with `intent` and `traces`, or the error payload with `status`, `errorCode`, and `message`.

Error cases to cover:

- no persisted intents
- intent not found
- invalid persisted intent file
- invalid persisted trace file
- `--all` rejected because it remains deferred
- missing `--intent`
- missing `--json`

The error path must preserve the same read-only guarantee as the success path: no file writes, no external command execution, no branch creation, no commit, no push, no pull request creation or mutation, no approval mutation, and no run status transition.

Implementation requirements for the future milestone:

- add a small JSON error helper that uses the existing envelope metadata
- extend `schemas/cli-json.schema.json` with an `executionAuditErrorPayload` definition
- document the enabled error payload in `docs/json-output.md` only after implementation
- add focused CLI tests for not-found and invalid persisted file cases
- extend package smoke only if deterministic fixture-based error checks stay fast and read-only

## Implementation Requirements

The first implementation milestone includes:

- `CliJsonCommand` support for `execution-audit`.
- `schemas/cli-json.schema.json` command enum and command-specific payload branch.
- `docs/json-output.md` command-specific schema documentation.
- `docs/commands.md` entry for the enabled command.
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

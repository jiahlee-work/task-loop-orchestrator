# Execution Audit Read-Only CLI Surface

Status: JSON and plain read-only output enabled for `execution-audit --intent <intentId>` and `execution-audit --all`.

This document describes the read-only CLI surface for inspecting persisted execution intents, dry-run traces, and audit bundles. The single-intent and all-intents JSON and plain commands are implemented, but they do not enable command execution. Write-side actions remain future work.

## MVP Commands

The enabled read-only commands are:

```bash
task-loop-orchestrator execution-audit --intent <intentId>
task-loop-orchestrator execution-audit --intent <intentId> --json
task-loop-orchestrator execution-audit --all
task-loop-orchestrator execution-audit --all --json
```

The single-intent command returns an `ExecutionAuditBundle` assembled by `FileRunStore.loadExecutionAuditBundle(intentId)`. The all-intents command returns a list wrapper assembled from `FileRunStore.listExecutionAuditBundles()`.

Alternative command families such as `execution-intents`, `execution-traces`, or `audit execution` are intentionally deferred. A single `execution-audit` surface keeps the first CLI contract focused on the review object users need before any write runner exists.

## Arguments

- `--intent <intentId>`: load one persisted execution intent and matching dry-run traces.
- `--all`: list audit bundles for all persisted intents.
- `--json`: optional; use it for the stable machine-readable envelope. Plain output is for human terminal summaries.
- `--root <path>`: defer unless the broader CLI adopts root override semantics. The current CLI uses `process.cwd()`.

Exactly one of `--intent` or `--all` should be used.

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

`--all` uses the list wrapper described in the `--all JSON List Contract` section rather than returning a bare array.

## `--all` JSON List Contract

Status: enabled for `execution-audit --all --json`.

The read-only command is:

```bash
task-loop-orchestrator execution-audit --all --json
```

The command keeps the existing CLI JSON envelope through `printJson("execution-audit", payload)`:

- `schemaVersion: 1`
- `command: "execution-audit"`
- `createdAt`

The payload is a list-specific success object:

- `status: "ok"`
- `bundleCount`: number of returned audit bundles
- `bundles`: `ExecutionAuditBundle[]`, reusing the same single-intent bundle contract
- `executionEnabled: false`
- `writeExecution: "disabled"`
- `hasExecutionResults: false`

The payload does not return a bare array. Keeping disabled execution markers at the list level lets automation distinguish this read-only inventory response from any future execution result.

Ordering should follow `FileRunStore.listExecutionAuditBundles()`: bundles are ordered by the underlying execution intent `createdAt` value in descending order, newest first. Empty state is a successful list response, not an error:

```json
{
  "schemaVersion": 1,
  "command": "execution-audit",
  "createdAt": "2026-06-22T00:00:00.000Z",
  "status": "ok",
  "bundleCount": 0,
  "bundles": [],
  "executionEnabled": false,
  "writeExecution": "disabled",
  "hasExecutionResults": false
}
```

### Invalid Persisted File Policy For `--all`

The implementation policy is fail-fast with a single JSON error envelope. If any persisted execution intent or execution trace file cannot be parsed or validated, `execution-audit --all --json` returns `status: "error"` with `errorCode: "invalid_execution_intent_file"` or `errorCode: "invalid_execution_trace_file"` and safe `details.kind`.

This is preferred over partial success because the audit list is used for review and traceability; silently skipping invalid files or returning valid bundles with `errors[]` can hide corrupted audit state from automation. A future milestone can design partial success if there is a concrete UI need, but the first list implementation keeps the failure mode obvious and machine-readable.

All policies must avoid exposing raw file contents, stack traces, secrets, stdout, stderr, exit codes, or execution results. Error paths remain read-only and must not mutate files or run external commands.

The schema includes `executionAuditListPayload`, and `executionAuditResponsePayload` allows `ExecutionAuditBundle | executionAuditListPayload | executionAuditErrorPayload`.

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
- Invalid persisted file: return a JSON error envelope and do not mutate files.

## JSON Error Envelope Draft

Status: enabled for success bundles, list bundles, missing intents, missing `--intent`, and invalid persisted intent/trace files.

The first implementation uses an error payload that keeps the common CLI metadata envelope while separating success bundles from failures:

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

- `status`: `not_found` for missing records, or `error` for usage and invalid persisted file cases that are returned as JSON.
- `errorCode`: stable machine-readable code such as `execution_intent_not_found`, `execution_audit_missing_intent`, `invalid_execution_intent_file`, or `invalid_execution_trace_file`.
- `message`: short human-readable explanation.
- `intentId`: included when the user supplied or implied a specific intent id.
- `intent`: `null` for not-found responses.
- `details`: optional structured context for invalid persisted files. The first implementation only exposes `{ "kind": "execution_intent" }` or `{ "kind": "execution_trace" }` and avoids raw file contents, stack traces, secrets, stdout, stderr, and exit codes.

The schema models `ExecutionAuditBundle | executionAuditListPayload | executionAuditErrorPayload` through `executionAuditResponsePayload` rather than mixing error fields into the success bundle definition. The command-specific branch stays conditional on `command: "execution-audit"` while allowing either the success payload with `intent` and `traces`, the list payload with `status`, `bundleCount`, and `bundles`, or the error payload with `status`, `errorCode`, and `message`.

Error cases to cover:

- intent not found, including the case where no persisted intents exist
- missing `--intent` when `--json` is present

- invalid persisted intent file
- invalid persisted trace file

Plain error cases:

- when `--json` is omitted, the same missing selector, not-found, and invalid persisted file cases are formatted with short safe plain errors instead of JSON envelopes

The error path must preserve the same read-only guarantee as the success path: no file writes, no external command execution, no branch creation, no commit, no push, no pull request creation or mutation, no approval mutation, and no run status transition.

Remaining implementation requirements for future milestones:

- decide whether invalid persisted file envelopes need additional structured `details` beyond `kind`
- add a broader CLI test harness if future error cases outgrow package smoke coverage

## Plain Output Contract

Status: enabled through pure formatter helpers. The CLI uses these formatters when `--json` is omitted.

Plain output is for people reading terminal summaries. Automation, UI integrations, scripts, and schema validation must continue to use `--json` because the JSON envelope is the stable machine-readable contract.

### `execution-audit --intent <intentId>`

The single-intent plain output should be a compact multi-section summary:

- header: `Execution audit: <intentId>`
- intent line: `Status`, `Run`, `Plan`, `Approval`, `Checkpoint`, and `Created`
- target line: `Base`, `Source`, and `Target ref`
- safety line: `Execution: disabled` and `Write execution: disabled`
- command summary: dry-run trace count, planned trace count, blocked trace count, and action summary
- blocked summary: blocked reason count plus short blocked reason lines when present
- mismatch summary: mismatched trace count and trace ids when present
- trace summary: one line per dry-run trace with action, status, policy decision, and reason

The formatter should avoid dumping full JSON. It should not print raw persisted file contents, raw stdout, raw stderr, stack traces, secrets, exit codes, `executedCommands`, or command execution output.

### `execution-audit --all`

The all-intents plain output should be a list summary:

- header: `Execution audit bundles`
- count line: `Bundles: <bundleCount>`
- safety line: `Execution: disabled` and `Write execution: disabled`
- empty state: `No execution audit bundles found.`
- ordering note: newest first by execution intent `createdAt`
- per-bundle summary line: intent id, status, run id, plan id, trace count, blocked reason count, and createdAt

The list output should not print every trace by default. If future UX needs detail expansion, it should use a separate explicit option rather than making the default plain output noisy.

### Plain Error Output

Plain output error handling is intentionally less stable than JSON error envelopes. Missing intent, missing selector, and invalid persisted file cases should print a short human-readable error with a recommended JSON command when useful.

Proposed examples:

- missing selector: `execution-audit requires --intent <intentId> or --all. Use --json for machine-readable errors.`
- intent not found: `Execution intent not found: <intentId>`
- invalid persisted intent file: `Invalid execution intent file. Re-run with --json for errorCode and safe details.`
- invalid persisted trace file: `Invalid execution trace file. Re-run with --json for errorCode and safe details.`

Plain output preserves non-zero exits for missing selectors, not found, invalid persisted files, and other errors. Successful single-intent and list summaries exit zero.

### Formatter Implementation Plan

The first formatter implementation adds pure helpers that consume existing read-only reports without mutating domain state:

- `formatExecutionAuditBundle(bundle)`
- `formatExecutionAuditList(report)`
- `formatExecutionAuditError(errorPayload)`

The formatters reuse `ExecutionAuditBundle`, `ExecutionAuditListReport`, and existing disabled execution markers. They do not parse files, write files, spawn commands, or change approval/intent/trace state.

Focused tests should verify:

- single-intent output includes intent id, status, run id, disabled markers, trace counts, blocked reasons, and mismatch count
- all-intents output includes bundle count, newest-first note, empty state, and per-bundle one-line summaries
- plain errors are short, omit raw file contents and stack traces, and keep non-zero CLI behavior
- package smoke covers at least one installed-binary plain output path after the feature is enabled

## Implementation Requirements

The first implementation milestone includes:

- `CliJsonCommand` support for `execution-audit`.
- `schemas/cli-json.schema.json` command enum and command-specific payload branch.
- `executionAuditListPayload` support for `execution-audit --all --json`.
- `docs/json-output.md` command-specific schema documentation.
- `docs/commands.md` entry for the enabled command.
- plain output wiring through pure formatters for single-intent, all-intents, and safe error summaries.
- package smoke coverage for installed binary JSON and plain output.
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

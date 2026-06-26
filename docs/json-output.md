# CLI JSON Output

`task-loop-orchestrator` JSON output is designed for automation and UI consumers. Every current `--json` command uses a shared metadata envelope while keeping command-specific payload fields at the top level.

## Envelope

All JSON responses include:

- `schemaVersion`: currently `1`.
- `command`: the CLI command that produced the response.
- `createdAt`: an ISO 8601 timestamp. If a legacy payload already had a top-level `createdAt`, that payload value is preserved.

Example:

```json
{
  "schemaVersion": 1,
  "command": "run",
  "createdAt": "2026-06-22T00:00:00.000Z",
  "runId": "run-20260622-example",
  "status": "completed"
}
```

## Compatibility Policy

Command-specific payload fields remain at the top level for compatibility. Consumers should read the common metadata fields first and then parse the command-specific fields they need.

New payload fields may be added in minor releases. Existing payload fields should not be removed or moved without a schema version change.

## Commands

The envelope applies to every current JSON-capable command:

- `init --json`
- `doctor --json`
- `run "task instruction" --json`
- `resume <runId> --json`
- `status [runId] --json`
- `status [runId] --json --raw`
- `checkpoint [runId] --json`
- `checks [ref] --json`
- `pr-plan [runId] --json`
- `pr-exec [runId] --json`
- `approve-pr [runId] --approved-by <name> --json`
- `execution-audit --intent <intentId> --json`
- `write-readiness --intent <intentId> --json`
- `write-readiness --intent <intentId> --preflight <path> --json`
- `write-runner --intent <intentId> --json`
- `write-runner --intent <intentId> --preflight <path> --json`
- `write-runner --intent <intentId> --preflight <path> --simulate --json`
- `write-runner --intent <intentId> --preflight <path> --execute --json`

## Raw Status

`status --json` returns the latest stable run report shape used by `run --json` and `resume --json`. When no runs exist, it returns `status: "not_found"`, `run: null`, and a short `message` that points users back to `tlo run "task instruction" --json`.

`status --json --raw` returns the stored raw `LoopRun` shape with the same metadata fields added at the top level.

## Run Report Schema

The first command-specific schema extension covers the stable run report payload returned by:

- `run "task instruction" --json`
- `resume <runId> --json`
- `status [runId] --json`

Successful run responses use the stable `runReportPayload`, which fixes the summary fields automation commonly reads: `runId`, `status`, `iterations`, `permissionMode`, `task`, `counts`, `savedPath`, and `run`. `resume <runId> --json` can also return `runLookupErrorPayload` with `status: "not_found"`, `runId`, `run: null`, and `message` when the requested run file does not exist; the `resume` command branch is represented by `runResponsePayload`. Additional fields remain allowed for forward-compatible payload expansion.

`status --json --raw` is intentionally excluded from the stricter run report payload branch because it returns the stored raw `LoopRun` object rather than the stable summary report.

## Checks Schema

`checks [ref] --json` has a command-specific schema branch for CI automation. Consumers can rely on `status`, `summary`, and `source`, plus optional `ref` and `details`.

Each `details[]` item fixes `name` and `status`, with optional `summary`. Queued or in-progress checks are reported as `pending`; missing checks, missing auth, or provider uncertainty remain non-crashing JSON responses such as `not_found` or `unknown`.

## Checkpoint Schema

`checkpoint [runId] --json` has a command-specific schema branch for integration automation. Consumers can rely on `id`, `runId`, `status`, `counts`, `repoStatus`, `diffStat`, `ciCheck`, `conflictRisks`, `recommendedNextAction`, `maintainerActionCandidates`, `ownerDecisionItems`, and `createdAt`.

The nested `ciCheck` field reuses the check status/detail shape where possible, while still allowing the local placeholder status `not_run`. Maintainer actions remain decision-ready candidates only; the checkpoint command does not execute write actions.

## PR Plan Schema

`pr-plan [runId] --json` has a command-specific schema branch for decision-ready PR preparation. Consumers can rely on `id`, `runId`, `sourceBranchHint`, `baseBranch`, `title`, `body`, `preconditions`, `blockedReasons`, `commandCandidates`, and `createdAt`, with optional `checkpointId`.

Each `commandCandidates[]` item fixes `action`, `command`, `reason`, and `decisionReady`. These are execution candidates only; `pr-plan` never creates a branch, commit, push, or pull request.

## PR Execution Schema

`pr-exec [runId] --json` has a command-specific schema branch for approval preflight and write-boundary checks. Consumers can rely on `id`, `planId`, `runId`, `mode`, `status`, `blockedReasons`, `commandCandidates`, `executedCommands`, `message`, and `createdAt`, with optional `approval`.

`mode` is `dry-run` or `execute`; `status` is `dry_run`, `ready`, or `blocked`. `executedCommands` is an array of command arrays and remains empty while write execution is intentionally blocked. Approval records expose the minimum audit fields needed to connect the preflight result to a stored approval.

## PR Approval Schema

`approve-pr [runId] --approved-by <name> --json` has a command-specific schema branch for stored PR execution approvals. It reuses the same approval record shape exposed by `pr-exec --json`, including `id`, `scope`, `planId`, `runId`, `status`, `createdAt`, and optional audit fields such as `checkpointId`, `planSnapshot`, `approvedBy`, and `reason`.

When present, `planSnapshot` fixes `planTitle`, `baseBranch`, `sourceBranchHint`, `blockedReasons`, and `commandCandidateActions` for audit comparison.

The command writes only the approval record under `.orchestrator/approvals/`; it does not create branches, commits, pushes, pull requests, merges, or releases.

## Execution Audit Schema

`execution-audit --intent <intentId> --json` has a command-specific schema branch for read-only execution audit review. Consumers can rely on `intent`, `traces`, `traceCount`, `plannedTraceCount`, `blockedTraceCount`, `traceActionSummary`, `blockedReasonCount`, `blockedReasons`, `mismatchedTraceCount`, `mismatchedTraceIds`, `executionEnabled`, `writeExecution`, and `hasExecutionResults`.

The nested `intent` report fixes `id`, `runId`, `planId`, `approvalId`, `status`, `actor`, `createdAt`, `expiresAt`, `targetRef`, `baseBranch`, `sourceBranch`, `permissionMode`, `policyVersion`, `commandCandidateCount`, `commandCandidateActions`, `commandActionSummary`, `blockedReasonCount`, `blockedReasons`, `executionEnabled`, and `writeExecution`, with optional `checkpointId` and `reason`.

Each `traces[]` item fixes `id`, `intentId`, `runId`, `planId`, `approvalId`, `action`, `argv`, `reason`, `status`, `policyVersion`, `policyDecision`, `blockedReasonCount`, `blockedReasons`, `createdAt`, `executionEnabled`, `writeExecution`, and `hasExecutionResults`, with optional `checkpointId`.

Execution audit output is read-only and intentionally excludes `executedCommands`, raw `stdout`, raw `stderr`, and `exitCode`. Plain output is deferred.

`execution-audit --all --json` uses a list wrapper with `status`, `bundleCount`, `bundles`, `executionEnabled`, `writeExecution`, and `hasExecutionResults`. Empty state is a successful response with `status: "ok"`, `bundleCount: 0`, and `bundles: []`. Bundles follow `FileRunStore.listExecutionAuditBundles()` ordering: execution intent `createdAt` descending, newest first.

The `execution-audit` command-specific branch uses `executionAuditResponsePayload` to allow either a success `executionAuditPayload` bundle, an `executionAuditListPayload`, or an `executionAuditErrorPayload`. Implemented error envelopes cover missing intents, missing `--intent`, invalid persisted intent files, and invalid persisted trace files.

Error payloads fix `status`, `errorCode`, `message`, `intent`, `executionEnabled`, `writeExecution`, and `hasExecutionResults`, with optional `intentId` and `details`. `intent` is `null` for these error responses. Invalid persisted file envelopes expose only minimal `details.kind` values such as `execution_intent` or `execution_trace`; they do not include raw file contents, stack traces, secrets, stdout, stderr, or exit codes.

## Write Readiness Schema

`write-readiness --intent <intentId> --json` and `write-readiness --intent <intentId> --preflight <path> --json` have a command-specific schema branch for read-only write execution readiness review. They load the existing execution audit bundle and summarize known audit-bundle facts plus preflight check state. Without a preflight file, a clean audit bundle is normally `unknown`.

The `writeReadinessPayload` fixes `readinessStatus`, `ready`, `intentId`, `runId`, `planId`, `approvalId`, `blockers`, `checks`, `inputs`, `executionEnabled`, `writeExecution`, and `hasExecutionResults`, with optional `checkpointId`.

Each `writeReadinessBlocker` fixes `category`, `code`, `message`, and `source`. Each `writeReadinessCheck` fixes `category`, `status`, `code`, `message`, and `source`. The `writeReadinessInputs` object fixes `auditBundle` and `preflight`; `preflight` is `missing` when no evidence file is supplied, `partial` when only some recognized checks are present, and `available` when every recognized preflight check is present. Plain and JSON modes support `--preflight <path>` as a read-only evidence file input.

The `writeReadinessResponsePayload` allows either a success `writeReadinessPayload` or a `writeReadinessErrorPayload`. Error payloads fix `status`, `errorCode`, `message`, `readiness`, `executionEnabled`, `writeExecution`, and `hasExecutionResults`, with optional `intentId` and `details`. Error payloads keep `readiness: null`, `executionEnabled: false`, `writeExecution: "disabled"`, and `hasExecutionResults: false`.

The JSON path handles missing `--intent`, missing execution intents, invalid persisted execution intent files, invalid persisted execution trace files, missing preflight paths, file-not-found/read failures, invalid JSON, and invalid preflight schema with safe error envelopes. Plain output is available for human terminal review, but automation should use `--json`. Preflight error envelopes and plain errors must not echo raw file paths, raw file contents, raw command args, stdout, stderr, exit codes, `executedCommands`, stack traces, or secrets. This command does not permit command execution, file writes, GitHub lookup, branch creation, commits, pushes, pull request creation, merges, releases, or tags.

When `--preflight <path>` is supplied, loader/parser failures return safe errors rather than partial readiness success. JSON envelopes keep `readiness: null`, disabled execution markers, and no raw path or raw file content; plain errors use short human-readable messages with the same safety boundary.

## Write Runner Schema

`write-runner --intent <intentId> --json`, `write-runner --intent <intentId> --preflight <path> --json`, and `write-runner --intent <intentId> --preflight <path> --simulate --json` have a command-specific schema branch for the audited write runner dry-run and simulation boundary. The command computes the same readiness gate as `write-readiness`; when readiness is `ready`, it saves local dry-run trace records under `.orchestrator/execution-traces/` and returns a plan report. When readiness is `blocked` or `unknown`, it returns a blocked dry-run report without saving new traces. `--execute --json` is accepted only to return a disabled report; it does not run actual write execution.

The `writeRunnerDryRunPayload` fixes `status`, `intentId`, `runId`, `planId`, `approvalId`, `readinessStatus`, `ready`, `planItemCount`, `planItems`, `traceCount`, `traceIds`, `localTracePersistence`, `policy`, `simulationResultCount`, `simulationResults`, `blockedReasonCount`, `blockedReasons`, `createdAt`, `executionEnabled`, `writeExecution`, and `hasExecutionResults`, with optional `checkpointId`.

Each `writeRunnerPlanItem` fixes `action` and `summary`, with optional safe candidates such as `branchNameCandidate`, `baseBranch`, `sourceBranch`, `targetRef`, `commitMessageCandidate`, `prTitleCandidate`, and `prBodyCandidate`. Plan items intentionally omit raw command `argv`. The top-level `localTracePersistence` is `saved` when dry-run trace artifacts were written and `skipped` when readiness prevented trace persistence.

The `writeRunnerExecutionPolicy` fixes `mode`, `requiredReadiness`, `allowedActions`, `disallowedActions`, `blockers`, `actualExecutionEnabled`, `executionEnabled`, and `writeExecution`. `mode` is `dry_run`, `simulate`, or `execute_disabled`; `requiredReadiness` is `ready`; and `actualExecutionEnabled` is always `false`. Each `writeRunnerSimulationResult` fixes `action`, `status`, `summary`, `executionEnabled`, `writeExecution`, and `hasExecutionResults` without raw command arguments or process output.

The `writeRunnerResponsePayload` allows either a success `writeRunnerDryRunPayload` or a `writeRunnerErrorPayload`. Error payloads fix `status`, `errorCode`, `message`, `dryRun`, `executionEnabled`, `writeExecution`, and `hasExecutionResults`, with optional `intentId` and `details`. Error payloads keep `dryRun: null`, `executionEnabled: false`, `writeExecution: "disabled"`, and `hasExecutionResults: false`.

The JSON path handles missing `--intent`, missing execution intents, invalid persisted execution intent files, invalid persisted execution trace files, missing preflight paths, file-not-found/read failures, invalid JSON, and invalid preflight schema with safe error envelopes. This dry-run and simulation boundary does not execute commands, create branches, commits, pushes, pull requests, merges, releases, or tags, and it does not expose raw command args, stdout, stderr, exit codes, `executedCommands`, stack traces, or secrets.

## Doctor Schema

`doctor --json` has a command-specific schema branch for installation and project readiness diagnostics. Consumers can rely on top-level `status`, `rootDir`, `githubMode`, and `checks`.

Each `checks[]` item fixes `id`, `status`, and `summary`, with optional `details`, `recommendedAction`, and structured `suggestions`. Each suggestion fixes `label`, `command`, `reason`, and `destructive` so automation or UI layers can present remediation candidates without doctor executing them.

## Init Schema

`init --json` has a command-specific schema branch for bootstrap file results. Consumers can rely on `rootDir`, `force`, and `files`.

The `files` object currently reports `config` and `gitignore`. Each file result fixes `path` and `status`, with optional `reason`; status is one of `created`, `updated`, or `skipped`. `init` is the explicit bootstrap write command, but it still avoids destructive config overwrite unless `--force` is used.

## Coverage and Exceptions

Every current JSON-capable command is tracked by `schemas/cli-json.schema.json` with a command-specific branch: `init`, `doctor`, `run`, `resume`, `status`, `checkpoint`, `checks`, `pr-plan`, `pr-exec`, `approve-pr`, `execution-audit`, `write-readiness`, and `write-runner`.

Two response families intentionally stay on the flexible common envelope path:

- `status --json --raw`: raw status returns the stored `LoopRun` shape. The strict run report branch applies only when a `status` response includes `runId`, which is the default `status --json` report shape.
- No-run responses from `checkpoint`, `pr-plan`, `pr-exec`, and `approve-pr`: these return `{ "status": "not_found", "run": null }` with the common envelope. Their strict branches apply only to concrete records that include `id`.

## Not Found Responses

Commands that need an existing run return an enveloped not-found response when `--json` is used and no run is available:

```json
{
  "schemaVersion": 1,
  "command": "pr-plan",
  "createdAt": "2026-06-22T00:00:00.000Z",
  "status": "not_found",
  "run": null
}
```

## JSON Schema

The machine-readable schema artifact is available at [`../schemas/cli-json.schema.json`](../schemas/cli-json.schema.json). The schema validates the common envelope and command enum while allowing command-specific payload fields to remain flexible.

Command-specific branches are implemented with `allOf` conditions that reference `$defs` payload definitions such as `runResponsePayload`, `runReportPayload`, `runLookupErrorPayload`, `checksPayload`, `checkpointPayload`, `prPlanPayload`, `prExecPayload`, `approvePrPayload`, `executionAuditResponsePayload`, `executionAuditPayload`, `executionAuditErrorPayload`, `writeReadinessResponsePayload`, `writeReadinessPayload`, `writeReadinessErrorPayload`, `writeRunnerResponsePayload`, `writeRunnerDryRunPayload`, `writeRunnerExecutionPolicy`, `writeRunnerSimulationResult`, `writeRunnerErrorPayload`, `doctorPayload`, and `initPayload`.

Representative JSON outputs are also covered by the lightweight sample smoke in [`../tests/json-schema-samples.test.ts`](../tests/json-schema-samples.test.ts). Those samples are built from test-only fixtures and checked against the schema envelope, command enum, command-specific branch, and required top-level fields without introducing a full JSON Schema validator.

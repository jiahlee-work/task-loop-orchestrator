import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliJsonCommands, cliJsonSchemaVersion } from "../src/cli-json.js";

const root = process.cwd();

describe("CLI JSON schema artifact", () => {
  it("defines the common envelope contract", async () => {
    const schema = await readSchema();

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.required).toEqual(expect.arrayContaining(["schemaVersion", "command", "createdAt"]));
    expect(schema.properties?.schemaVersion?.const).toBe(cliJsonSchemaVersion);
    expect(schema.properties?.command?.enum).toEqual([...cliJsonCommands]);
    expect(schema.properties?.createdAt).toMatchObject({ type: "string", format: "date-time" });
    expect(schema.additionalProperties).toBe(true);
  });

  it("defines a focused run report payload schema", async () => {
    const schema = await readSchema();
    const runReport = schema.$defs?.runReportPayload;

    expect(runReport?.required).toEqual(
      expect.arrayContaining(["runId", "status", "iterations", "permissionMode", "task", "counts", "savedPath", "run"])
    );
    expect(runReport?.properties?.status).toEqual({ $ref: "#/$defs/runStatus" });
    expect(runReport?.properties?.permissionMode).toEqual({ $ref: "#/$defs/permissionMode" });
    expect(runReport?.properties?.task).toEqual({ $ref: "#/$defs/runReportTask" });
    expect(runReport?.properties?.counts).toEqual({ $ref: "#/$defs/subtaskCounts" });
    expect(runReport?.additionalProperties).toBe(true);
    expect(schema.$defs?.subtaskCounts?.required).toEqual(
      expect.arrayContaining(["pending", "active", "completed", "blocked", "failed", "total"])
    );
  });

  it("defines run response and lookup error payloads for missing resume targets", async () => {
    const schema = await readSchema();
    const runLookupError = schema.$defs?.runLookupErrorPayload;
    const runResponse = schema.$defs?.runResponsePayload;

    expect(runLookupError?.required).toEqual(expect.arrayContaining(["status", "runId", "run", "message"]));
    expect(runLookupError?.properties?.status).toEqual({ const: "not_found" });
    expect(runLookupError?.properties?.run).toEqual({ type: "null" });
    expect(runLookupError?.additionalProperties).toBe(true);
    expect(runResponse?.required).toEqual(expect.arrayContaining(["runId", "status", "run"]));
    expect(runResponse?.anyOf).toEqual([
      { $ref: "#/$defs/runReportPayload" },
      { $ref: "#/$defs/runLookupErrorPayload" }
    ]);
  });

  it("defines a focused checks payload schema", async () => {
    const schema = await readSchema();
    const checksPayload = schema.$defs?.checksPayload;
    const checkDetail = schema.$defs?.checkDetail;

    expect(schema.$defs?.githubCheckStatus).toEqual({
      type: "string",
      enum: ["success", "pending", "failure", "error", "not_found", "unknown"]
    });
    expect(checksPayload?.required).toEqual(expect.arrayContaining(["status", "summary", "source"]));
    expect(checksPayload?.properties?.status).toEqual({ $ref: "#/$defs/githubCheckStatus" });
    expect(checksPayload?.properties?.source).toEqual({ const: "github" });
    expect(checksPayload?.properties?.details).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/checkDetail"
      }
    });
    expect(checksPayload?.additionalProperties).toBe(true);
    expect(checkDetail?.required).toEqual(expect.arrayContaining(["name", "status"]));
    expect(checkDetail?.properties?.status).toEqual({ $ref: "#/$defs/githubCheckStatus" });
    expect(checkDetail?.additionalProperties).toBe(true);
  });

  it("defines a focused checkpoint payload schema", async () => {
    const schema = await readSchema();
    const checkpointPayload = schema.$defs?.checkpointPayload;

    expect(schema.$defs?.checkpointStatus).toEqual({
      type: "string",
      enum: ["clean", "needs_attention", "blocked"]
    });
    expect(checkpointPayload?.required).toEqual(
      expect.arrayContaining([
        "id",
        "runId",
        "status",
        "counts",
        "repoStatus",
        "diffStat",
        "ciCheck",
        "conflictRisks",
        "recommendedNextAction",
        "maintainerActionCandidates",
        "ownerDecisionItems",
        "createdAt"
      ])
    );
    expect(checkpointPayload?.properties?.status).toEqual({ $ref: "#/$defs/checkpointStatus" });
    expect(checkpointPayload?.properties?.counts).toEqual({ $ref: "#/$defs/checkpointCounts" });
    expect(checkpointPayload?.properties?.ciCheck).toEqual({ $ref: "#/$defs/checkpointCiCheck" });
    expect(checkpointPayload?.properties?.maintainerActionCandidates).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/maintainerActionCandidate"
      }
    });
    expect(checkpointPayload?.properties?.ownerDecisionItems).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/ownerDecisionItem"
      }
    });
    expect(checkpointPayload?.additionalProperties).toBe(true);
    expect(schema.$defs?.checkpointCounts?.required).toEqual(
      expect.arrayContaining(["completed", "blocked", "pending", "active", "failed"])
    );
    expect(schema.$defs?.checkpointCiCheck?.required).toEqual(expect.arrayContaining(["status", "summary", "source"]));
    expect(schema.$defs?.maintainerActionCandidate?.required).toEqual(
      expect.arrayContaining(["action", "label", "reason", "decisionReady"])
    );
    expect(schema.$defs?.ownerDecisionItem?.required).toEqual(expect.arrayContaining(["source", "reason"]));
  });

  it("defines a focused PR plan payload schema", async () => {
    const schema = await readSchema();
    const prPlanPayload = schema.$defs?.prPlanPayload;
    const prPlanCommandCandidate = schema.$defs?.prPlanCommandCandidate;

    expect(prPlanPayload?.required).toEqual(
      expect.arrayContaining([
        "id",
        "runId",
        "sourceBranchHint",
        "baseBranch",
        "title",
        "body",
        "preconditions",
        "blockedReasons",
        "commandCandidates",
        "createdAt"
      ])
    );
    expect(prPlanPayload?.properties?.checkpointId).toEqual({ type: "string" });
    expect(prPlanPayload?.properties?.preconditions).toEqual({
      type: "array",
      items: {
        type: "string"
      }
    });
    expect(prPlanPayload?.properties?.blockedReasons).toEqual({
      type: "array",
      items: {
        type: "string"
      }
    });
    expect(prPlanPayload?.properties?.commandCandidates).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/prPlanCommandCandidate"
      }
    });
    expect(prPlanPayload?.additionalProperties).toBe(true);
    expect(prPlanCommandCandidate?.required).toEqual(
      expect.arrayContaining(["action", "command", "reason", "decisionReady"])
    );
    expect(prPlanCommandCandidate?.properties?.action).toEqual({
      type: "string",
      enum: ["create_branch", "commit", "push", "create_pr"]
    });
    expect(prPlanCommandCandidate?.properties?.command).toEqual({
      type: "array",
      items: {
        type: "string"
      }
    });
    expect(prPlanCommandCandidate?.properties?.decisionReady).toEqual({ const: true });
    expect(prPlanCommandCandidate?.additionalProperties).toBe(true);
  });

  it("defines a focused PR execution payload schema", async () => {
    const schema = await readSchema();
    const prExecPayload = schema.$defs?.prExecPayload;
    const approvalRecord = schema.$defs?.approvalRecord;
    const approvalPlanSnapshot = schema.$defs?.approvalPlanSnapshot;

    expect(prExecPayload?.required).toEqual(
      expect.arrayContaining([
        "id",
        "planId",
        "runId",
        "mode",
        "status",
        "blockedReasons",
        "commandCandidates",
        "executedCommands",
        "message",
        "createdAt"
      ])
    );
    expect(prExecPayload?.properties?.mode).toEqual({ type: "string", enum: ["dry-run", "execute"] });
    expect(prExecPayload?.properties?.status).toEqual({ type: "string", enum: ["dry_run", "ready", "blocked"] });
    expect(prExecPayload?.properties?.approval).toEqual({ $ref: "#/$defs/approvalRecord" });
    expect(prExecPayload?.properties?.commandCandidates).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/prPlanCommandCandidate"
      }
    });
    expect(prExecPayload?.properties?.executedCommands).toEqual({
      type: "array",
      items: {
        type: "array",
        items: {
          type: "string"
        }
      }
    });
    expect(prExecPayload?.additionalProperties).toBe(true);
    expect(approvalRecord?.required).toEqual(
      expect.arrayContaining(["id", "scope", "planId", "runId", "status", "createdAt"])
    );
    expect(approvalRecord?.properties?.scope).toEqual({ const: "pr_execution" });
    expect(approvalRecord?.properties?.status).toEqual({ type: "string", enum: ["pending", "approved", "rejected"] });
    expect(approvalRecord?.properties?.planSnapshot).toEqual({ $ref: "#/$defs/approvalPlanSnapshot" });
    expect(approvalRecord?.additionalProperties).toBe(true);
    expect(approvalPlanSnapshot?.required).toEqual(
      expect.arrayContaining(["planTitle", "baseBranch", "sourceBranchHint", "blockedReasons", "commandCandidateActions"])
    );
  });

  it("defines approve-pr payload as the approval record schema", async () => {
    const schema = await readSchema();

    expect(schema.$defs?.approvePrPayload).toEqual({ $ref: "#/$defs/approvalRecord" });
    expect(schema.$defs?.approvalRecord?.required).toEqual(
      expect.arrayContaining(["id", "scope", "planId", "runId", "status", "createdAt"])
    );
    expect(schema.$defs?.approvalRecord?.properties?.approvedBy).toEqual({ type: "string" });
    expect(schema.$defs?.approvalRecord?.properties?.reason).toEqual({ type: "string" });
  });

  it("defines a focused execution audit payload schema", async () => {
    const schema = await readSchema();
    const executionAuditPayload = schema.$defs?.executionAuditPayload;
    const executionAuditResponsePayload = schema.$defs?.executionAuditResponsePayload;
    const executionAuditErrorPayload = schema.$defs?.executionAuditErrorPayload;
    const executionAuditListPayload = schema.$defs?.executionAuditListPayload;
    const executionAuditIntentReport = schema.$defs?.executionAuditIntentReport;
    const executionAuditTraceReport = schema.$defs?.executionAuditTraceReport;

    expect(executionAuditPayload?.required).toEqual(
      expect.arrayContaining([
        "intent",
        "traces",
        "traceCount",
        "plannedTraceCount",
        "blockedTraceCount",
        "traceActionSummary",
        "blockedReasonCount",
        "blockedReasons",
        "mismatchedTraceCount",
        "mismatchedTraceIds",
        "executionEnabled",
        "writeExecution",
        "hasExecutionResults"
      ])
    );
    expect(executionAuditPayload?.properties?.intent).toEqual({ $ref: "#/$defs/executionAuditIntentReport" });
    expect(executionAuditPayload?.properties?.traces).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/executionAuditTraceReport"
      }
    });
    expect(executionAuditPayload?.properties?.executionEnabled).toEqual({ const: false });
    expect(executionAuditPayload?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(executionAuditPayload?.properties?.hasExecutionResults).toEqual({ const: false });
    expect(executionAuditPayload?.additionalProperties).toBe(true);
    expect(executionAuditErrorPayload?.required).toEqual(
      expect.arrayContaining([
        "status",
        "errorCode",
        "message",
        "intent",
        "executionEnabled",
        "writeExecution",
        "hasExecutionResults"
      ])
    );
    expect(executionAuditErrorPayload?.properties?.status).toEqual({
      type: "string",
      enum: ["not_found", "error"]
    });
    expect(executionAuditErrorPayload?.properties?.errorCode).toEqual({
      type: "string",
      enum: [
        "execution_intent_not_found",
        "execution_audit_missing_intent",
        "invalid_execution_intent_file",
        "invalid_execution_trace_file"
      ]
    });
    expect(executionAuditErrorPayload?.properties?.intent).toEqual({ const: null });
    expect(executionAuditErrorPayload?.properties?.details).toEqual({
      type: "object",
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: ["execution_intent", "execution_trace"]
        }
      },
      additionalProperties: true
    });
    expect(executionAuditErrorPayload?.properties?.executionEnabled).toEqual({ const: false });
    expect(executionAuditErrorPayload?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(executionAuditErrorPayload?.properties?.hasExecutionResults).toEqual({ const: false });
    expect(executionAuditListPayload?.required).toEqual(
      expect.arrayContaining([
        "status",
        "bundleCount",
        "bundles",
        "executionEnabled",
        "writeExecution",
        "hasExecutionResults"
      ])
    );
    expect(executionAuditListPayload?.properties?.status).toEqual({ const: "ok" });
    expect(executionAuditListPayload?.properties?.bundleCount).toEqual({
      type: "integer",
      minimum: 0
    });
    expect(executionAuditListPayload?.properties?.bundles).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/executionAuditPayload"
      }
    });
    expect(executionAuditListPayload?.properties?.executionEnabled).toEqual({ const: false });
    expect(executionAuditListPayload?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(executionAuditListPayload?.properties?.hasExecutionResults).toEqual({ const: false });
    expect(executionAuditResponsePayload?.required).toEqual(
      expect.arrayContaining(["executionEnabled", "writeExecution", "hasExecutionResults"])
    );
    expect(executionAuditResponsePayload?.oneOf).toEqual([
      { $ref: "#/$defs/executionAuditPayload" },
      { $ref: "#/$defs/executionAuditListPayload" },
      { $ref: "#/$defs/executionAuditErrorPayload" }
    ]);
    expect(executionAuditIntentReport?.required).toEqual(
      expect.arrayContaining([
        "id",
        "runId",
        "planId",
        "approvalId",
        "status",
        "actor",
        "createdAt",
        "expiresAt",
        "targetRef",
        "baseBranch",
        "sourceBranch",
        "permissionMode",
        "policyVersion",
        "commandCandidateCount",
        "commandCandidateActions",
        "commandActionSummary",
        "blockedReasonCount",
        "blockedReasons",
        "executionEnabled",
        "writeExecution"
      ])
    );
    expect(executionAuditTraceReport?.required).toEqual(
      expect.arrayContaining([
        "id",
        "intentId",
        "runId",
        "planId",
        "approvalId",
        "action",
        "argv",
        "reason",
        "status",
        "policyVersion",
        "policyDecision",
        "blockedReasonCount",
        "blockedReasons",
        "createdAt",
        "executionEnabled",
        "writeExecution",
        "hasExecutionResults"
      ])
    );
    expect(executionAuditTraceReport?.properties?.hasExecutionResults).toEqual({ const: false });
  });

  it("defines write readiness payload schemas and response branch contract", async () => {
    const schema = await readSchema();
    const writeReadinessPayload = schema.$defs?.writeReadinessPayload;
    const writeReadinessBlocker = schema.$defs?.writeReadinessBlocker;
    const writeReadinessCheck = schema.$defs?.writeReadinessCheck;
    const writeReadinessInputs = schema.$defs?.writeReadinessInputs;
    const writeReadinessErrorPayload = schema.$defs?.writeReadinessErrorPayload;
    const writeReadinessResponsePayload = schema.$defs?.writeReadinessResponsePayload;

    expect(schema.properties?.command?.enum).toContain("write-readiness");
    expect(branchRefsForCommand(schema, "write-readiness")).toEqual(["#/$defs/writeReadinessResponsePayload"]);
    expect(schema.$defs?.writeReadinessStatus).toEqual({
      type: "string",
      enum: ["ready", "blocked", "unknown"]
    });
    expect(schema.$defs?.writeReadinessCategory).toEqual({
      type: "string",
      enum: ["approval", "precondition", "permission", "trace", "policy", "ci", "repo_state", "unknown"]
    });
    expect(schema.$defs?.writeReadinessCheckStatus).toEqual({
      type: "string",
      enum: ["pass", "blocked", "unknown"]
    });
    expect(schema.$defs?.writeReadinessSource).toEqual({
      type: "string",
      enum: ["audit_bundle", "preflight"]
    });
    expect(writeReadinessPayload?.required).toEqual(
      expect.arrayContaining([
        "readinessStatus",
        "ready",
        "intentId",
        "runId",
        "planId",
        "approvalId",
        "blockers",
        "checks",
        "inputs",
        "executionEnabled",
        "writeExecution",
        "hasExecutionResults"
      ])
    );
    expect(writeReadinessPayload?.required).not.toContain("checkpointId");
    expect(writeReadinessPayload?.properties?.readinessStatus).toEqual({ $ref: "#/$defs/writeReadinessStatus" });
    expect(writeReadinessPayload?.properties?.ready).toEqual({ type: "boolean" });
    expect(writeReadinessPayload?.properties?.checkpointId).toEqual({ type: "string" });
    expect(writeReadinessPayload?.properties?.blockers).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/writeReadinessBlocker"
      }
    });
    expect(writeReadinessPayload?.properties?.checks).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/writeReadinessCheck"
      }
    });
    expect(writeReadinessPayload?.properties?.inputs).toEqual({ $ref: "#/$defs/writeReadinessInputs" });
    expect(writeReadinessPayload?.properties?.executionEnabled).toEqual({ const: false });
    expect(writeReadinessPayload?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(writeReadinessPayload?.properties?.hasExecutionResults).toEqual({ const: false });
    expect(writeReadinessPayload?.additionalProperties).toBe(true);
    expect(writeReadinessBlocker?.required).toEqual(expect.arrayContaining(["category", "code", "message", "source"]));
    expect(writeReadinessBlocker?.properties?.category).toEqual({ $ref: "#/$defs/writeReadinessCategory" });
    expect(writeReadinessBlocker?.properties?.source).toEqual({ $ref: "#/$defs/writeReadinessSource" });
    expect(writeReadinessBlocker?.additionalProperties).toBe(true);
    expect(writeReadinessCheck?.required).toEqual(
      expect.arrayContaining(["category", "status", "code", "message", "source"])
    );
    expect(writeReadinessCheck?.properties?.status).toEqual({ $ref: "#/$defs/writeReadinessCheckStatus" });
    expect(writeReadinessCheck?.additionalProperties).toBe(true);
    expect(writeReadinessInputs?.required).toEqual(expect.arrayContaining(["auditBundle", "preflight"]));
    expect(writeReadinessInputs?.properties?.auditBundle).toEqual({ const: "available" });
    expect(writeReadinessInputs?.properties?.preflight).toEqual({
      type: "string",
      enum: ["missing", "partial", "available"]
    });
    expect(writeReadinessInputs?.additionalProperties).toBe(true);
    expect(writeReadinessErrorPayload?.required).toEqual(
      expect.arrayContaining([
        "status",
        "errorCode",
        "message",
        "readiness",
        "executionEnabled",
        "writeExecution",
        "hasExecutionResults"
      ])
    );
    expect(writeReadinessErrorPayload?.properties?.errorCode).toEqual({
      type: "string",
      enum: [
        "write_readiness_missing_intent",
        "write_readiness_intent_not_found",
        "invalid_execution_intent_file",
        "invalid_execution_trace_file",
        "write_readiness_preflight_missing_path",
        "write_readiness_preflight_file_not_found",
        "write_readiness_preflight_file_not_readable",
        "write_readiness_preflight_invalid_json",
        "write_readiness_preflight_invalid_schema"
      ]
    });
    expect(writeReadinessErrorPayload?.properties?.readiness).toEqual({ const: null });
    expect(writeReadinessErrorPayload?.properties?.executionEnabled).toEqual({ const: false });
    expect(writeReadinessErrorPayload?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(writeReadinessErrorPayload?.properties?.hasExecutionResults).toEqual({ const: false });
    expect(writeReadinessErrorPayload?.additionalProperties).toBe(true);
    expect(writeReadinessResponsePayload?.required).toEqual(
      expect.arrayContaining(["executionEnabled", "writeExecution", "hasExecutionResults"])
    );
    expect(writeReadinessResponsePayload?.oneOf).toEqual([
      { $ref: "#/$defs/writeReadinessPayload" },
      { $ref: "#/$defs/writeReadinessErrorPayload" }
    ]);
    expect(writeReadinessResponsePayload?.additionalProperties).toBe(true);
  });

  it("defines write runner dry-run payload schemas and response branch contract", async () => {
    const schema = await readSchema();
    const writeRunnerDryRunPayload = schema.$defs?.writeRunnerDryRunPayload;
    const writeRunnerExecutionPolicy = schema.$defs?.writeRunnerExecutionPolicy;
    const writeRunnerPlanItem = schema.$defs?.writeRunnerPlanItem;
    const writeRunnerSimulationResult = schema.$defs?.writeRunnerSimulationResult;
    const writeRunnerErrorPayload = schema.$defs?.writeRunnerErrorPayload;
    const writeRunnerResponsePayload = schema.$defs?.writeRunnerResponsePayload;

    expect(schema.properties?.command?.enum).toContain("write-runner");
    expect(branchRefsForCommand(schema, "write-runner")).toEqual(["#/$defs/writeRunnerResponsePayload"]);
    expect(schema.$defs?.writeRunnerStatus).toEqual({
      type: "string",
      enum: ["planned", "blocked", "simulated", "disabled"]
    });
    expect(schema.$defs?.writeRunnerExecutionMode).toEqual({
      type: "string",
      enum: ["dry_run", "simulate", "execute_disabled"]
    });
    expect(writeRunnerDryRunPayload?.required).toEqual(
      expect.arrayContaining([
        "status",
        "intentId",
        "runId",
        "planId",
        "approvalId",
        "readinessStatus",
        "ready",
        "planItemCount",
        "planItems",
        "traceCount",
        "traceIds",
        "localTracePersistence",
        "policy",
        "simulationResultCount",
        "simulationResults",
        "blockedReasonCount",
        "blockedReasons",
        "createdAt",
        "executionEnabled",
        "writeExecution",
        "hasExecutionResults"
      ])
    );
    expect(writeRunnerDryRunPayload?.required).not.toContain("checkpointId");
    expect(writeRunnerDryRunPayload?.properties?.status).toEqual({ $ref: "#/$defs/writeRunnerStatus" });
    expect(writeRunnerDryRunPayload?.properties?.readinessStatus).toEqual({ $ref: "#/$defs/writeReadinessStatus" });
    expect(writeRunnerDryRunPayload?.properties?.planItems).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/writeRunnerPlanItem"
      }
    });
    expect(writeRunnerDryRunPayload?.properties?.traceIds).toEqual({
      type: "array",
      items: {
        type: "string"
      }
    });
    expect(writeRunnerDryRunPayload?.properties?.localTracePersistence).toEqual({
      type: "string",
      enum: ["saved", "skipped"]
    });
    expect(writeRunnerDryRunPayload?.properties?.policy).toEqual({ $ref: "#/$defs/writeRunnerExecutionPolicy" });
    expect(writeRunnerDryRunPayload?.properties?.simulationResultCount).toEqual({
      type: "integer",
      minimum: 0
    });
    expect(writeRunnerDryRunPayload?.properties?.simulationResults).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/writeRunnerSimulationResult"
      }
    });
    expect(writeRunnerDryRunPayload?.properties?.executionEnabled).toEqual({ const: false });
    expect(writeRunnerDryRunPayload?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(writeRunnerDryRunPayload?.properties?.hasExecutionResults).toEqual({ const: false });
    expect(writeRunnerDryRunPayload?.additionalProperties).toBe(true);
    expect(writeRunnerPlanItem?.required).toEqual(expect.arrayContaining(["action", "summary"]));
    expect(writeRunnerPlanItem?.properties?.action).toEqual({
      type: "string",
      enum: ["create_branch", "commit", "push", "create_pr"]
    });
    expect(writeRunnerPlanItem?.properties).not.toHaveProperty("argv");
    expect(writeRunnerExecutionPolicy?.required).toEqual(
      expect.arrayContaining([
        "mode",
        "requiredReadiness",
        "allowedActions",
        "disallowedActions",
        "blockers",
        "actualExecutionEnabled",
        "executionEnabled",
        "writeExecution"
      ])
    );
    expect(writeRunnerExecutionPolicy?.properties?.mode).toEqual({ $ref: "#/$defs/writeRunnerExecutionMode" });
    expect(writeRunnerExecutionPolicy?.properties?.requiredReadiness).toEqual({ const: "ready" });
    expect(writeRunnerExecutionPolicy?.properties?.actualExecutionEnabled).toEqual({ const: false });
    expect(writeRunnerExecutionPolicy?.properties?.executionEnabled).toEqual({ const: false });
    expect(writeRunnerExecutionPolicy?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(writeRunnerSimulationResult?.required).toEqual(
      expect.arrayContaining(["action", "status", "summary", "executionEnabled", "writeExecution", "hasExecutionResults"])
    );
    expect(writeRunnerSimulationResult?.properties?.status).toEqual({
      type: "string",
      enum: ["simulated", "skipped"]
    });
    expect(writeRunnerSimulationResult?.properties?.executionEnabled).toEqual({ const: false });
    expect(writeRunnerSimulationResult?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(writeRunnerSimulationResult?.properties?.hasExecutionResults).toEqual({ const: false });
    expect(writeRunnerErrorPayload?.required).toEqual(
      expect.arrayContaining(["status", "errorCode", "message", "dryRun", "executionEnabled", "writeExecution", "hasExecutionResults"])
    );
    expect(writeRunnerErrorPayload?.properties?.errorCode).toEqual({
      type: "string",
      enum: [
        "write_runner_missing_intent",
        "write_runner_requires_json",
        "write_runner_intent_not_found",
        "invalid_execution_intent_file",
        "invalid_execution_trace_file",
        "write_runner_preflight_missing_path",
        "write_runner_preflight_file_not_found",
        "write_runner_preflight_file_not_readable",
        "write_runner_preflight_invalid_json",
        "write_runner_preflight_invalid_schema"
      ]
    });
    expect(writeRunnerErrorPayload?.properties?.dryRun).toEqual({ const: null });
    expect(writeRunnerErrorPayload?.properties?.executionEnabled).toEqual({ const: false });
    expect(writeRunnerErrorPayload?.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(writeRunnerErrorPayload?.properties?.hasExecutionResults).toEqual({ const: false });
    expect(writeRunnerResponsePayload?.required).toEqual(
      expect.arrayContaining(["executionEnabled", "writeExecution", "hasExecutionResults"])
    );
    expect(writeRunnerResponsePayload?.oneOf).toEqual([
      { $ref: "#/$defs/writeRunnerDryRunPayload" },
      { $ref: "#/$defs/writeRunnerErrorPayload" }
    ]);
    expect(writeRunnerResponsePayload?.additionalProperties).toBe(true);
  });

  it("defines a focused doctor payload schema", async () => {
    const schema = await readSchema();
    const doctorPayload = schema.$defs?.doctorPayload;
    const doctorCheck = schema.$defs?.doctorCheck;
    const doctorSuggestion = schema.$defs?.doctorSuggestion;

    expect(schema.$defs?.doctorStatus).toEqual({ type: "string", enum: ["pass", "warn", "fail"] });
    expect(doctorPayload?.required).toEqual(expect.arrayContaining(["status", "rootDir", "githubMode", "checks"]));
    expect(doctorPayload?.properties?.status).toEqual({ $ref: "#/$defs/doctorStatus" });
    expect(doctorPayload?.properties?.githubMode).toEqual({ type: "string", enum: ["none", "gh-cli"] });
    expect(doctorPayload?.properties?.checks).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/doctorCheck"
      }
    });
    expect(doctorPayload?.additionalProperties).toBe(true);
    expect(doctorCheck?.required).toEqual(expect.arrayContaining(["id", "status", "summary"]));
    expect(doctorCheck?.properties?.status).toEqual({ $ref: "#/$defs/doctorStatus" });
    expect(doctorCheck?.properties?.suggestions).toEqual({
      type: "array",
      items: {
        $ref: "#/$defs/doctorSuggestion"
      }
    });
    expect(doctorCheck?.additionalProperties).toBe(true);
    expect(doctorSuggestion?.required).toEqual(
      expect.arrayContaining(["label", "command", "reason", "destructive"])
    );
    expect(doctorSuggestion?.properties?.command).toEqual({
      type: "array",
      items: {
        type: "string"
      }
    });
    expect(doctorSuggestion?.properties?.destructive).toEqual({ type: "boolean" });
    expect(doctorSuggestion?.additionalProperties).toBe(true);
  });

  it("defines a focused init payload schema", async () => {
    const schema = await readSchema();
    const initPayload = schema.$defs?.initPayload;
    const initFileResult = schema.$defs?.initFileResult;

    expect(schema.$defs?.initFileStatus).toEqual({ type: "string", enum: ["created", "updated", "skipped"] });
    expect(initPayload?.required).toEqual(expect.arrayContaining(["rootDir", "force", "files"]));
    expect(initPayload?.properties?.force).toEqual({ type: "boolean" });
    expect(initPayload?.properties?.files).toEqual({
      type: "object",
      required: ["config", "gitignore"],
      properties: {
        config: {
          $ref: "#/$defs/initFileResult"
        },
        gitignore: {
          $ref: "#/$defs/initFileResult"
        }
      },
      additionalProperties: true
    });
    expect(initPayload?.additionalProperties).toBe(true);
    expect(initFileResult?.required).toEqual(expect.arrayContaining(["path", "status"]));
    expect(initFileResult?.properties?.status).toEqual({ $ref: "#/$defs/initFileStatus" });
    expect(initFileResult?.properties?.reason).toEqual({ type: "string" });
    expect(initFileResult?.additionalProperties).toBe(true);
  });

  it("tracks every CLI JSON command with a command-specific schema branch", async () => {
    const schema = await readSchema();
    const expectedRefs: Record<(typeof cliJsonCommands)[number], string> = {
      init: "#/$defs/initPayload",
      doctor: "#/$defs/doctorPayload",
      run: "#/$defs/runReportPayload",
      resume: "#/$defs/runResponsePayload",
      status: "#/$defs/runReportPayload",
      checkpoint: "#/$defs/checkpointPayload",
      checks: "#/$defs/checksPayload",
      "pr-plan": "#/$defs/prPlanPayload",
      "pr-exec": "#/$defs/prExecPayload",
      "approve-pr": "#/$defs/approvePrPayload",
      "execution-audit": "#/$defs/executionAuditResponsePayload",
      "write-readiness": "#/$defs/writeReadinessResponsePayload",
      "write-runner": "#/$defs/writeRunnerResponsePayload"
    };

    for (const command of cliJsonCommands) {
      expect(branchRefsForCommand(schema, command)).toContain(expectedRefs[command]);
    }
  });

  it("keeps raw status and no-run responses on the flexible envelope path", async () => {
    const schema = await readSchema();

    expect(branchesForCommand(schema, "status")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          if: expect.objectContaining({
            required: ["command", "runId"]
          }),
          then: {
            $ref: "#/$defs/runReportPayload"
          }
        })
      ])
    );

    for (const command of ["checkpoint", "pr-plan", "pr-exec", "approve-pr"] as const) {
      expect(branchesForCommand(schema, command)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            if: expect.objectContaining({
              required: ["command", "id"]
            })
          })
        ])
      );
    }
  });

  it("applies the run response branch only to resume, and the run report branch to run and explicit status reports", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "run"
              }
            },
            required: ["command"]
          },
          then: {
            $ref: "#/$defs/runReportPayload"
          }
        },
        {
          if: {
            properties: {
              command: {
                const: "resume"
              }
            },
            required: ["command"]
          },
          then: {
            $ref: "#/$defs/runResponsePayload"
          }
        },
        {
          if: {
            properties: {
              command: {
                const: "status"
              }
            },
            required: ["command", "runId"]
          },
          then: {
            $ref: "#/$defs/runReportPayload"
          }
        }
      ])
    );
  });

  it("applies the checks branch to checks responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "checks"
              }
            },
            required: ["command"]
          },
          then: {
            $ref: "#/$defs/checksPayload"
          }
        }
      ])
    );
  });

  it("applies the checkpoint branch to checkpoint responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "checkpoint"
              }
            },
            required: ["command", "id"]
          },
          then: {
            $ref: "#/$defs/checkpointPayload"
          }
        }
      ])
    );
  });

  it("applies the PR plan branch to concrete PR plan responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "pr-plan"
              }
            },
            required: ["command", "id"]
          },
          then: {
            $ref: "#/$defs/prPlanPayload"
          }
        }
      ])
    );
  });

  it("applies the PR execution branch to concrete PR execution responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "pr-exec"
              }
            },
            required: ["command", "id"]
          },
          then: {
            $ref: "#/$defs/prExecPayload"
          }
        }
      ])
    );
  });

  it("applies the approve-pr branch to concrete approval responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "approve-pr"
              }
            },
            required: ["command", "id"]
          },
          then: {
            $ref: "#/$defs/approvePrPayload"
          }
        }
      ])
    );
  });

  it("applies the execution audit branch to all execution audit responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "execution-audit"
              }
            },
            required: ["command"]
          },
          then: {
            $ref: "#/$defs/executionAuditResponsePayload"
          }
        }
      ])
    );
  });

  it("applies the write readiness branch to all write readiness responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "write-readiness"
              }
            },
            required: ["command"]
          },
          then: {
            $ref: "#/$defs/writeReadinessResponsePayload"
          }
        }
      ])
    );
  });

  it("applies the doctor branch to doctor responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "doctor"
              }
            },
            required: ["command"]
          },
          then: {
            $ref: "#/$defs/doctorPayload"
          }
        }
      ])
    );
  });

  it("applies the init branch to init responses", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                const: "init"
              }
            },
            required: ["command"]
          },
          then: {
            $ref: "#/$defs/initPayload"
          }
        }
      ])
    );
  });

  it("documents and links the schema artifact", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const docs = await readFile(join(root, "docs", "json-output.md"), "utf8");

    expect(readme).toContain("docs/json-output.md");
    expect(readme).toContain("schemas/cli-json.schema.json");
    expect(docs).toContain("schemaVersion");
    expect(docs).toContain("Run Report Schema");
    expect(docs).toContain("Checks Schema");
    expect(docs).toContain("Checkpoint Schema");
    expect(docs).toContain("PR Plan Schema");
    expect(docs).toContain("PR Execution Schema");
    expect(docs).toContain("PR Approval Schema");
    expect(docs).toContain("Execution Audit Schema");
    expect(docs).toContain("Write Readiness Schema");
    expect(docs).toContain("Write Runner Schema");
    expect(docs).toContain("Doctor Schema");
    expect(docs).toContain("Init Schema");
    expect(docs).toContain("Coverage and Exceptions");
    expect(docs).toContain("status --json --raw");
    expect(docs).toContain("No-run responses from `checkpoint`, `pr-plan`, `pr-exec`, and `approve-pr`");
    expect(docs).toContain("../schemas/cli-json.schema.json");
  });

  it("keeps docs schema sections aligned with required payload fields", async () => {
    const schema = await readSchema();
    const docs = await readFile(join(root, "docs", "json-output.md"), "utf8");
    const sections = [
      { heading: "Init Schema", required: requiredFields(schema.$defs?.initPayload) },
      { heading: "Doctor Schema", required: requiredFields(schema.$defs?.doctorPayload) },
      { heading: "Run Report Schema", required: requiredFields(schema.$defs?.runReportPayload) },
      { heading: "Checks Schema", required: requiredFields(schema.$defs?.checksPayload) },
      { heading: "Checkpoint Schema", required: requiredFields(schema.$defs?.checkpointPayload) },
      { heading: "PR Plan Schema", required: requiredFields(schema.$defs?.prPlanPayload) },
      { heading: "PR Execution Schema", required: requiredFields(schema.$defs?.prExecPayload) },
      { heading: "PR Approval Schema", required: requiredFields(schema.$defs?.approvalRecord) },
      { heading: "Execution Audit Schema", required: requiredFields(schema.$defs?.executionAuditPayload) },
      { heading: "Execution Audit Schema", required: requiredFields(schema.$defs?.executionAuditListPayload) },
      { heading: "Execution Audit Schema", required: requiredFields(schema.$defs?.executionAuditErrorPayload) },
      { heading: "Execution Audit Schema", required: requiredFields(schema.$defs?.executionAuditResponsePayload) },
      { heading: "Write Readiness Schema", required: requiredFields(schema.$defs?.writeReadinessPayload) },
      { heading: "Write Readiness Schema", required: requiredFields(schema.$defs?.writeReadinessErrorPayload) },
      { heading: "Write Readiness Schema", required: requiredFields(schema.$defs?.writeReadinessResponsePayload) },
      { heading: "Write Runner Schema", required: requiredFields(schema.$defs?.writeRunnerDryRunPayload) },
      { heading: "Write Runner Schema", required: requiredFields(schema.$defs?.writeRunnerErrorPayload) },
      { heading: "Write Runner Schema", required: requiredFields(schema.$defs?.writeRunnerResponsePayload) }
    ];

    for (const section of sections) {
      const text = docsSection(docs, section.heading);
      for (const field of section.required) {
        expect(text, `${section.heading} should mention required field ${field}`).toMatch(backtickedField(field));
      }
    }
  });

  it("keeps docs schema sections aligned with selected nested required fields", async () => {
    const schema = await readSchema();
    const docs = await readFile(join(root, "docs", "json-output.md"), "utf8");
    const sections = [
      {
        heading: "Doctor Schema",
        required: [...requiredFields(schema.$defs?.doctorCheck), ...requiredFields(schema.$defs?.doctorSuggestion)]
      },
      { heading: "Init Schema", required: requiredFields(schema.$defs?.initFileResult) },
      { heading: "Checks Schema", required: requiredFields(schema.$defs?.checkDetail) },
      { heading: "PR Plan Schema", required: requiredFields(schema.$defs?.prPlanCommandCandidate) },
      {
        heading: "PR Approval Schema",
        required: [...requiredFields(schema.$defs?.approvalRecord), ...requiredFields(schema.$defs?.approvalPlanSnapshot)]
      },
      {
        heading: "Execution Audit Schema",
        required: [
          ...requiredFields(schema.$defs?.executionAuditIntentReport),
          ...requiredFields(schema.$defs?.executionAuditTraceReport)
        ]
      },
      {
        heading: "Write Readiness Schema",
        required: [
          ...requiredFields(schema.$defs?.writeReadinessBlocker),
          ...requiredFields(schema.$defs?.writeReadinessCheck),
          ...requiredFields(schema.$defs?.writeReadinessInputs)
        ]
      }
    ];

    for (const section of sections) {
      const text = docsSection(docs, section.heading);
      for (const field of section.required) {
        expect(text, `${section.heading} should mention nested required field ${field}`).toMatch(backtickedField(field));
      }
    }
  });
});

async function readSchema(): Promise<{
  $schema?: string;
  required?: string[];
  properties?: {
    schemaVersion?: { const?: number };
    command?: { enum?: string[] };
    createdAt?: { type?: string; format?: string };
  };
  $defs?: {
    runReportPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    runLookupErrorPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    runResponsePayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      anyOf?: unknown[];
      additionalProperties?: boolean;
    };
    githubCheckStatus?: {
      type?: string;
      enum?: string[];
    };
    doctorStatus?: {
      type?: string;
      enum?: string[];
    };
    doctorPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    doctorCheck?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    doctorSuggestion?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    initFileStatus?: {
      type?: string;
      enum?: string[];
    };
    initPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    initFileResult?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    checkpointStatus?: {
      type?: string;
      enum?: string[];
    };
    checkpointPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    checkpointCounts?: {
      required?: string[];
    };
    checkpointCiCheck?: {
      required?: string[];
    };
    prPlanPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    prPlanCommandCandidate?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    prExecPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    approvalRecord?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    approvePrPayload?: Record<string, unknown>;
    executionAuditPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    executionAuditListPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    executionAuditErrorPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    executionAuditResponsePayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      oneOf?: unknown[];
      additionalProperties?: boolean;
    };
    executionAuditIntentReport?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    executionAuditTraceReport?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeReadinessStatus?: {
      type?: string;
      enum?: string[];
    };
    writeReadinessCategory?: {
      type?: string;
      enum?: string[];
    };
    writeReadinessCheckStatus?: {
      type?: string;
      enum?: string[];
    };
    writeReadinessSource?: {
      type?: string;
      enum?: string[];
    };
    writeReadinessPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeReadinessBlocker?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeReadinessCheck?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeReadinessInputs?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeReadinessErrorPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeReadinessResponsePayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      oneOf?: unknown[];
      additionalProperties?: boolean;
    };
    writeRunnerStatus?: {
      type?: string;
      enum?: string[];
    };
    writeRunnerExecutionMode?: {
      type?: string;
      enum?: string[];
    };
    writeRunnerExecutionPolicy?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeRunnerDryRunPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeRunnerPlanItem?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeRunnerSimulationResult?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeRunnerErrorPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    writeRunnerResponsePayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      oneOf?: unknown[];
      additionalProperties?: boolean;
    };
    approvalPlanSnapshot?: {
      required?: string[];
    };
    maintainerActionCandidate?: {
      required?: string[];
    };
    ownerDecisionItem?: {
      required?: string[];
    };
    checksPayload?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    checkDetail?: {
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    subtaskCounts?: {
      required?: string[];
    };
  };
  allOf?: unknown[];
  additionalProperties?: boolean;
}> {
  return JSON.parse(await readFile(join(root, "schemas", "cli-json.schema.json"), "utf8")) as {
    $schema?: string;
    required?: string[];
    properties?: {
      schemaVersion?: { const?: number };
      command?: { enum?: string[] };
      createdAt?: { type?: string; format?: string };
    };
    $defs?: {
      runReportPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      runLookupErrorPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      runResponsePayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        anyOf?: unknown[];
        additionalProperties?: boolean;
      };
      githubCheckStatus?: {
        type?: string;
        enum?: string[];
      };
      doctorStatus?: {
        type?: string;
        enum?: string[];
      };
      doctorPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      doctorCheck?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      doctorSuggestion?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      initFileStatus?: {
        type?: string;
        enum?: string[];
      };
      initPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      initFileResult?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      checkpointStatus?: {
        type?: string;
        enum?: string[];
      };
      checkpointPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      checkpointCounts?: {
        required?: string[];
      };
      checkpointCiCheck?: {
        required?: string[];
      };
      prPlanPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      prPlanCommandCandidate?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      prExecPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      approvalRecord?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      approvePrPayload?: Record<string, unknown>;
      executionAuditPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      executionAuditListPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      executionAuditErrorPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      executionAuditResponsePayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        oneOf?: unknown[];
        additionalProperties?: boolean;
      };
      executionAuditIntentReport?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      executionAuditTraceReport?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeReadinessStatus?: {
        type?: string;
        enum?: string[];
      };
      writeReadinessCategory?: {
        type?: string;
        enum?: string[];
      };
      writeReadinessCheckStatus?: {
        type?: string;
        enum?: string[];
      };
      writeReadinessSource?: {
        type?: string;
        enum?: string[];
      };
      writeReadinessPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeReadinessBlocker?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeReadinessCheck?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeReadinessInputs?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeReadinessErrorPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeReadinessResponsePayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        oneOf?: unknown[];
        additionalProperties?: boolean;
      };
      writeRunnerStatus?: {
        type?: string;
        enum?: string[];
      };
      writeRunnerExecutionMode?: {
        type?: string;
        enum?: string[];
      };
      writeRunnerExecutionPolicy?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeRunnerDryRunPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeRunnerPlanItem?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeRunnerSimulationResult?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeRunnerErrorPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      writeRunnerResponsePayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        oneOf?: unknown[];
        additionalProperties?: boolean;
      };
      approvalPlanSnapshot?: {
        required?: string[];
      };
      maintainerActionCandidate?: {
        required?: string[];
      };
      ownerDecisionItem?: {
        required?: string[];
      };
      checksPayload?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      checkDetail?: {
        required?: string[];
        properties?: Record<string, unknown>;
        additionalProperties?: boolean;
      };
      subtaskCounts?: {
        required?: string[];
      };
    };
    allOf?: unknown[];
    additionalProperties?: boolean;
  };
}

function branchRefsForCommand(schema: { allOf?: unknown[] }, command: string): string[] {
  return branchesForCommand(schema, command)
    .map((branch) => asRecord(branch.then)?.$ref)
    .filter((value): value is string => typeof value === "string");
}

function branchesForCommand(schema: { allOf?: unknown[] }, command: string): JsonObject[] {
  return (schema.allOf ?? []).filter((branch): branch is JsonObject => {
    if (!isRecord(branch)) {
      return false;
    }

    const condition = asRecord(branch.if);
    const properties = asRecord(condition?.properties);
    const commandSchema = asRecord(properties?.command);
    const commandConst = commandSchema?.const;
    const commandEnum = commandSchema?.enum;

    return commandConst === command || (Array.isArray(commandEnum) && commandEnum.includes(command));
  });
}

function requiredFields(definition: { required?: string[] } | undefined): string[] {
  expect(definition?.required?.length).toBeGreaterThan(0);
  return definition?.required ?? [];
}

function docsSection(docs: string, heading: string): string {
  const headingText = `## ${heading}\n`;
  const start = docs.indexOf(headingText);
  expect(start, `Missing docs section ${heading}`).toBeGreaterThanOrEqual(0);

  const contentStart = start + headingText.length;
  const nextSection = docs.indexOf("\n## ", contentStart);
  return docs.slice(contentStart, nextSection === -1 ? undefined : nextSection);
}

function backtickedField(field: string): RegExp {
  return new RegExp(`\\\`${escapeRegExp(field)}\\\``);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(value: unknown): JsonObject | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

type JsonObject = Record<string, unknown>;

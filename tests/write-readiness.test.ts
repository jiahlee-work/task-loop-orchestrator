import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPullRequestApproval } from "../src/approval.js";
import type { ExecutionAuditBundle, PullRequestPlan, WriteExecutionReadinessPreflightInput } from "../src/domain.js";
import {
  createExecutionDryRunTraces,
  createExecutionIntent,
  summarizeExecutionAuditBundle
} from "../src/execution-intents.js";
import {
  formatWriteExecutionReadiness,
  formatWriteReadinessError,
  loadWriteReadinessPreflightInput,
  parseWriteReadinessPreflightInput,
  summarizeWriteExecutionReadiness
} from "../src/write-readiness.js";

const root = process.cwd();

describe("write execution readiness helper", () => {
  it("blocks readiness when the audit bundle contains blocked traces or blocked reasons", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."]);
    const bundle = executionAuditBundle("2026-06-22T00:00:00.000Z", {
      approvedPlan,
      currentPlan
    });

    const report = summarizeWriteExecutionReadiness(bundle);

    expect(report.readinessStatus).toBe("blocked");
    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "trace",
          code: "blocked_dry_run_trace",
          source: "audit_bundle"
        }),
        expect.objectContaining({
          category: "precondition",
          code: "audit_blocked_reason",
          message: "Repository status is not clean.",
          source: "audit_bundle"
        })
      ])
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "trace", status: "blocked", source: "audit_bundle" }),
        expect.objectContaining({ category: "precondition", status: "blocked", source: "audit_bundle" })
      ])
    );
    expect(report.executionEnabled).toBe(false);
    expect(report.writeExecution).toBe("disabled");
    expect(report.hasExecutionResults).toBe(false);
    expectNoUnsafeReadinessOutput(report);
  });

  it("returns unknown readiness when future preflight input is missing", () => {
    const bundle = executionAuditBundle("2026-06-22T00:00:00.000Z", {
      commandSecret: "top-secret-readiness"
    });

    const report = summarizeWriteExecutionReadiness(bundle);

    expect(report.readinessStatus).toBe("unknown");
    expect(report.ready).toBe(false);
    expect(report.inputs).toEqual({
      auditBundle: "available",
      preflight: "missing"
    });
    expect(report.blockers).toEqual([]);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "approval", status: "unknown", code: "approval_freshness_unverified" }),
        expect.objectContaining({ category: "ci", status: "unknown", code: "ci_policy_unverified" }),
        expect.objectContaining({ category: "repo_state", status: "unknown", code: "repo_cleanliness_unverified" }),
        expect.objectContaining({ category: "policy", status: "unknown", code: "plan_fingerprint_unverified" })
      ])
    );
    expectNoUnsafeReadinessOutput(report);
  });

  it("can report ready only when all preflight checks pass and audit bundle has no blockers", () => {
    const bundle = executionAuditBundle("2026-06-22T00:00:00.000Z");

    const report = summarizeWriteExecutionReadiness(bundle, passingPreflight());

    expect(report.readinessStatus).toBe("ready");
    expect(report.ready).toBe(true);
    expect(report.inputs.preflight).toBe("available");
    expect(report.blockers).toEqual([]);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report).toMatchObject({
      intentId: bundle.intent.id,
      runId: bundle.intent.runId,
      planId: bundle.intent.planId,
      approvalId: bundle.intent.approvalId,
      checkpointId: bundle.intent.checkpointId,
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    });
    expectNoUnsafeReadinessOutput(report);
  });

  it("turns failed preflight checks into blockers without mutating the input bundle", () => {
    const bundle = executionAuditBundle("2026-06-22T00:00:00.000Z");
    const before = JSON.stringify(bundle);

    const report = summarizeWriteExecutionReadiness(bundle, {
      ...passingPreflight(),
      ciPolicySatisfied: false,
      repoClean: false
    });

    expect(JSON.stringify(bundle)).toBe(before);
    expect(report.readinessStatus).toBe("blocked");
    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "ci", code: "ci_policy_blocked", source: "preflight" }),
        expect.objectContaining({ category: "repo_state", code: "repo_cleanliness_blocked", source: "preflight" })
      ])
    );
    expectNoUnsafeReadinessOutput(report);
  });

  it("keeps the future preflight file contract aligned with all-pass helper input", () => {
    const fixture = passingPreflightFileFixture();
    const parsed = parseWriteReadinessPreflightInput(fixture);
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z", {
        commandSecret: "top-secret-readiness"
      }),
      expectParsedPreflight(parsed)
    );

    expect(parsed).toEqual({
      ok: true,
      preflight: passingPreflight(),
      recognizedCheckCount: 10,
      ignoredCheckCount: 0
    });
    expect(fixture).toEqual({
      schemaVersion: 1,
      metadata: {
        createdAt: "2026-06-22T02:00:00.000Z",
        tool: "write-readiness-preflight-fixture"
      },
      checks: expect.arrayContaining([
        {
          category: "approval",
          status: "pass",
          code: "approval_freshness_passed",
          message: "Approval freshness is verified.",
          source: "preflight"
        },
        {
          category: "ci",
          status: "pass",
          code: "ci_policy_passed",
          message: "CI/check policy is satisfied.",
          source: "preflight"
        }
      ])
    });
    expect(fixture.checks).toHaveLength(10);
    expect(report.readinessStatus).toBe("ready");
    expect(report.ready).toBe(true);
    expect(report.inputs.preflight).toBe("available");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "approval", status: "pass", code: "approval_freshness_passed" }),
        expect.objectContaining({ category: "ci", status: "pass", code: "ci_policy_passed" }),
        expect.objectContaining({ category: "repo_state", status: "pass", code: "repo_cleanliness_passed" })
      ])
    );
    expectNoUnsafeReadinessOutput(fixture);
    expectNoUnsafeReadinessOutput(report);
  });

  it("keeps blocked future preflight evidence safe and non-executing", () => {
    const fixture = {
      ...passingPreflightFileFixture(),
      checks: passingPreflightFileFixture().checks.map((check) =>
        check.code === "ci_policy_passed"
          ? {
              ...check,
              status: "blocked" as const,
              code: "ci_policy_blocked",
              message: "CI/check policy is not satisfied."
            }
          : check
      )
    };
    const parsed = parseWriteReadinessPreflightInput(fixture);
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z"),
      expectParsedPreflight(parsed)
    );

    expect(parsed).toEqual({
      ok: true,
      preflight: {
        ...passingPreflight(),
        ciPolicySatisfied: false
      },
      recognizedCheckCount: 10,
      ignoredCheckCount: 0
    });
    expect(report.readinessStatus).toBe("blocked");
    expect(report.ready).toBe(false);
    expect(report.inputs.preflight).toBe("available");
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "ci",
          code: "ci_policy_blocked",
          message: "CI/check policy is not satisfied.",
          source: "preflight"
        })
      ])
    );
    expectNoUnsafeReadinessOutput(fixture);
    expectNoUnsafeReadinessOutput(report);
  });

  it("maps unknown future preflight evidence to partial helper input", () => {
    const fixture = {
      ...passingPreflightFileFixture(),
      checks: passingPreflightFileFixture().checks.map((check) =>
        check.code === "ci_policy_passed"
          ? {
              ...check,
              status: "unknown" as const,
              code: "ci_policy_unverified",
              message: "CI/check policy has not been verified."
            }
          : check
      )
    };
    const parsed = parseWriteReadinessPreflightInput(fixture);
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z"),
      expectParsedPreflight(parsed)
    );

    expect(parsed).toEqual({
      ok: true,
      preflight: {
        approvalFresh: true,
        approvalNotExpired: true,
        planFingerprintMatches: true,
        checkpointMatches: true,
        repoClean: true,
        diffVerified: true,
        refPolicySatisfied: true,
        permissionAllowed: true,
        commandRunnerConfigured: true
      },
      recognizedCheckCount: 10,
      ignoredCheckCount: 0
    });
    expect(report.readinessStatus).toBe("unknown");
    expect(report.ready).toBe(false);
    expect(report.inputs.preflight).toBe("partial");
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "ci", status: "unknown", code: "ci_policy_unverified" })])
    );
    expectNoUnsafeReadinessOutput(parsed);
    expectNoUnsafeReadinessOutput(report);
  });

  it("returns safe invalid preflight parse errors", () => {
    const unsafeFixture = {
      schemaVersion: 1,
      checks: [
        {
          category: "ci",
          status: "unexpected",
          code: "ci_policy_passed",
          message: "raw-preflight-secret should not be echoed",
          source: "preflight",
          stdout: "raw-preflight-secret",
          stderr: "raw-preflight-secret",
          exitCode: 1,
          executedCommands: ["git", "push"],
          stack: "raw-preflight-secret",
          argv: ["git", "push"]
        }
      ],
      metadata: {
        createdAt: "2026-06-22T02:00:00.000Z",
        tool: "raw-preflight-secret",
        path: "/tmp/preflight.json"
      }
    };

    const result = parseWriteReadinessPreflightInput(unsafeFixture);

    expect(result).toEqual({
      ok: false,
      errorCode: "preflight_invalid_check",
      message: "Preflight input check item is invalid.",
      details: {
        field: "checks",
        index: 0
      }
    });
    expectNoUnsafeReadinessOutput(result);
  });

  it.each([
    {
      value: null,
      errorCode: "preflight_not_object",
      details: undefined
    },
    {
      value: { schemaVersion: 2, checks: [] },
      errorCode: "preflight_invalid_schema_version",
      details: { field: "schemaVersion" }
    },
    {
      value: { schemaVersion: 1 },
      errorCode: "preflight_missing_checks",
      details: { field: "checks" }
    },
    {
      value: { schemaVersion: 1, checks: [{}] },
      errorCode: "preflight_invalid_check",
      details: { field: "checks", index: 0 }
    },
    {
      value: { schemaVersion: 1, checks: [], metadata: "raw-preflight-secret" },
      errorCode: "preflight_invalid_metadata",
      details: { field: "metadata" }
    }
  ])("rejects invalid preflight input safely: $errorCode", ({ value, errorCode, details }) => {
    const result = parseWriteReadinessPreflightInput(value);

    expect(result).toEqual({
      ok: false,
      errorCode,
      message: expect.any(String),
      ...(details ? { details } : {})
    });
    expectNoUnsafeReadinessOutput(result);
  });

  it("loads a valid preflight file without exposing path or raw content", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "write-readiness-preflight-"));
    try {
      const preflightPath = join(tempRoot, "preflight.json");
      await writeFile(preflightPath, JSON.stringify(passingPreflightFileFixture()), "utf8");

      const loaded = await loadWriteReadinessPreflightInput(preflightPath);
      const report = summarizeWriteExecutionReadiness(
        executionAuditBundle("2026-06-22T00:00:00.000Z", {
          commandSecret: "top-secret-readiness"
        }),
        expectLoadedPreflight(loaded)
      );
      const output = formatWriteExecutionReadiness(report);

      expect(loaded).toEqual({
        ok: true,
        preflight: passingPreflight(),
        recognizedCheckCount: 10,
        ignoredCheckCount: 0
      });
      expect(report.readinessStatus).toBe("ready");
      expect(report.inputs.preflight).toBe("available");
      expectNoUnsafeReadinessOutput(loaded);
      expectNoUnsafeReadinessOutput(report);
      expectNoUnsafeReadinessOutput(output);
      expect(JSON.stringify(loaded)).not.toContain(preflightPath);
      expect(output).not.toContain(preflightPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("loads a blocked preflight file into blocked readiness", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "write-readiness-preflight-"));
    try {
      const preflightPath = join(tempRoot, "blocked-preflight.json");
      const fixture = {
        ...passingPreflightFileFixture(),
        checks: passingPreflightFileFixture().checks.map((check) =>
          check.code === "repo_cleanliness_passed"
            ? {
                ...check,
                status: "blocked" as const,
                code: "repo_cleanliness_blocked",
                message: "Repository state does not satisfy cleanliness policy."
              }
            : check
        )
      };
      await writeFile(preflightPath, JSON.stringify(fixture), "utf8");

      const loaded = await loadWriteReadinessPreflightInput(preflightPath);
      const report = summarizeWriteExecutionReadiness(
        executionAuditBundle("2026-06-22T00:00:00.000Z"),
        expectLoadedPreflight(loaded)
      );

      expect(loaded).toEqual({
        ok: true,
        preflight: {
          ...passingPreflight(),
          repoClean: false
        },
        recognizedCheckCount: 10,
        ignoredCheckCount: 0
      });
      expect(report.readinessStatus).toBe("blocked");
      expect(report.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "repo_state",
            code: "repo_cleanliness_blocked",
            source: "preflight"
          })
        ])
      );
      expectNoUnsafeReadinessOutput(loaded);
      expectNoUnsafeReadinessOutput(report);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns safe preflight file load errors", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "write-readiness-preflight-"));
    try {
      const invalidJsonPath = join(tempRoot, "invalid-json.json");
      const invalidSchemaPath = join(tempRoot, "invalid-schema.json");
      const missingPath = join(tempRoot, "missing-raw-preflight-secret.json");
      await writeFile(invalidJsonPath, "{ raw-preflight-secret", "utf8");
      await writeFile(
        invalidSchemaPath,
        JSON.stringify({
          schemaVersion: 1,
          metadata: {
            tool: "raw-preflight-secret",
            path: "/tmp/preflight.json"
          },
          checks: [
            {
              category: "ci",
              status: "unexpected",
              code: "ci_policy_passed",
              message: "raw-preflight-secret should not be echoed",
              source: "preflight",
              stdout: "raw-preflight-secret",
              stderr: "raw-preflight-secret",
              exitCode: 1,
              executedCommands: ["git", "push"],
              stack: "raw-preflight-secret",
              argv: ["git", "push"]
            }
          ]
        }),
        "utf8"
      );

      const invalidJson = await loadWriteReadinessPreflightInput(invalidJsonPath);
      const invalidSchema = await loadWriteReadinessPreflightInput(invalidSchemaPath);
      const missing = await loadWriteReadinessPreflightInput(missingPath);

      expect(invalidJson).toEqual({
        ok: false,
        errorCode: "preflight_invalid_json",
        message: "Preflight input file must contain valid JSON."
      });
      expect(invalidSchema).toEqual({
        ok: false,
        errorCode: "preflight_invalid_check",
        message: "Preflight input check item is invalid.",
        details: {
          field: "checks",
          index: 0
        }
      });
      expect(missing).toEqual({
        ok: false,
        errorCode: "preflight_file_not_found",
        message: "Preflight input file was not found."
      });
      expectNoUnsafeReadinessOutput(invalidJson);
      expectNoUnsafeReadinessOutput(invalidSchema);
      expectNoUnsafeReadinessOutput(missing);
      expect(JSON.stringify(missing)).not.toContain(missingPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps blocked readiness report contract stable as a plain JSON object", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."], "top-secret-readiness");
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z", {
        approvedPlan,
        currentPlan
      })
    );
    const json = JSON.parse(JSON.stringify(report));

    expect(json).toEqual(report);
    expect(Object.keys(json).sort()).toEqual([
      "approvalId",
      "blockers",
      "checkpointId",
      "checks",
      "executionEnabled",
      "hasExecutionResults",
      "inputs",
      "intentId",
      "planId",
      "readinessStatus",
      "ready",
      "runId",
      "writeExecution"
    ]);
    expect(Object.keys(json.blockers[0]).sort()).toEqual(["category", "code", "message", "source"]);
    expect(Object.keys(json.checks[0]).sort()).toEqual(["category", "code", "message", "source", "status"]);
    expect(json).toMatchObject({
      readinessStatus: "blocked",
      ready: false,
      inputs: {
        auditBundle: "available",
        preflight: "missing"
      },
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    });
    expect(json.intentId).toMatch(/^intent_/);
    expect(json).toMatchObject({
      runId: "run-1",
      planId: "prplan-1",
      checkpointId: "checkpoint-current"
    });
    expect(json.approvalId).toMatch(/^approval_/);
    expect(json.blockers).toEqual([
      {
        category: "trace",
        code: "blocked_dry_run_trace",
        message: "2 dry-run trace(s) are blocked.",
        source: "audit_bundle"
      },
      {
        category: "precondition",
        code: "audit_blocked_reason",
        message: "Repository status is not clean.",
        source: "audit_bundle"
      },
      {
        category: "precondition",
        code: "audit_blocked_reason",
        message: "Approval checkpoint checkpoint-old does not match current checkpoint checkpoint-current.",
        source: "audit_bundle"
      }
    ]);
    expect(json.checks).toEqual(
      expect.arrayContaining([
        {
          category: "trace",
          status: "blocked",
          code: "blocked_dry_run_trace",
          message: "2 dry-run trace(s) are blocked.",
          source: "audit_bundle"
        },
        {
          category: "approval",
          status: "unknown",
          code: "approval_freshness_unverified",
          message: "Approval freshness has not been verified.",
          source: "preflight"
        }
      ])
    );
    expectNoUnsafeReadinessOutput(json);
  });

  it("keeps ready readiness report contract stable as a plain JSON object", () => {
    const report = summarizeWriteExecutionReadiness(executionAuditBundle("2026-06-22T00:00:00.000Z"), passingPreflight());
    const json = JSON.parse(JSON.stringify(report));

    expect(json).toEqual(report);
    expect(Object.keys(json).sort()).toEqual([
      "approvalId",
      "blockers",
      "checkpointId",
      "checks",
      "executionEnabled",
      "hasExecutionResults",
      "inputs",
      "intentId",
      "planId",
      "readinessStatus",
      "ready",
      "runId",
      "writeExecution"
    ]);
    expect(json).toMatchObject({
      readinessStatus: "ready",
      ready: true,
      blockers: [],
      inputs: {
        auditBundle: "available",
        preflight: "available"
      },
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    });
    expect(json.checks).toHaveLength(13);
    expect(json.checks.every((check: { status: string }) => check.status === "pass")).toBe(true);
    expect(json.checks).toEqual(
      expect.arrayContaining([
        {
          category: "trace",
          status: "pass",
          code: "dry_run_traces_not_blocked",
          message: "Dry-run traces are not blocked.",
          source: "audit_bundle"
        },
        {
          category: "approval",
          status: "pass",
          code: "approval_freshness_passed",
          message: "Approval freshness is verified.",
          source: "preflight"
        },
        {
          category: "ci",
          status: "pass",
          code: "ci_policy_passed",
          message: "CI/check policy is satisfied.",
          source: "preflight"
        }
      ])
    );
    expectNoUnsafeReadinessOutput(json);
  });

  it("matches the active write readiness schema payload definition", async () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."], "top-secret-readiness");
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z", {
        approvedPlan,
        currentPlan
      })
    );
    const json = JSON.parse(JSON.stringify(report));
    const schema = await readWriteReadinessSchema();

    expectRequiredFields(json, schema.payload.required);
    expectRequiredFields(json.inputs, schema.inputs.required);
    expectRequiredFields(json.blockers[0], schema.blocker.required);
    expectRequiredFields(json.checks[0], schema.check.required);
    expect(schema.payload.properties?.executionEnabled).toEqual({ const: false });
    expect(schema.payload.properties?.writeExecution).toEqual({ const: "disabled" });
    expect(schema.payload.properties?.hasExecutionResults).toEqual({ const: false });
    expect(json.executionEnabled).toBe(false);
    expect(json.writeExecution).toBe("disabled");
    expect(json.hasExecutionResults).toBe(false);
    expect(schema.payload.additionalProperties).toBe(true);
    expect(schema.blocker.additionalProperties).toBe(true);
    expect(schema.check.additionalProperties).toBe(true);
    expectNoUnsafeReadinessOutput(json);
  });

  it("formats blocked readiness reports with grouped blockers and disabled markers", () => {
    const approvedPlan = prPlan("checkpoint-old");
    const currentPlan = prPlan("checkpoint-current", ["Repository status is not clean."]);
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z", {
        approvedPlan,
        currentPlan
      })
    );

    const output = formatWriteExecutionReadiness(report);

    expect(output).toContain(`Write execution readiness: ${report.intentId}`);
    expect(output).toContain("Status: blocked");
    expect(output).toContain("Ready: no");
    expect(output).toContain(`Run: ${report.runId}`);
    expect(output).toContain(`Plan: ${report.planId}`);
    expect(output).toContain(`Approval: ${report.approvalId}`);
    expect(output).toContain("Execution: disabled");
    expect(output).toContain("Write execution: disabled");
    expect(output).toContain("Blockers:");
    expect(output).toContain("  trace:");
    expect(output).toContain("blocked_dry_run_trace");
    expect(output).toContain("  precondition:");
    expect(output).toContain("Repository status is not clean.");
    expect(output).toContain("Checks:");
    expect(output).toContain("[blocked]");
    expect(output).toContain("Use --json for the stable automation contract.");
    expectNoUnsafeReadinessOutput(output);
  });

  it("formats unknown readiness reports with unknown checks", () => {
    const report = summarizeWriteExecutionReadiness(executionAuditBundle("2026-06-22T00:00:00.000Z"));

    const output = formatWriteExecutionReadiness(report);

    expect(output).toContain("Status: unknown");
    expect(output).toContain("Ready: unknown");
    expect(output).toContain("Inputs: auditBundle=available, preflight=missing");
    expect(output).toContain("approval_freshness_unverified");
    expect(output).toContain("ci_policy_unverified");
    expect(output).toContain("[unknown]");
    expect(output).toContain("Blockers:");
    expect(output).toContain("  - none");
    expectNoUnsafeReadinessOutput(output);
  });

  it("formats ready reports with pass checks and stable empty blocker output", () => {
    const report = summarizeWriteExecutionReadiness(
      executionAuditBundle("2026-06-22T00:00:00.000Z", {
        commandSecret: "top-secret-readiness"
      }),
      passingPreflight()
    );

    const output = formatWriteExecutionReadiness(report);

    expect(output).toContain("Status: ready");
    expect(output).toContain("Ready: yes");
    expect(output).toContain("Inputs: auditBundle=available, preflight=available");
    expect(output).toContain("Blockers:");
    expect(output).toContain("  - none");
    expect(output).toContain("[pass]");
    expect(output).toContain("approval_freshness_passed");
    expect(output).toContain("ci_policy_passed");
    expectNoUnsafeReadinessOutput(output);
  });

  it("formats empty report sections without exposing unsafe fields", () => {
    const report = {
      ...summarizeWriteExecutionReadiness(executionAuditBundle("2026-06-22T00:00:00.000Z"), passingPreflight()),
      blockers: [],
      checks: []
    };

    const output = formatWriteExecutionReadiness(report);

    expect(output).toContain("Blockers:");
    expect(output).toContain("Checks:");
    expect(output.match(/  - none/g)).toHaveLength(2);
    expectNoUnsafeReadinessOutput(output);
  });

  it("formats safe plain readiness errors", () => {
    const output = formatWriteReadinessError({
      status: "error",
      errorCode: "invalid_execution_intent_file",
      message: "Execution intent file is invalid.",
      intentId: "intent_invalid",
      details: { kind: "execution_intent" },
      readiness: null,
      executionEnabled: false,
      writeExecution: "disabled",
      hasExecutionResults: false
    });

    expect(output).toContain("Write readiness error:");
    expect(output).toContain("Status: error");
    expect(output).toContain("Code: invalid_execution_intent_file");
    expect(output).toContain("Intent: intent_invalid");
    expect(output).toContain("Details: execution_intent");
    expect(output).toContain("Execution: disabled");
    expect(output).toContain("Write execution: disabled");
    expect(output).toContain("Re-run with --json for machine-readable error details.");
    expectNoUnsafeReadinessOutput(output);
  });
});

function executionAuditBundle(
  createdAt: string,
  options: { approvedPlan?: PullRequestPlan; currentPlan?: PullRequestPlan; commandSecret?: string } = {}
): ExecutionAuditBundle {
  const plan = options.currentPlan ?? prPlan("checkpoint-1", [], options.commandSecret);
  const approval = createPullRequestApproval(options.approvedPlan ?? plan, {
    approvedBy: "maintainer",
    reason: "Reviewed current checkpoint and PR plan."
  });
  const intent = createExecutionIntent({
    plan,
    approval,
    actor: "maintainer",
    reason: "Prepare audited write execution intent.",
    createdAt,
    expiresAt: "2026-06-24T00:00:00.000Z",
    permissionMode: "maintainer"
  });
  const traces = createExecutionDryRunTraces(intent, {
    createdAt: "2026-06-22T01:00:00.000Z"
  });

  return summarizeExecutionAuditBundle(intent, traces);
}

function prPlan(checkpointId = "checkpoint-1", blockedReasons: string[] = [], commandSecret = "safe-arg"): PullRequestPlan {
  return {
    id: "prplan-1",
    runId: "run-1",
    checkpointId,
    sourceBranchHint: "orchestrator/run1",
    baseBranch: "main",
    title: "Prepare PR workflow",
    body: "PR body",
    preconditions: ["Review this plan."],
    blockedReasons,
    commandCandidates: [
      {
        action: "create_branch",
        command: ["git", "switch", "-c", commandSecret],
        reason: "Create branch.",
        decisionReady: true
      },
      {
        action: "create_pr",
        command: ["gh", "pr", "create", "--title", "Prepare PR workflow"],
        reason: "Create PR.",
        decisionReady: true
      }
    ],
    createdAt: "2026-06-22T00:00:00.000Z"
  };
}

function passingPreflight(): Required<WriteExecutionReadinessPreflightInput> {
  return {
    approvalFresh: true,
    approvalNotExpired: true,
    planFingerprintMatches: true,
    checkpointMatches: true,
    repoClean: true,
    diffVerified: true,
    refPolicySatisfied: true,
    ciPolicySatisfied: true,
    permissionAllowed: true,
    commandRunnerConfigured: true
  };
}

function passingPreflightFileFixture(): PreflightFileFixture {
  return {
    schemaVersion: 1,
    metadata: {
      createdAt: "2026-06-22T02:00:00.000Z",
      tool: "write-readiness-preflight-fixture"
    },
    checks: [
      preflightFixtureCheck("approval", "approval_freshness_passed", "Approval freshness is verified."),
      preflightFixtureCheck("approval", "approval_expiration_passed", "Approval is not expired."),
      preflightFixtureCheck("policy", "plan_fingerprint_passed", "Plan fingerprint matches the approved plan."),
      preflightFixtureCheck("precondition", "checkpoint_match_passed", "Latest checkpoint matches the approved checkpoint."),
      preflightFixtureCheck("repo_state", "repo_cleanliness_passed", "Repository cleanliness satisfies policy."),
      preflightFixtureCheck("repo_state", "diff_verification_passed", "Diff verification passed."),
      preflightFixtureCheck("policy", "ref_policy_passed", "Target ref and branch policy are satisfied."),
      preflightFixtureCheck("ci", "ci_policy_passed", "CI/check policy is satisfied."),
      preflightFixtureCheck("permission", "permission_gate_passed", "Permission gate allows the approved action."),
      preflightFixtureCheck("policy", "command_runner_passed", "Command runner write configuration is available.")
    ]
  };
}

function preflightFixtureCheck(
  category: PreflightFileFixture["checks"][number]["category"],
  code: string,
  message: string
): PreflightFileFixture["checks"][number] {
  return {
    category,
    status: "pass",
    code,
    message,
    source: "preflight"
  };
}

function expectParsedPreflight(
  result: ReturnType<typeof parseWriteReadinessPreflightInput>
): WriteExecutionReadinessPreflightInput {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.preflight;
}

function expectLoadedPreflight(
  result: ReturnType<typeof loadWriteReadinessPreflightInput> extends Promise<infer T> ? T : never
): WriteExecutionReadinessPreflightInput {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.preflight;
}

function expectNoUnsafeReadinessOutput(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    "executedCommands",
    "stdout",
    "stderr",
    "exitCode",
    "stack",
    "argv",
    "top-secret-readiness",
    "raw-preflight-secret",
    "/tmp/preflight.json"
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}

async function readWriteReadinessSchema(): Promise<{
  payload: SchemaDefinition;
  blocker: SchemaDefinition;
  check: SchemaDefinition;
  inputs: SchemaDefinition;
}> {
  const schema = JSON.parse(await readFile(join(root, "schemas", "cli-json.schema.json"), "utf8")) as {
    $defs?: Record<string, SchemaDefinition>;
  };

  return {
    payload: requiredDefinition(schema.$defs, "writeReadinessPayload"),
    blocker: requiredDefinition(schema.$defs, "writeReadinessBlocker"),
    check: requiredDefinition(schema.$defs, "writeReadinessCheck"),
    inputs: requiredDefinition(schema.$defs, "writeReadinessInputs")
  };
}

function requiredDefinition(defs: Record<string, SchemaDefinition> | undefined, name: string): SchemaDefinition {
  const definition = defs?.[name];
  expect(definition, `missing schema definition ${name}`).toBeDefined();
  return definition ?? {};
}

function expectRequiredFields(value: unknown, required: string[] | undefined): void {
  expect(required?.length).toBeGreaterThan(0);
  const record = asRecord(value);
  expect(record).toBeDefined();
  for (const field of required ?? []) {
    expect(record, `expected fixture to include required schema field ${field}`).toHaveProperty(field);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

interface SchemaDefinition {
  required?: string[];
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;
}

interface PreflightFileFixture {
  schemaVersion: 1;
  metadata?: {
    createdAt?: string;
    tool?: string;
  };
  checks: Array<{
    category: "approval" | "precondition" | "permission" | "policy" | "ci" | "repo_state";
    status: "pass" | "blocked" | "unknown";
    code: string;
    message: string;
    source: "preflight";
  }>;
}

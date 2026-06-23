import { join } from "node:path";
import type { GitHubCheckSummary, LoopRun } from "../../src/domain.js";
import { createPullRequestApproval, preparePullRequestExecution } from "../../src/approval.js";
import { createCliJsonReport } from "../../src/cli-json.js";
import { runDoctor } from "../../src/doctor.js";
import { createExecutionDryRunTraces, createExecutionIntent, summarizeExecutionAuditBundle } from "../../src/execution-intents.js";
import { initProject } from "../../src/init.js";
import { createIntegrationCheckpoint } from "../../src/integration.js";
import { createPullRequestPlan } from "../../src/pr-plan.js";
import { MockRepoProvider } from "../../src/providers.js";
import { createRunCliReport } from "../../src/run-report.js";
import { summarizeWriteExecutionReadiness } from "../../src/write-readiness.js";
import { summarizeWriteRunnerDryRun } from "../../src/write-runner.js";

export interface BuildCliJsonSamplesInput {
  initRoot: string;
  doctorRoot: string;
  createdAt?: string;
}

export async function buildCliJsonSamples(input: BuildCliJsonSamplesInput): Promise<JsonObject[]> {
  const createdAt = input.createdAt ?? "2026-06-22T00:00:00.000Z";
  const run = loopRun();
  const repo = new MockRepoProvider({ status: "", diff: "" });
  const checkpoint = await createIntegrationCheckpoint({ run, repo });
  const prPlan = await createPullRequestPlan({ run, repo, checkpoint });
  const prExec = preparePullRequestExecution({ plan: prPlan });
  const approval = createPullRequestApproval(prPlan, {
    approvedBy: "schema-smoke",
    reason: "Schema sample approval."
  });
  const executionIntent = createExecutionIntent({
    plan: prPlan,
    approval,
    actor: "schema-smoke",
    reason: "Review execution audit bundle schema.",
    createdAt,
    expiresAt: "2026-06-23T00:00:00.000Z",
    permissionMode: "maintainer"
  });
  const executionTraces = createExecutionDryRunTraces(executionIntent, { createdAt });
  const executionAuditBundle = summarizeExecutionAuditBundle(executionIntent, executionTraces);
  const writeReadiness = summarizeWriteExecutionReadiness(executionAuditBundle, passingPreflight());
  const runReport = createRunCliReport(run, {
    pathForRun: (runId) => join(run.context.runId, ".orchestrator", "runs", `${runId}.json`)
  });

  return [
    toJsonObject(createCliJsonReport("doctor", await runDoctor(input.doctorRoot), createdAt)),
    toJsonObject(createCliJsonReport("init", await initProject(input.initRoot), createdAt)),
    toJsonObject(createCliJsonReport("run", runReport, createdAt)),
    toJsonObject(createCliJsonReport("resume", runReport, createdAt)),
    toJsonObject(createCliJsonReport("status", runReport, createdAt)),
    toJsonObject(createCliJsonReport("checks", checksSummary(), createdAt)),
    toJsonObject(createCliJsonReport("checkpoint", checkpoint, createdAt)),
    toJsonObject(createCliJsonReport("pr-plan", prPlan, createdAt)),
    toJsonObject(createCliJsonReport("pr-exec", prExec, createdAt)),
    toJsonObject(createCliJsonReport("approve-pr", approval, createdAt)),
    toJsonObject(createCliJsonReport("execution-audit", executionAuditBundle, createdAt)),
    toJsonObject(createCliJsonReport("write-readiness", summarizeWriteExecutionReadiness(executionAuditBundle), createdAt)),
    toJsonObject(
      createCliJsonReport(
        "write-runner",
        summarizeWriteRunnerDryRun(executionIntent, writeReadiness, executionTraces, {
          createdAt,
          localTracePersistence: "saved"
        }),
        createdAt
      )
    )
  ];
}

function passingPreflight() {
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

function checksSummary(): GitHubCheckSummary {
  return {
    status: "success",
    summary: "GitHub checks success (1 check).",
    ref: "HEAD",
    source: "github",
    details: [
      {
        name: "verify",
        status: "success",
        summary: "success"
      }
    ]
  };
}

function loopRun(): LoopRun {
  return {
    id: "run-schema-smoke",
    spec: {
      id: "task-schema-smoke",
      title: "Schema smoke",
      acceptanceCriteria: ["Run report sample matches schema."],
      permissionMode: "write"
    },
    context: {
      runId: "run-schema-smoke",
      task: {
        id: "task-schema-smoke",
        title: "Schema smoke",
        acceptanceCriteria: ["Run report sample matches schema."],
        permissionMode: "write"
      },
      items: []
    },
    graph: {
      subtasks: [
        {
          id: "subtask-schema-smoke",
          title: "Complete schema smoke",
          dependsOn: [],
          status: "completed",
          createdAt: "2026-06-22T00:00:00.000Z",
          updatedAt: "2026-06-22T00:00:00.000Z"
        }
      ],
      conflicts: []
    },
    events: [],
    status: "completed",
    iterations: 1,
    permissionMode: "write",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z"
  };
}

function toJsonObject(value: object): JsonObject {
  return value as unknown as JsonObject;
}

export type JsonObject = Record<string, unknown>;

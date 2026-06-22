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

  it("applies the run report branch to run, resume, and default status reports", async () => {
    const schema = await readSchema();

    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        {
          if: {
            properties: {
              command: {
                enum: ["run", "resume"]
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
    expect(docs).toContain("Doctor Schema");
    expect(docs).toContain("Init Schema");
    expect(docs).toContain("status --json --raw");
    expect(docs).toContain("../schemas/cli-json.schema.json");
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

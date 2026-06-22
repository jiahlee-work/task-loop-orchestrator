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

  it("documents and links the schema artifact", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    const docs = await readFile(join(root, "docs", "json-output.md"), "utf8");

    expect(readme).toContain("docs/json-output.md");
    expect(readme).toContain("schemas/cli-json.schema.json");
    expect(docs).toContain("schemaVersion");
    expect(docs).toContain("Run Report Schema");
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
      subtaskCounts?: {
        required?: string[];
      };
    };
    allOf?: unknown[];
    additionalProperties?: boolean;
  };
}

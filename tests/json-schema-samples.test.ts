import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cliJsonCommands, cliJsonSchemaVersion } from "../src/cli-json.js";
import { buildCliJsonSamples, type JsonObject } from "./fixtures/cli-json-samples.js";

const root = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI JSON schema sample smoke", () => {
  it("matches representative helper-produced JSON samples to schema branch required fields", async () => {
    const schema = await readSchema();
    const initRoot = await tempRoot("task-loop-schema-init-");
    const doctorRoot = await tempRoot("task-loop-schema-doctor-");
    const samples = await buildCliJsonSamples({
      initRoot,
      doctorRoot,
      createdAt: "2026-06-22T00:00:00.000Z"
    });

    expect(samples.map((sample) => sample.command).sort()).toEqual([...cliJsonCommands].sort());

    for (const sample of samples) {
      expectSampleMatchesSchemaRequiredFields(schema, sample);
    }
  });
});

async function tempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function readSchema(): Promise<JsonObject> {
  return JSON.parse(await readFile(join(root, "schemas", "cli-json.schema.json"), "utf8")) as JsonObject;
}

function expectSampleMatchesSchemaRequiredFields(schema: JsonObject, sample: JsonObject): void {
  const command = sample.command;

  expect(sample.schemaVersion).toBe(cliJsonSchemaVersion);
  expect(command).toEqual(expect.any(String));
  expect(sample.createdAt).toEqual(expect.any(String));
  expect(asRecord(asRecord(schema.properties)?.command)?.enum).toContain(command);

  const branchRefs = applicableBranchRefs(schema, sample);
  expect(branchRefs.length).toBeGreaterThan(0);

  for (const ref of branchRefs) {
    const definition = resolveDefinitionRef(schema, ref);
    for (const field of requiredFields(schema, definition)) {
      expect(sample, `${String(command)} sample should include ${field}`).toHaveProperty(field);
    }
  }
}

function applicableBranchRefs(schema: JsonObject, sample: JsonObject): string[] {
  return (Array.isArray(schema.allOf) ? schema.allOf : [])
    .filter((branch): branch is JsonObject => isRecord(branch) && branchApplies(branch, sample))
    .map((branch) => asRecord(branch.then)?.$ref)
    .filter((value): value is string => typeof value === "string");
}

function branchApplies(branch: JsonObject, sample: JsonObject): boolean {
  const condition = asRecord(branch.if);
  const required = Array.isArray(condition?.required) ? condition.required : [];
  if (!required.every((field) => typeof field === "string" && field in sample)) {
    return false;
  }

  const commandSchema = asRecord(asRecord(condition?.properties)?.command);
  const commandConst = commandSchema?.const;
  const commandEnum = commandSchema?.enum;
  return commandConst === sample.command || (Array.isArray(commandEnum) && commandEnum.includes(sample.command));
}

function resolveDefinitionRef(schema: JsonObject, ref: string): JsonObject {
  const match = ref.match(/^#\/\$defs\/(.+)$/);
  const definition = match ? asRecord(asRecord(schema.$defs)?.[match[1]]) : undefined;
  if (!definition) {
    throw new Error(`Unsupported or missing schema ref ${ref}`);
  }

  return definition;
}

function requiredFields(schema: JsonObject, definition: JsonObject, seenRefs = new Set<string>()): string[] {
  if (typeof definition.$ref === "string") {
    if (seenRefs.has(definition.$ref)) {
      return [];
    }

    seenRefs.add(definition.$ref);
    return requiredFields(schema, resolveDefinitionRef(schema, definition.$ref), seenRefs);
  }

  return Array.isArray(definition.required) ? definition.required.filter((field): field is string => typeof field === "string") : [];
}

function asRecord(value: unknown): JsonObject | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

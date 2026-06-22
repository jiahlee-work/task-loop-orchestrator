import { describe, expect, it } from "vitest";
import { cliJsonCommands, createCliJsonReport } from "../src/cli-json.js";

describe("CLI JSON envelope", () => {
  it("adds schema metadata without moving existing payload fields", () => {
    const report = createCliJsonReport(
      "run",
      {
        runId: "run-1",
        status: "completed",
        createdAt: "payload-created-at"
      },
      "2026-06-22T00:00:00.000Z"
    );

    expect(report).toEqual({
      schemaVersion: 1,
      command: "run",
      createdAt: "payload-created-at",
      runId: "run-1",
      status: "completed"
    });
  });

  it("adds createdAt metadata when the payload does not already have it", () => {
    expect(createCliJsonReport("checks", { status: "success" }, "2026-06-22T00:00:00.000Z")).toEqual({
      schemaVersion: 1,
      command: "checks",
      createdAt: "2026-06-22T00:00:00.000Z",
      status: "success"
    });
  });

  it("supports every JSON-capable CLI command name", () => {
    for (const command of cliJsonCommands) {
      expect(createCliJsonReport(command, {}, "2026-06-22T00:00:00.000Z")).toMatchObject({
        schemaVersion: 1,
        command,
        createdAt: "2026-06-22T00:00:00.000Z"
      });
    }
  });
});

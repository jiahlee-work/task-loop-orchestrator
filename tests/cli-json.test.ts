import { describe, expect, it } from "vitest";
import { createCliJsonReport } from "../src/cli-json.js";

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
      createdAt: "2026-06-22T00:00:00.000Z",
      runId: "run-1",
      status: "completed"
    });
  });
});

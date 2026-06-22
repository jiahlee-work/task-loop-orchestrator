import { describe, expect, it } from "vitest";
import { checkPermission } from "../src/permission.js";

describe("permission policy", () => {
  it("allows read mode to inspect state only", () => {
    expect(checkPermission("read", "read_state").allowed).toBe(true);
    expect(checkPermission("read", "write_file").allowed).toBe(false);
  });

  it("allows write mode to prepare changes but denies push", () => {
    expect(checkPermission("write", "write_file").allowed).toBe(true);
    expect(checkPermission("write", "run_tests").allowed).toBe(true);
    expect(checkPermission("write", "create_pr").allowed).toBe(true);
    expect(checkPermission("write", "push").allowed).toBe(false);
  });

  it("allows maintainer mode privileged decision-ready actions", () => {
    expect(checkPermission("maintainer", "push").allowed).toBe(true);
    expect(checkPermission("maintainer", "merge_pr").allowed).toBe(true);
    expect(checkPermission("maintainer", "jira_transition").allowed).toBe(true);
    expect(checkPermission("maintainer", "release").allowed).toBe(true);
  });
});

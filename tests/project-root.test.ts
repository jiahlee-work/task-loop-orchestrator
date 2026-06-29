import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTargetProject, resolveTargetRoot } from "../src/project-root.js";

describe("resolveTargetRoot", () => {
  it("uses the current git top-level as the target repo root", async () => {
    const root = await resolveTargetRoot("/repo/app/packages/web", async (command, args, cwd) => {
      expect(command).toBe("git");
      expect(args).toEqual(["rev-parse", "--show-toplevel"]);
      expect(cwd).toBe("/repo/app/packages/web");
      return {
        exitCode: 0,
        stdout: "/repo/app\n",
        stderr: ""
      };
    });

    expect(root).toBe(resolve("/repo/app"));
  });

  it("reports whether the target is backed by a git repository", async () => {
    const target = await resolveTargetProject("/repo/app/packages/web", async () => ({
      exitCode: 0,
      stdout: "/repo/app\n",
      stderr: ""
    }));

    expect(target).toEqual({
      rootDir: resolve("/repo/app"),
      cwd: resolve("/repo/app/packages/web"),
      isGitRepository: true
    });
  });

  it("falls back to cwd outside a git repository", async () => {
    const target = await resolveTargetProject("/scratch/task", async () => ({
      exitCode: 128,
      stdout: "",
      stderr: "not a git repository"
    }));

    expect(target).toEqual({
      rootDir: resolve("/scratch/task"),
      cwd: resolve("/scratch/task"),
      isGitRepository: false
    });
  });
});

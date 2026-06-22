import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitHub Actions CI workflow", () => {
  it("runs pnpm verification and package smoke on pull requests and main pushes", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("cache: pnpm");
    expect(workflow).toContain("corepack enable");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm run typecheck");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("pnpm run build");
    expect(workflow).toContain("pnpm run package:smoke");
  });
});

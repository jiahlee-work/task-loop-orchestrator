import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitRepoProvider } from "../src/providers.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "task-loop-git-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GitRepoProvider", () => {
  it("reads git status from an isolated temp repository", async () => {
    const root = await tempRoot();
    await execFileAsync("git", ["init"], { cwd: root });
    await writeFile(join(root, "note.txt"), "hello\n", "utf8");

    const provider = new GitRepoProvider(root);

    await expect(provider.getStatus()).resolves.toContain("?? note.txt");
  });

  it("handles git diff stat without relying on the caller repository", async () => {
    const root = await tempRoot();
    await execFileAsync("git", ["init"], { cwd: root });

    const provider = new GitRepoProvider(root);

    await expect(provider.getDiff()).resolves.toBe("");
  });
});

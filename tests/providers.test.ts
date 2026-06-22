import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubCliProvider, GitRepoProvider, type CommandRunner } from "../src/providers.js";

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

describe("GitHubCliProvider", () => {
  it("reads repository info and pull requests with read-only gh commands", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner: CommandRunner = async (command, args = [], cwd) => {
      calls.push({ command, args, cwd });
      if (args[0] === "repo") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            name: "task-loop-orchestrator",
            owner: { login: "jiahlee-work" },
            url: "https://github.com/jiahlee-work/task-loop-orchestrator",
            defaultBranchRef: { name: "main" }
          }),
          stderr: ""
        };
      }

      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            number: 7,
            title: "Read-only checkpoint",
            state: "OPEN",
            headRefName: "feature/checkpoint",
            baseRefName: "main",
            url: "https://github.com/example/pr/7",
            isDraft: true
          }
        ]),
        stderr: ""
      };
    };
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getRepositoryInfo()).resolves.toEqual({
      name: "task-loop-orchestrator",
      owner: "jiahlee-work",
      url: "https://github.com/jiahlee-work/task-loop-orchestrator",
      defaultBranch: "main"
    });
    await expect(provider.listPullRequests()).resolves.toEqual([
      {
        number: 7,
        title: "Read-only checkpoint",
        state: "OPEN",
        headRefName: "feature/checkpoint",
        baseRefName: "main",
        url: "https://github.com/example/pr/7",
        isDraft: true
      }
    ]);
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ["gh", "repo", "view", "--json", "name,owner,url,defaultBranchRef"],
      ["gh", "pr", "list", "--json", "number,title,state,headRefName,baseRefName,url,isDraft"]
    ]);
  });

  it("aggregates gh check JSON into a check summary", async () => {
    const runner: CommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify([
        { name: "typecheck", state: "SUCCESS", bucket: "pass", description: "ok" },
        { name: "test", state: "SUCCESS", bucket: "pass", description: "ok" }
      ]),
      stderr: ""
    });
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getCheckStatus("main")).resolves.toMatchObject({
      status: "success",
      summary: "GitHub checks success (2 checks).",
      ref: "main",
      source: "github"
    });
  });

  it("degrades gh missing or auth failure into unknown check status", async () => {
    const runner: CommandRunner = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "gh: command not found or not logged into any GitHub hosts"
    });
    const provider = new GitHubCliProvider("/tmp/repo", runner);

    await expect(provider.getCheckStatus("main")).resolves.toMatchObject({
      status: "unknown",
      source: "github"
    });
  });
});

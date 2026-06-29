import { resolve } from "node:path";
import { runCommand, type CommandRunner } from "./providers.js";

export interface TargetProject {
  rootDir: string;
  cwd: string;
  isGitRepository: boolean;
}

export async function resolveTargetRoot(cwd: string = process.cwd(), runner: CommandRunner = runCommand): Promise<string> {
  return (await resolveTargetProject(cwd, runner)).rootDir;
}

export async function resolveTargetProject(cwd: string = process.cwd(), runner: CommandRunner = runCommand): Promise<TargetProject> {
  const result = await runner("git", ["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode === 0) {
    const root = result.stdout.trim();
    if (root) {
      return {
        rootDir: resolve(root),
        cwd: resolve(cwd),
        isGitRepository: true
      };
    }
  }

  return {
    rootDir: resolve(cwd),
    cwd: resolve(cwd),
    isGitRepository: false
  };
}

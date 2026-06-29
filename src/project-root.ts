import { resolve } from "node:path";
import { runCommand, type CommandRunner } from "./providers.js";

export async function resolveTargetRoot(cwd: string = process.cwd(), runner: CommandRunner = runCommand): Promise<string> {
  const result = await runner("git", ["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode === 0) {
    const root = result.stdout.trim();
    if (root) {
      return resolve(root);
    }
  }

  return resolve(cwd);
}

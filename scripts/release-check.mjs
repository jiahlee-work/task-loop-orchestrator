#!/usr/bin/env node
// Local pre-release verification only. This script does not publish packages,
// create tags, create GitHub releases, or perform write-side GitHub actions.
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const steps = [
  { label: "typecheck", command: "pnpm", args: ["run", "typecheck"] },
  { label: "test", command: "pnpm", args: ["test"] },
  { label: "build", command: "pnpm", args: ["run", "build"] },
  { label: "package artifacts", command: "pnpm", args: ["run", "package:artifacts"] },
  { label: "lint", command: "pnpm", args: ["run", "lint"] },
  { label: "package smoke", command: "pnpm", args: ["run", "package:smoke"] },
  { label: "version", command: "node", args: ["dist/cli.js", "--version"] },
  { label: "checks", command: "node", args: ["dist/cli.js", "checks", "HEAD", "--json"] }
];

async function main() {
  console.log("Release check started. This script does not publish, tag, or create releases.");

  for (const step of steps) {
    await runStep(step);
  }

  console.log("Release check passed.");
}

async function runStep(step) {
  console.log(`\n[release:check] ${step.label}: ${formatCommand(step.command, step.args)}`);
  try {
    const result = await execFileAsync(step.command, step.args, {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 20
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const exitCode = typeof error?.code === "number" || typeof error?.code === "string" ? String(error.code) : "unknown";
    throw new Error(
      [
        `Release check step failed: ${step.label}`,
        `command: ${formatCommand(step.command, step.args)}`,
        `cwd: ${repoRoot}`,
        `exit code: ${exitCode}`,
        formatOutput("stdout", stdout),
        formatOutput("stderr", stderr)
      ].filter(Boolean).join("\n")
    );
  }
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function formatOutput(label, value) {
  const trimmed = value.trim();
  return trimmed ? `${label}:\n${truncate(trimmed)}` : "";
}

function truncate(value, maxLength = 4000) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n... truncated ${value.length - maxLength} chars`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

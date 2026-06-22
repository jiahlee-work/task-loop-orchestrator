#!/usr/bin/env node
// Reviews npm pack dry-run output only. This script does not publish packages,
// create tags, create GitHub releases, or perform write-side GitHub actions.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredFiles = ["dist/cli.js", "schemas/cli-json.schema.json", "orchestrator.config.example.json"];

async function main() {
  const packageJson = await readPackageJson();
  const packResult = await run("npm", ["pack", "--dry-run", "--json"]);
  const artifact = parsePackArtifact(packResult.stdout);
  const files = artifact.files.map((file) => normalizePackPath(file.path)).sort();
  const unexpectedFiles = files.filter((file) => !isAllowedPackFile(file));
  const missingFiles = requiredFiles.filter((file) => !files.includes(file));

  if (artifact.name !== packageJson.name || artifact.version !== packageJson.version) {
    throw new Error(
      `Pack metadata mismatch. Expected ${packageJson.name}@${packageJson.version}, got ${artifact.name}@${artifact.version}.`
    );
  }

  if (unexpectedFiles.length > 0 || missingFiles.length > 0) {
    throw new Error(
      [
        "Package artifact contract failed.",
        unexpectedFiles.length > 0 ? `Unexpected files:\n${unexpectedFiles.map((file) => `- ${file}`).join("\n")}` : "",
        missingFiles.length > 0 ? `Missing required files:\n${missingFiles.map((file) => `- ${file}`).join("\n")}` : ""
      ].filter(Boolean).join("\n")
    );
  }

  console.log(`Package artifact dry-run: ${artifact.name}@${artifact.version}`);
  console.log(`Tarball: ${artifact.filename}`);
  console.log(`Files: ${artifact.entryCount ?? files.length}`);
  if (typeof artifact.unpackedSize === "number") {
    console.log(`Unpacked size: ${artifact.unpackedSize} bytes`);
  }
  console.log("Included files:");
  for (const file of files) {
    console.log(`- ${file}`);
  }
}

async function readPackageJson() {
  return JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
}

async function run(command, args) {
  try {
    return await execFileAsync(command, args, {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 20
    });
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const exitCode = typeof error?.code === "number" || typeof error?.code === "string" ? String(error.code) : "unknown";
    throw new Error(
      [
        `Command failed: ${formatCommand(command, args)}`,
        `cwd: ${repoRoot}`,
        `exit code: ${exitCode}`,
        formatOutput("stdout", stdout),
        formatOutput("stderr", stderr)
      ].filter(Boolean).join("\n")
    );
  }
}

function parsePackArtifact(stdout) {
  const jsonText = extractTrailingJson(stdout);
  const parsed = JSON.parse(jsonText);
  const artifact = Array.isArray(parsed) ? parsed[0] : undefined;
  if (!isRecord(artifact) || !Array.isArray(artifact.files)) {
    throw new Error(`Unable to parse npm pack dry-run artifact JSON:\n${truncate(stdout.trim())}`);
  }

  return artifact;
}

function extractTrailingJson(stdout) {
  const match = stdout.match(/(\[\s*\{[\s\S]*\])\s*$/);
  if (!match) {
    throw new Error(`npm pack dry-run did not end with JSON output:\n${truncate(stdout.trim())}`);
  }

  return match[1];
}

function normalizePackPath(path) {
  return String(path).replace(/^package\//, "").replace(/\\/g, "/");
}

function isAllowedPackFile(path) {
  return (
    path.startsWith("dist/") ||
    path.startsWith("schemas/") ||
    path === "orchestrator.config.example.json" ||
    path === "package.json" ||
    /^readme(\..*)?$/i.test(path) ||
    /^licen[cs]e(\..*)?$/i.test(path) ||
    /^copying(\..*)?$/i.test(path) ||
    /^notice(\..*)?$/i.test(path)
  );
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

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "task-loop-package-smoke-"));
  const packDir = join(tempRoot, "pack");
  const installDir = join(tempRoot, "install");
  const projectDir = join(tempRoot, "project");

  try {
    await mkdir(packDir);
    await mkdir(projectDir);
    await run("npm", ["pack", "--pack-destination", packDir], { cwd: repoRoot });
    const tarballPath = await findTarball(packDir);
    await run("npm", ["install", "--prefix", installDir, tarballPath], { cwd: repoRoot });

    const bin = process.platform === "win32"
      ? join(installDir, "node_modules", ".bin", "task-loop-orchestrator.cmd")
      : join(installDir, "node_modules", ".bin", "task-loop-orchestrator");

    const help = await run(bin, ["--help"], { cwd: projectDir });
    assertIncludes(help.stdout, "task-loop-orchestrator init", "help output should include init usage");
    assertIncludes(help.stdout, "task-loop-orchestrator doctor", "help output should include doctor usage");

    const preInitDoctor = await run(bin, ["doctor", "--json"], { cwd: projectDir });
    const preInitDoctorReport = JSON.parse(preInitDoctor.stdout);
    assertEqual(preInitDoctorReport.status, "warn", "doctor before init should warn");

    await run("git", ["init"], { cwd: projectDir });
    const firstInit = await run(bin, ["init", "--json"], { cwd: projectDir });
    const firstInitReport = JSON.parse(firstInit.stdout);
    assertEqual(firstInitReport.files.config.status, "created", "first init should create config");
    assertEqual(firstInitReport.files.gitignore.status, "created", "first init should create gitignore");

    const secondInit = await run(bin, ["init", "--json"], { cwd: projectDir });
    const secondInitReport = JSON.parse(secondInit.stdout);
    assertEqual(secondInitReport.files.config.status, "skipped", "second init should skip config");
    assertEqual(secondInitReport.files.gitignore.status, "skipped", "second init should skip gitignore");

    const postInitDoctor = await run(bin, ["doctor", "--json"], { cwd: projectDir });
    const postInitDoctorReport = JSON.parse(postInitDoctor.stdout);
    assertEqual(postInitDoctorReport.status, "pass", "doctor after init should pass");

    const loop = await run(bin, ["run", "Smoke task", "--max-iterations", "1", "--json"], { cwd: projectDir });
    const loopReport = JSON.parse(loop.stdout);
    assertIncludes(loopReport.runId, "run_", "run JSON should include a run id");
    assertEqual(loopReport.status, "completed", "smoke run should complete");
    assertEqual(loopReport.counts.completed, 1, "run JSON should include subtask counts");
    assertIncludes(loopReport.savedPath, loopReport.runId, "run JSON should include saved path");

    const resume = await run(bin, ["resume", loopReport.runId, "--max-iterations", "1", "--json"], { cwd: projectDir });
    const resumeReport = JSON.parse(resume.stdout);
    assertEqual(resumeReport.runId, loopReport.runId, "resume JSON should use the same run id");
    assertIncludes(resumeReport.savedPath, loopReport.runId, "resume JSON should include saved path");

    const statusJson = await run(bin, ["status", "--json"], { cwd: projectDir });
    const statusReport = JSON.parse(statusJson.stdout);
    assertEqual(statusReport.runId, loopReport.runId, "latest status JSON should use the run report shape");
    assertEqual(statusReport.counts.completed, 1, "latest status JSON should include subtask counts");

    const explicitStatusJson = await run(bin, ["status", loopReport.runId, "--json"], { cwd: projectDir });
    const explicitStatusReport = JSON.parse(explicitStatusJson.stdout);
    assertEqual(explicitStatusReport.runId, loopReport.runId, "explicit status JSON should use the requested run id");
    assertIncludes(explicitStatusReport.savedPath, loopReport.runId, "status JSON should include saved path");

    const rawStatusJson = await run(bin, ["status", loopReport.runId, "--json", "--raw"], { cwd: projectDir });
    const rawStatusReport = JSON.parse(rawStatusJson.stdout);
    assertEqual(rawStatusReport.id, loopReport.runId, "raw status JSON should preserve the LoopRun shape");

    const status = await run(bin, ["status"], { cwd: projectDir });
    assertIncludes(status.stdout, "Smoke task", "plain status output should show the smoke task");

    console.log("Package smoke passed:");
    console.log(`- tarball: ${tarballPath}`);
    console.log("- help output includes init usage");
    console.log("- doctor reports pre-init warnings and post-init readiness");
    console.log("- init creates config and .gitignore");
    console.log("- init is idempotent on second run");
    console.log("- run/resume/status JSON and plain status work through the installed binary");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function findTarball(packDir) {
  const entries = await readdir(packDir);
  const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));

  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${packDir}, found ${tarballs.length}.`);
  }

  return join(packDir, tarballs[0]);
}

async function run(command, args, options) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 10
    });
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, stdout.trim(), stderr.trim()].filter(Boolean).join("\n")
    );
  }
}

function assertIncludes(value, expected, message) {
  if (!value.includes(expected)) {
    throw new Error(`${message}. Expected to find ${JSON.stringify(expected)} in:\n${value}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

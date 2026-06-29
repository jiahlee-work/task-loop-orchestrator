#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playgroundRoot = join(repoRoot, "playground");
const targetRepo = join(playgroundRoot, "target-repo");

const [command, ...args] = process.argv.slice(2);

if (command === "reset") {
  await resetTargetRepo();
} else if (command === "tlo") {
  runTlo(args);
} else {
  console.error("Usage:");
  console.error("  pnpm playground:reset");
  console.error("  pnpm playground:tlo -- <tlo args>");
  process.exitCode = 1;
}

async function resetTargetRepo() {
  await mkdir(targetRepo, { recursive: true });
  await assertInsidePlaygroundTarget(targetRepo);

  for (const entry of await readdir(targetRepo)) {
    await rm(join(targetRepo, entry), { recursive: true, force: true });
  }

  await writeFile(
    join(targetRepo, "README.md"),
    `# TLO Playground Target

This repository is reset by \`pnpm playground:reset\`.
Use it to try \`tlo init\`, \`tlo setup\`, and \`tlo run\` without leaving local state in the orchestrator repository.
`,
    "utf8"
  );
  await writeFile(
    join(targetRepo, "package.json"),
    `${JSON.stringify(
      {
        name: "tlo-playground-target",
        private: true,
        type: "module",
        scripts: {
          "playground:reset": "pnpm --dir ../.. playground:reset",
          "playground:tlo": "pnpm --dir ../.. playground:tlo --",
          test: "node -e \"console.log('playground target test passed')\""
        }
      },
      null,
      2
    )}
`,
    "utf8"
  );

  run("git", ["init", "-b", "main"], targetRepo);
  run("git", ["config", "user.name", "tlo-playground"], targetRepo);
  run("git", ["config", "user.email", "tlo-playground@example.invalid"], targetRepo);
  run("git", ["add", "README.md", "package.json"], targetRepo);
  run("git", ["commit", "-m", "chore: initialize playground target"], targetRepo);

  console.log("Success: playground reset");
  console.log("");
  console.log("Result:");
  console.log(`- Target repo: ${targetRepo}`);
  console.log("- Contents were recreated inside playground/target-repo.");
  console.log("- Git repository: initialized on main with one local commit.");
  console.log("");
  console.log("Next:");
  console.log("- Initialize tlo state:");
  console.log("  pnpm playground:tlo -- init");
  console.log("- Try the full setup flow:");
  console.log("  pnpm playground:tlo -- setup");
  console.log("- These commands also work from inside playground/target-repo.");
}

function runTlo(args) {
  const tloArgs = stripLeadingSeparators(args);
  if (!existsSync(targetRepo)) {
    console.error("Failed: playground target is missing");
    console.error("");
    console.error("Next:");
    console.error("- Recreate it first:");
    console.error("  pnpm playground:reset");
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [join(repoRoot, "dist", "cli.js"), ...tloArgs], {
    cwd: targetRepo,
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
}

function stripLeadingSeparators(args) {
  let index = 0;
  while (args[index] === "--") {
    index += 1;
  }
  return args.slice(index);
}

async function assertInsidePlaygroundTarget(path) {
  const resolved = resolve(path);
  const expected = resolve(repoRoot, "playground", "target-repo");
  if (resolved !== expected) {
    throw new Error(`Refusing to reset unexpected path: ${resolved}`);
  }
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8"
  });

  if (result.status === 0) {
    return;
  }

  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
}

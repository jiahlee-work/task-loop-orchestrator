import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultOrchestratorConfig } from "./config.js";

export type InitFileStatus = "created" | "updated" | "skipped";

export interface InitFileResult {
  path: string;
  status: InitFileStatus;
  reason?: string;
}

export interface InitProjectOptions {
  force?: boolean;
}

export interface InitProjectReport {
  rootDir: string;
  force: boolean;
  files: {
    config: InitFileResult;
    gitignore: InitFileResult;
  };
}

const configFileName = "orchestrator.config.json";
const gitignoreFileName = ".gitignore";
const orchestratorIgnoreLine = ".orchestrator/";

export async function initProject(
  rootDir: string = process.cwd(),
  options: InitProjectOptions = {}
): Promise<InitProjectReport> {
  const force = options.force === true;
  const config = await ensureConfig(rootDir, force);
  const gitignore = await ensureGitignore(rootDir);

  return {
    rootDir,
    force,
    files: {
      config,
      gitignore
    }
  };
}

async function ensureConfig(rootDir: string, force: boolean): Promise<InitFileResult> {
  const path = join(rootDir, configFileName);
  const exists = await fileExists(path);

  if (exists && !force) {
    return {
      path,
      status: "skipped",
      reason: "orchestrator.config.json already exists; use --force to overwrite."
    };
  }

  await writeFile(path, `${JSON.stringify(defaultOrchestratorConfig, null, 2)}\n`, "utf8");
  return {
    path,
    status: exists ? "updated" : "created"
  };
}

async function ensureGitignore(rootDir: string): Promise<InitFileResult> {
  const path = join(rootDir, gitignoreFileName);

  try {
    const content = await readFile(path, "utf8");
    if (hasOrchestratorIgnore(content)) {
      return {
        path,
        status: "skipped",
        reason: ".orchestrator/ is already ignored."
      };
    }

    await writeFile(path, appendGitignoreLine(content), "utf8");
    return {
      path,
      status: "updated"
    };
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    await writeFile(path, `${orchestratorIgnoreLine}\n`, "utf8");
    return {
      path,
      status: "created"
    };
  }
}

function hasOrchestratorIgnore(content: string): boolean {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === orchestratorIgnoreLine || line === ".orchestrator");
}

function appendGitignoreLine(content: string): string {
  const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${orchestratorIgnoreLine}\n`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

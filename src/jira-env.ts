import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JiraConfig } from "./config.js";

export type JiraEnv = Record<string, string>;

export function jiraEnvPath(rootDir: string): string {
  return join(rootDir, ".orchestrator", "jira.env");
}

export async function readJiraEnvFile(rootDir: string): Promise<JiraEnv> {
  try {
    return parseJiraEnv(await readFile(jiraEnvPath(rootDir), "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw error;
  }
}

export async function writeJiraEnvFile(rootDir: string, env: JiraEnv): Promise<string> {
  const path = jiraEnvPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeJiraEnv(env), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export async function loadJiraConfigWithLocalEnv(rootDir: string, jiraConfig: JiraConfig): Promise<JiraConfig> {
  const localEnv = await readJiraEnvFile(rootDir);
  return {
    ...jiraConfig,
    mcp: {
      ...jiraConfig.mcp,
      env: {
        ...localEnv,
        ...jiraConfig.mcp.env
      }
    }
  };
}

function parseJiraEnv(content: string): JiraEnv {
  const env: JiraEnv = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }

  return env;
}

function serializeJiraEnv(env: JiraEnv): string {
  return `${Object.entries(env)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}=${value.replace(/\r?\n/g, "")}`)
    .join("\n")}\n`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

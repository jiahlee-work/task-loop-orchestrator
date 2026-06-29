import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OpenAIConfig } from "./config.js";

export type OpenAIEnv = Record<string, string>;

export function openAIEnvPath(rootDir: string): string {
  return join(rootDir, ".orchestrator", "openai.env");
}

export async function readOpenAIEnvFile(rootDir: string): Promise<OpenAIEnv> {
  try {
    return parseOpenAIEnv(await readFile(openAIEnvPath(rootDir), "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw error;
  }
}

export async function writeOpenAIEnvFile(rootDir: string, env: OpenAIEnv): Promise<string> {
  const path = openAIEnvPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeOpenAIEnv(env), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export async function loadOpenAIConfigWithLocalEnv(rootDir: string, openAIConfig: OpenAIConfig): Promise<OpenAIConfig> {
  const localEnv = await readOpenAIEnvFile(rootDir);
  return {
    ...openAIConfig,
    endpoint: localEnv.OPENAI_ENDPOINT || openAIConfig.endpoint,
    model: localEnv.OPENAI_MODEL || openAIConfig.model,
    apiKey: localEnv.OPENAI_API_KEY || openAIConfig.apiKey || process.env.OPENAI_API_KEY
  };
}

function parseOpenAIEnv(content: string): OpenAIEnv {
  const env: OpenAIEnv = {};
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

function serializeOpenAIEnv(env: OpenAIEnv): string {
  return `${Object.entries(env)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}=${value.replace(/\r?\n/g, "")}`)
    .join("\n")}\n`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

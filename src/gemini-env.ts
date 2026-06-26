import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GeminiConfig } from "./config.js";

export type GeminiEnv = Record<string, string>;

export function geminiEnvPath(rootDir: string): string {
  return join(rootDir, ".orchestrator", "gemini.env");
}

export async function readGeminiEnvFile(rootDir: string): Promise<GeminiEnv> {
  try {
    return parseGeminiEnv(await readFile(geminiEnvPath(rootDir), "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw error;
  }
}

export async function writeGeminiEnvFile(rootDir: string, env: GeminiEnv): Promise<string> {
  const path = geminiEnvPath(rootDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeGeminiEnv(env), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export async function loadGeminiConfigWithLocalEnv(rootDir: string, geminiConfig: GeminiConfig): Promise<GeminiConfig> {
  const localEnv = await readGeminiEnvFile(rootDir);
  return {
    ...geminiConfig,
    endpoint: localEnv.GEMINI_ENDPOINT || geminiConfig.endpoint,
    model: localEnv.GEMINI_MODEL || geminiConfig.model,
    apiKey: localEnv.GEMINI_API_KEY || geminiConfig.apiKey || process.env.GEMINI_API_KEY
  };
}

function parseGeminiEnv(content: string): GeminiEnv {
  const env: GeminiEnv = {};
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

function serializeGeminiEnv(env: GeminiEnv): string {
  return `${Object.entries(env)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}=${value.replace(/\r?\n/g, "")}`)
    .join("\n")}\n`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

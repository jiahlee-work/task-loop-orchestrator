import { defaultOrchestratorConfig, type GeminiConfig } from "./config.js";
import { writeGeminiEnvFile, type GeminiEnv } from "./gemini-env.js";
import { GeminiPlanner } from "./gemini-planner.js";

export type GeminiSetupStatus = "ready" | "saved" | "needs_attention";

export interface GeminiSetupOptions {
  rootDir?: string;
  apiKey: string;
  model?: string;
  endpoint?: string;
  skipCheck?: boolean;
  geminiConfig?: GeminiConfig;
}

export interface GeminiSetupReport {
  status: GeminiSetupStatus;
  envFile: string;
  model: string;
  check: {
    status: "pass" | "warn" | "skipped";
    summary: string;
  };
  nextCommand: string;
}

export async function setupGemini(options: GeminiSetupOptions): Promise<GeminiSetupReport> {
  const rootDir = options.rootDir ?? process.cwd();
  const baseConfig = options.geminiConfig ?? defaultOrchestratorConfig.gemini;
  const env = createGeminiEnv(options, baseConfig);
  const envFile = await writeGeminiEnvFile(rootDir, env);
  const config: GeminiConfig = {
    ...baseConfig,
    endpoint: env.GEMINI_ENDPOINT ?? baseConfig.endpoint,
    model: env.GEMINI_MODEL ?? baseConfig.model,
    apiKey: env.GEMINI_API_KEY
  };

  if (options.skipCheck === true) {
    return {
      status: "saved",
      envFile,
      model: config.model,
      check: {
        status: "skipped",
        summary: "Gemini planner check skipped."
      },
      nextCommand: "tlo doctor gemini"
    };
  }

  const check = await new GeminiPlanner({ config }).checkConnection();
  return {
    status: check.ok ? "ready" : "needs_attention",
    envFile,
    model: config.model,
    check: {
      status: check.ok ? "pass" : "warn",
      summary: check.summary
    },
    nextCommand: check.ok ? "tlo run ISSUE-KEY" : "tlo doctor gemini"
  };
}

function createGeminiEnv(options: GeminiSetupOptions, baseConfig: GeminiConfig): GeminiEnv {
  return {
    GEMINI_API_KEY: requiredValue(options.apiKey, "Gemini API key"),
    GEMINI_MODEL: options.model?.trim() || baseConfig.model,
    GEMINI_ENDPOINT: options.endpoint?.trim() || baseConfig.endpoint
  };
}

function requiredValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

import { defaultOrchestratorConfig, type OpenAIConfig } from "./config.js";
import { writeOpenAIEnvFile, type OpenAIEnv } from "./openai-env.js";
import { OpenAIReviewer } from "./openai-reviewer.js";

export type OpenAISetupStatus = "ready" | "saved" | "needs_attention";

export interface OpenAISetupOptions {
  rootDir?: string;
  apiKey: string;
  model?: string;
  endpoint?: string;
  skipCheck?: boolean;
  openAIConfig?: OpenAIConfig;
}

export interface OpenAISetupReport {
  status: OpenAISetupStatus;
  envFile: string;
  model: string;
  check: {
    status: "pass" | "warn" | "skipped";
    summary: string;
  };
  nextCommand: string;
}

export async function setupOpenAI(options: OpenAISetupOptions): Promise<OpenAISetupReport> {
  const rootDir = options.rootDir ?? process.cwd();
  const baseConfig = options.openAIConfig ?? defaultOrchestratorConfig.openai;
  const env = createOpenAIEnv(options, baseConfig);
  const envFile = await writeOpenAIEnvFile(rootDir, env);
  const config: OpenAIConfig = {
    ...baseConfig,
    endpoint: env.OPENAI_ENDPOINT ?? baseConfig.endpoint,
    model: env.OPENAI_MODEL ?? baseConfig.model,
    apiKey: env.OPENAI_API_KEY
  };

  if (options.skipCheck === true) {
    return {
      status: "saved",
      envFile,
      model: config.model,
      check: {
        status: "skipped",
        summary: "OpenAI reviewer check skipped."
      },
      nextCommand: "tlo doctor openai"
    };
  }

  const check = await new OpenAIReviewer({ config }).checkConnection();
  return {
    status: check.ok ? "ready" : "needs_attention",
    envFile,
    model: config.model,
    check: {
      status: check.ok ? "pass" : "warn",
      summary: check.summary
    },
    nextCommand: check.ok ? "tlo run ISSUE-KEY" : "tlo doctor openai"
  };
}

function createOpenAIEnv(options: OpenAISetupOptions, baseConfig: OpenAIConfig): OpenAIEnv {
  return {
    OPENAI_API_KEY: requiredValue(options.apiKey, "OpenAI API key"),
    OPENAI_MODEL: options.model?.trim() || baseConfig.model,
    OPENAI_ENDPOINT: options.endpoint?.trim() || baseConfig.endpoint
  };
}

function requiredValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

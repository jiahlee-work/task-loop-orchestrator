import { defaultOrchestratorConfig, type JiraMcpConfig } from "./config.js";
import { writeJiraEnvFile, type JiraEnv } from "./jira-env.js";
import { hasJiraMcpEnvironment, JiraMcpProvider, type McpClientSessionFactory } from "./providers.js";

export type JiraSetupStatus = "ready" | "saved" | "needs_attention";

export interface JiraSetupOptions {
  rootDir?: string;
  url: string;
  username?: string;
  apiToken?: string;
  personalToken?: string;
  skipCheck?: boolean;
  mcpConfig?: JiraMcpConfig;
  mcpSessionFactory?: McpClientSessionFactory;
}

export interface JiraSetupReport {
  status: JiraSetupStatus;
  envFile: string;
  authMode: "cloud-api-token" | "personal-token";
  mcpCheck: {
    status: "pass" | "warn" | "skipped";
    summary: string;
  };
  nextCommand: string;
}

export async function setupJiraMcp(options: JiraSetupOptions): Promise<JiraSetupReport> {
  const rootDir = options.rootDir ?? process.cwd();
  const env = createJiraEnv(options);
  const envFile = await writeJiraEnvFile(rootDir, env);
  const mcpConfig = {
    ...(options.mcpConfig ?? defaultOrchestratorConfig.jira.mcp),
    env
  };

  if (options.skipCheck === true) {
    return {
      status: "saved",
      envFile,
      authMode: env.JIRA_PERSONAL_TOKEN ? "personal-token" : "cloud-api-token",
      mcpCheck: {
        status: "skipped",
        summary: "Jira MCP check skipped."
      },
      nextCommand: "task-loop-orchestrator doctor --jira"
    };
  }

  const mcpReady = hasJiraMcpEnvironment(mcpConfig)
    ? await new JiraMcpProvider(mcpConfig, rootDir, options.mcpSessionFactory).hasIssueTool()
    : false;

  return {
    status: mcpReady ? "ready" : "needs_attention",
    envFile,
    authMode: env.JIRA_PERSONAL_TOKEN ? "personal-token" : "cloud-api-token",
    mcpCheck: {
      status: mcpReady ? "pass" : "warn",
      summary: mcpReady
        ? `Jira MCP server exposes ${mcpConfig.toolName}.`
        : `Jira MCP server could not be verified. Run task-loop-orchestrator doctor --jira for details.`
    },
    nextCommand: mcpReady ? "task-loop-orchestrator run --jira ISSUE-KEY" : "task-loop-orchestrator doctor --jira"
  };
}

function createJiraEnv(options: JiraSetupOptions): JiraEnv {
  const url = requiredValue(options.url, "Jira URL");
  if (options.personalToken) {
    return {
      JIRA_URL: url,
      JIRA_PERSONAL_TOKEN: requiredValue(options.personalToken, "Jira personal token")
    };
  }

  return {
    JIRA_URL: url,
    JIRA_USERNAME: requiredValue(options.username, "Jira username"),
    JIRA_API_TOKEN: requiredValue(options.apiToken, "Jira API token")
  };
}

function requiredValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

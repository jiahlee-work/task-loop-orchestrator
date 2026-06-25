import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutorMode, GitHubProviderMode, JiraProviderMode, PermissionMode, ReviewerMode } from "./domain.js";

export interface JiraMcpConfig {
  command: string;
  args: string[];
  toolName: string;
  issueKeyArgument: string;
  env: Record<string, string>;
}

export interface JiraConfig {
  provider: JiraProviderMode;
  fallback: "cli" | "none";
  mcp: JiraMcpConfig;
}

export interface OrchestratorConfig {
  executor: ExecutorMode;
  reviewer: ReviewerMode;
  github: GitHubProviderMode;
  jira: JiraConfig;
  permissionMode: PermissionMode;
  worktree: {
    enabled: boolean;
  };
  maxIterations: number;
}

export const defaultOrchestratorConfig: OrchestratorConfig = {
  executor: "mock",
  reviewer: "mock",
  github: "none",
  jira: {
    provider: "mcp-atlassian",
    fallback: "cli",
    mcp: {
      command: "uvx",
      args: ["mcp-atlassian"],
      toolName: "jira_get_issue",
      issueKeyArgument: "issue_key",
      env: {}
    }
  },
  permissionMode: "write",
  worktree: {
    enabled: false
  },
  maxIterations: 10
};

export async function loadOrchestratorConfig(rootDir: string = process.cwd()): Promise<OrchestratorConfig> {
  const configPath = join(rootDir, "orchestrator.config.json");
  try {
    const content = await readFile(configPath, "utf8");
    return normalizeConfig(JSON.parse(content) as Partial<OrchestratorConfig>);
  } catch (error) {
    if (isMissingFileError(error)) {
      return defaultOrchestratorConfig;
    }

    throw error;
  }
}

export function normalizeConfig(input: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    executor: normalizeExecutorMode(input.executor),
    reviewer: normalizeReviewerMode(input.reviewer),
    github: normalizeGitHubProviderMode(input.github),
    jira: normalizeJiraConfig(input.jira),
    permissionMode: normalizePermissionMode(input.permissionMode),
    worktree: {
      enabled: typeof input.worktree?.enabled === "boolean" ? input.worktree.enabled : defaultOrchestratorConfig.worktree.enabled
    },
    maxIterations:
      typeof input.maxIterations === "number" && Number.isInteger(input.maxIterations) && input.maxIterations > 0
        ? input.maxIterations
        : defaultOrchestratorConfig.maxIterations
  };
}

export function normalizeExecutorMode(value: unknown): ExecutorMode {
  if (value === "mock" || value === "codex-cli-dry-run" || value === "codex-cli") {
    return value;
  }

  return defaultOrchestratorConfig.executor;
}

export function normalizeReviewerMode(value: unknown): ReviewerMode {
  if (value === "mock" || value === "local-evidence") {
    return value;
  }

  return defaultOrchestratorConfig.reviewer;
}

export function normalizeGitHubProviderMode(value: unknown): GitHubProviderMode {
  if (value === "none" || value === "gh-cli") {
    return value;
  }

  return defaultOrchestratorConfig.github;
}

export function normalizeJiraProviderMode(value: unknown): JiraProviderMode {
  if (value === "mcp-atlassian" || value === "cli") {
    return value;
  }

  return defaultOrchestratorConfig.jira.provider;
}

export function normalizeJiraConfig(value: unknown): JiraConfig {
  if (!isRecord(value)) {
    return defaultOrchestratorConfig.jira;
  }

  const fallback = value.fallback === "none" || value.fallback === "cli" ? value.fallback : defaultOrchestratorConfig.jira.fallback;
  return {
    provider: normalizeJiraProviderMode(value.provider),
    fallback,
    mcp: normalizeJiraMcpConfig(value.mcp)
  };
}

function normalizeJiraMcpConfig(value: unknown): JiraMcpConfig {
  if (!isRecord(value)) {
    return defaultOrchestratorConfig.jira.mcp;
  }

  return {
    command: typeof value.command === "string" && value.command.trim() ? value.command.trim() : defaultOrchestratorConfig.jira.mcp.command,
    args: Array.isArray(value.args)
      ? value.args.filter((item): item is string => typeof item === "string")
      : defaultOrchestratorConfig.jira.mcp.args,
    toolName:
      typeof value.toolName === "string" && value.toolName.trim()
        ? value.toolName.trim()
        : defaultOrchestratorConfig.jira.mcp.toolName,
    issueKeyArgument:
      typeof value.issueKeyArgument === "string" && value.issueKeyArgument.trim()
        ? value.issueKeyArgument.trim()
        : defaultOrchestratorConfig.jira.mcp.issueKeyArgument,
    env: isRecord(value.env)
      ? Object.fromEntries(Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : defaultOrchestratorConfig.jira.mcp.env
  };
}

export function normalizePermissionMode(value: unknown): PermissionMode {
  if (value === "read" || value === "write" || value === "maintainer") {
    return value;
  }

  return defaultOrchestratorConfig.permissionMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

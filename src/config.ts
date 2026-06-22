import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutorMode, GitHubProviderMode, PermissionMode, ReviewerMode } from "./domain.js";

export interface OrchestratorConfig {
  executor: ExecutorMode;
  reviewer: ReviewerMode;
  github: GitHubProviderMode;
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

export function normalizePermissionMode(value: unknown): PermissionMode {
  if (value === "read" || value === "write" || value === "maintainer") {
    return value;
  }

  return defaultOrchestratorConfig.permissionMode;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

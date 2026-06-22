import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { loadOrchestratorConfig } from "./config.js";
import type { GitHubProviderMode } from "./domain.js";
import { GitHubCliProvider, runCommand, type CommandRunner, type GitHubProvider } from "./providers.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  summary: string;
  details?: unknown;
  recommendedAction?: string;
}

export interface DoctorReport {
  status: DoctorStatus;
  rootDir: string;
  githubMode: GitHubProviderMode;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  githubMode?: GitHubProviderMode;
  commandRunner?: CommandRunner;
  githubProvider?: GitHubProvider;
  nodeVersion?: string;
}

export async function runDoctor(rootDir: string = process.cwd(), options: DoctorOptions = {}): Promise<DoctorReport> {
  const githubMode = options.githubMode ?? "none";
  const commandRunner = options.commandRunner ?? runCommand;
  const checks: DoctorCheck[] = [
    checkNodeVersion(options.nodeVersion ?? process.versions.node),
    await checkGitRepository(rootDir, commandRunner),
    await checkConfig(rootDir),
    await checkGitignore(rootDir),
    await checkStorePathAccess(rootDir)
  ];

  if (githubMode === "gh-cli") {
    const github = options.githubProvider ?? new GitHubCliProvider(rootDir, commandRunner);
    checks.push(...(await checkGitHub(github)));
  } else {
    checks.push({
      id: "github",
      status: "pass",
      summary: "GitHub diagnostics disabled.",
      details: { mode: "none" },
      recommendedAction: "Run doctor with --github gh-cli to check read-only GitHub access."
    });
  }

  return {
    status: aggregateDoctorStatus(checks),
    rootDir,
    githubMode,
    checks
  };
}

export function checkNodeVersion(version: string): DoctorCheck {
  return isNodeVersionAtLeast(version, 24)
    ? {
        id: "node",
        status: "pass",
        summary: `Node.js ${version} satisfies >=24.`,
        details: { version, required: ">=24" }
      }
    : {
        id: "node",
        status: "fail",
        summary: `Node.js ${version} does not satisfy >=24.`,
        details: { version, required: ">=24" },
        recommendedAction: "Install Node.js 24 or newer."
      };
}

export function isNodeVersionAtLeast(version: string, minimumMajor: number): boolean {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major >= minimumMajor;
}

async function checkGitRepository(rootDir: string, commandRunner: CommandRunner): Promise<DoctorCheck> {
  const result = await commandRunner("git", ["rev-parse", "--is-inside-work-tree"], rootDir);
  if (result.exitCode === 0 && result.stdout.trim() === "true") {
    return {
      id: "git_repository",
      status: "pass",
      summary: "Current directory is inside a Git repository."
    };
  }

  return {
    id: "git_repository",
    status: "warn",
    summary: "Current directory is not inside a Git repository.",
    details: {
      stderr: result.stderr.trim() || undefined
    },
    recommendedAction: "Run doctor from a Git repository, or initialize one with git init."
  };
}

async function checkConfig(rootDir: string): Promise<DoctorCheck> {
  const path = join(rootDir, "orchestrator.config.json");
  try {
    await readFile(path, "utf8");
    const config = await loadOrchestratorConfig(rootDir);
    return {
      id: "config",
      status: "pass",
      summary: "orchestrator.config.json exists and loads successfully.",
      details: {
        path,
        executor: config.executor,
        reviewer: config.reviewer,
        github: config.github,
        permissionMode: config.permissionMode,
        maxIterations: config.maxIterations
      }
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        id: "config",
        status: "warn",
        summary: "orchestrator.config.json is missing.",
        details: { path },
        recommendedAction: "Run task-loop-orchestrator init."
      };
    }

    return {
      id: "config",
      status: "fail",
      summary: "orchestrator.config.json could not be loaded.",
      details: { path, error: errorMessage(error) },
      recommendedAction: "Fix orchestrator.config.json or regenerate it with task-loop-orchestrator init --force."
    };
  }
}

async function checkGitignore(rootDir: string): Promise<DoctorCheck> {
  const path = join(rootDir, ".gitignore");
  try {
    const content = await readFile(path, "utf8");
    if (hasOrchestratorIgnore(content)) {
      return {
        id: "gitignore",
        status: "pass",
        summary: ".gitignore ignores .orchestrator/.",
        details: { path }
      };
    }

    return {
      id: "gitignore",
      status: "warn",
      summary: ".gitignore does not ignore .orchestrator/.",
      details: { path },
      recommendedAction: "Run task-loop-orchestrator init to append .orchestrator/."
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        id: "gitignore",
        status: "warn",
        summary: ".gitignore is missing.",
        details: { path },
        recommendedAction: "Run task-loop-orchestrator init."
      };
    }

    return {
      id: "gitignore",
      status: "fail",
      summary: ".gitignore could not be read.",
      details: { path, error: errorMessage(error) }
    };
  }
}

async function checkStorePathAccess(rootDir: string): Promise<DoctorCheck> {
  const path = join(rootDir, ".orchestrator");
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      return {
        id: "store_path",
        status: "fail",
        summary: ".orchestrator exists but is not a directory.",
        details: { path }
      };
    }

    await access(path, constants.R_OK | constants.W_OK);
    return {
      id: "store_path",
      status: "pass",
      summary: ".orchestrator directory is accessible.",
      details: { path, exists: true }
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      try {
        await access(rootDir, constants.R_OK | constants.W_OK);
        return {
          id: "store_path",
          status: "pass",
          summary: ".orchestrator directory is not created yet, and the project root is writable.",
          details: { path, exists: false }
        };
      } catch (accessError) {
        return {
          id: "store_path",
          status: "fail",
          summary: ".orchestrator is missing and the project root is not writable.",
          details: { path, error: errorMessage(accessError) }
        };
      }
    }

    return {
      id: "store_path",
      status: "fail",
      summary: ".orchestrator path accessibility could not be checked.",
      details: { path, error: errorMessage(error) }
    };
  }
}

async function checkGitHub(github: GitHubProvider): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  try {
    const repository = await github.getRepositoryInfo();
    checks.push(
      repository
        ? {
            id: "github_repository",
            status: "pass",
            summary: `GitHub repository resolved: ${repository.owner}/${repository.name}.`,
            details: repository
          }
        : {
            id: "github_repository",
            status: "warn",
            summary: "GitHub repository could not be resolved.",
            recommendedAction: "Check gh installation/authentication with gh auth status."
          }
    );
  } catch (error) {
    checks.push({
      id: "github_repository",
      status: "warn",
      summary: "GitHub repository check failed.",
      details: { error: errorMessage(error) },
      recommendedAction: "Check gh installation/authentication with gh auth status."
    });
  }

  try {
    const summary = await github.getCheckStatus("HEAD");
    const status: DoctorStatus = summary.status === "unknown" || summary.status === "not_found" ? "warn" : "pass";
    checks.push({
      id: "github_checks",
      status,
      summary: summary.summary,
      details: summary,
      recommendedAction: status === "warn" ? "Confirm gh authentication and repository check availability." : undefined
    });
  } catch (error) {
    checks.push({
      id: "github_checks",
      status: "warn",
      summary: "GitHub check status could not be read.",
      details: { error: errorMessage(error) },
      recommendedAction: "Confirm gh authentication and repository check availability."
    });
  }

  return checks;
}

function aggregateDoctorStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }

  return "pass";
}

function hasOrchestratorIgnore(content: string): boolean {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".orchestrator/" || line === ".orchestrator");
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

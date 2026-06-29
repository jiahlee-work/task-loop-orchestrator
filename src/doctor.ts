import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import {
  defaultOrchestratorConfig,
  loadOrchestratorConfig,
  type CodexConfig,
  type GeminiConfig,
  type JiraConfig,
  type OpenAIConfig
} from "./config.js";
import { GeminiPlanner } from "./gemini-planner.js";
import { OpenAIReviewer } from "./openai-reviewer.js";
import type { GitHubProviderMode } from "./domain.js";
import {
  GitHubCliProvider,
  hasJiraMcpEnvironment,
  JiraMcpProvider,
  runCommand,
  type CommandRunner,
  type GitHubProvider,
  type McpClientSessionFactory
} from "./providers.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCommandSuggestion {
  label: string;
  command: string[];
  reason: string;
  destructive: boolean;
}

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  summary: string;
  details?: unknown;
  recommendedAction?: string;
  suggestions?: DoctorCommandSuggestion[];
}

export interface DoctorReport {
  status: DoctorStatus;
  rootDir: string;
  githubMode: GitHubProviderMode;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  githubMode?: GitHubProviderMode;
  jira?: boolean;
  jiraConfig?: JiraConfig;
  codex?: boolean;
  codexConfig?: CodexConfig;
  gemini?: boolean;
  geminiConfig?: GeminiConfig;
  openai?: boolean;
  openAIConfig?: OpenAIConfig;
  jiraMcpSessionFactory?: McpClientSessionFactory;
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
      recommendedAction: "Run doctor with --github gh-cli to check read-only GitHub access.",
      suggestions: [
        commandSuggestion(
          "Check GitHub read access",
          ["tlo", "doctor", "--github", "gh-cli"],
          "Re-run doctor with read-only GitHub diagnostics enabled."
        )
      ]
    });
  }

  if (options.codex ?? true) {
    checks.push(...(await checkCodex(rootDir, commandRunner, options.codexConfig ?? defaultOrchestratorConfig.codex)));
  }

  if (options.jira === true) {
    checks.push(
      ...(await checkJira(
        rootDir,
        commandRunner,
        options.jiraConfig ?? defaultOrchestratorConfig.jira,
        options.jiraMcpSessionFactory
      ))
    );
  }

  if (options.gemini === true) {
    checks.push(await checkGemini(options.geminiConfig ?? defaultOrchestratorConfig.gemini));
  }

  if (options.openai === true) {
    checks.push(await checkOpenAI(options.openAIConfig ?? defaultOrchestratorConfig.openai));
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
    recommendedAction: "Run doctor from a Git repository, or initialize one with git init.",
    suggestions: [commandSuggestion("Initialize Git repository", ["git", "init"], "Create a local Git repository.")]
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
        planner: config.planner,
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
        recommendedAction: "Run tlo init.",
        suggestions: [initSuggestion("Create orchestrator config and ignore local state.")]
      };
    }

    return {
      id: "config",
      status: "fail",
      summary: "orchestrator.config.json could not be loaded.",
      details: { path, error: errorMessage(error) },
      recommendedAction: "Fix orchestrator.config.json or regenerate it with tlo init --force.",
      suggestions: [
        commandSuggestion(
          "Regenerate orchestrator config",
          ["tlo", "init", "--force"],
          "Overwrite the invalid config with the default orchestrator config.",
          true
        )
      ]
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
      recommendedAction: "Run tlo init to append .orchestrator/.",
      suggestions: [initSuggestion("Append .orchestrator/ to .gitignore without rewriting existing entries.")]
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        id: "gitignore",
        status: "warn",
        summary: ".gitignore is missing.",
        details: { path },
        recommendedAction: "Run tlo init.",
        suggestions: [initSuggestion("Create .gitignore and add .orchestrator/.")]
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
            recommendedAction: "Check gh installation/authentication with gh auth status.",
            suggestions: [ghAuthStatusSuggestion()]
          }
    );
  } catch (error) {
    checks.push({
      id: "github_repository",
      status: "warn",
      summary: "GitHub repository check failed.",
      details: { error: errorMessage(error) },
      recommendedAction: "Check gh installation/authentication with gh auth status.",
      suggestions: [ghAuthStatusSuggestion()]
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
      recommendedAction: status === "warn" ? "Confirm gh authentication and repository check availability." : undefined,
      suggestions:
        status === "warn"
          ? [
              ghAuthStatusSuggestion(),
              commandSuggestion(
                "Re-run GitHub doctor",
                ["tlo", "doctor", "--github", "gh-cli"],
                "Re-check read-only GitHub diagnostics after authentication or check availability changes."
              )
            ]
          : undefined
    });
  } catch (error) {
    checks.push({
      id: "github_checks",
      status: "warn",
      summary: "GitHub check status could not be read.",
      details: { error: errorMessage(error) },
      recommendedAction: "Confirm gh authentication and repository check availability.",
      suggestions: [
        ghAuthStatusSuggestion(),
        commandSuggestion(
          "Re-run GitHub doctor",
          ["tlo", "doctor", "--github", "gh-cli"],
          "Re-check read-only GitHub diagnostics after authentication or check availability changes."
        )
      ]
    });
  }

  return checks;
}

async function checkGemini(geminiConfig: GeminiConfig): Promise<DoctorCheck> {
  if (!geminiConfig.apiKey?.trim()) {
    return {
      id: "gemini_credentials",
      status: "warn",
      summary: "Gemini API key is not configured.",
      details: {
        model: geminiConfig.model,
        endpoint: geminiConfig.endpoint
      },
      recommendedAction: "Run tlo setup gemini to save local Gemini planner credentials.",
      suggestions: [
        commandSuggestion(
          "Set up Gemini Planner",
          ["tlo", "setup", "gemini"],
          "Save local Gemini API credentials in .orchestrator/gemini.env."
        )
      ]
    };
  }

  const check = await new GeminiPlanner({ config: geminiConfig }).checkConnection();
  if (check.ok) {
    return {
      id: "gemini_planner",
      status: "pass",
      summary: check.summary,
      details: {
        model: geminiConfig.model,
        endpoint: geminiConfig.endpoint
      }
    };
  }

  return {
    id: "gemini_planner",
    status: "warn",
    summary: `Gemini planner could not be verified: ${check.summary}`,
    details: {
      model: geminiConfig.model,
      endpoint: geminiConfig.endpoint
    },
    recommendedAction: "Check the Gemini API key, model, and network access.",
    suggestions: [
      commandSuggestion(
        "Re-run Gemini doctor",
        ["tlo", "doctor", "gemini"],
        "Re-check Gemini planner after fixing credentials or model settings."
      )
    ]
  };
}

async function checkOpenAI(openAIConfig: OpenAIConfig): Promise<DoctorCheck> {
  if (!openAIConfig.apiKey?.trim()) {
    return {
      id: "openai_credentials",
      status: "warn",
      summary: "OpenAI API key is not configured.",
      details: {
        model: openAIConfig.model,
        endpoint: openAIConfig.endpoint
      },
      recommendedAction: "Run tlo setup openai to save local OpenAI reviewer credentials.",
      suggestions: [
        commandSuggestion(
          "Set up OpenAI Reviewer",
          ["tlo", "setup", "openai"],
          "Save local OpenAI API credentials in .orchestrator/openai.env."
        )
      ]
    };
  }

  const check = await new OpenAIReviewer({ config: openAIConfig }).checkConnection();
  if (check.ok) {
    return {
      id: "openai_reviewer",
      status: "pass",
      summary: check.summary,
      details: {
        model: openAIConfig.model,
        endpoint: openAIConfig.endpoint
      }
    };
  }

  return {
    id: "openai_reviewer",
    status: "warn",
    summary: `OpenAI reviewer could not be verified: ${check.summary}`,
    details: {
      model: openAIConfig.model,
      endpoint: openAIConfig.endpoint
    },
    recommendedAction: "Check the OpenAI API key, model, and network access.",
    suggestions: [
      commandSuggestion(
        "Re-run OpenAI doctor",
        ["tlo", "doctor", "openai"],
        "Re-check OpenAI reviewer after fixing credentials or model settings."
      )
    ]
  };
}

export async function checkCodex(rootDir: string, commandRunner: CommandRunner, codexConfig: CodexConfig): Promise<DoctorCheck[]> {
  const command = codexConfig.binary || "codex";
  const versionResult = await commandRunner(command, ["--version"], rootDir);
  if (versionResult.exitCode !== 0) {
    return [
      {
        id: "codex_cli_command",
        status: "warn",
        summary: `Codex CLI command is not available: ${command}.`,
        details: {
          command,
          stderr: versionResult.stderr.trim() || undefined
        },
        recommendedAction: "Install Codex CLI or make sure the codex command is available on PATH.",
        suggestions: [
          commandSuggestion("Check Codex CLI", [command, "--version"], "Verify that the Codex CLI command is available."),
          commandSuggestion("Log in to Codex CLI", [command, "login"], "Authenticate the local Codex CLI account.")
        ]
      }
    ];
  }

  const checks: DoctorCheck[] = [
    {
      id: "codex_cli_command",
      status: "pass",
      summary: `Codex CLI command is available: ${command}.`,
      details: {
        command,
        version: versionResult.stdout.trim() || undefined
      }
    }
  ];

  const doctorResult = await commandRunner(command, ["doctor", "--json", "--no-color", "--ascii"], rootDir);
  const report = parseCodexDoctorReport(doctorResult.stdout);
  const authCheck = report?.checks?.["auth.credentials"];
  if (authCheck?.status === "ok") {
    checks.push({
      id: "codex_cli_auth",
      status: "pass",
      summary: "Codex CLI auth is configured; tlo will reuse the local Codex login.",
      details: {
        codexVersion: report?.codexVersion,
        auth: authCheck.summary,
        authMode: authCheck.details?.["stored auth mode"],
        storedApiKey: authCheck.details?.["stored API key"],
        storedChatGPTTokens: authCheck.details?.["stored ChatGPT tokens"]
      }
    });
    return checks;
  }

  checks.push({
    id: "codex_cli_auth",
    status: "warn",
    summary: authCheck ? `Codex CLI auth is not ready: ${authCheck.summary}` : "Codex CLI auth could not be verified.",
    details: {
      exitCode: doctorResult.exitCode,
      stderr: doctorResult.stderr.trim() || undefined,
      authStatus: authCheck?.status,
      authSummary: authCheck?.summary
    },
    recommendedAction: "Run codex login, then tlo doctor codex.",
    suggestions: [
      commandSuggestion("Log in to Codex CLI", [command, "login"], "Authenticate the local Codex CLI account."),
      commandSuggestion("Re-run Codex doctor", ["tlo", "doctor", "codex"], "Re-check Codex CLI readiness after login.")
    ]
  });
  return checks;
}

async function checkJira(
  rootDir: string,
  commandRunner: CommandRunner,
  jiraConfig: JiraConfig,
  jiraMcpSessionFactory?: McpClientSessionFactory
): Promise<DoctorCheck[]> {
  if (jiraConfig.provider === "cli") {
    return [await checkJiraCli(rootDir, commandRunner)];
  }

  const checks = await checkJiraMcp(rootDir, commandRunner, jiraConfig, jiraMcpSessionFactory);
  if (jiraConfig.fallback === "cli" && checks.some((check) => check.status !== "pass")) {
    checks.push(await checkJiraCli(rootDir, commandRunner, "jira_cli_fallback"));
  }

  return checks;
}

async function checkJiraMcp(
  rootDir: string,
  commandRunner: CommandRunner,
  jiraConfig: JiraConfig,
  jiraMcpSessionFactory?: McpClientSessionFactory
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  if (!hasJiraMcpEnvironment(jiraConfig.mcp)) {
    return [
      {
        id: "jira_mcp_credentials",
        status: "warn",
        summary: "Jira MCP credentials are not configured.",
        details: { required: ["JIRA_URL", "JIRA_USERNAME and JIRA_API_TOKEN, or JIRA_PERSONAL_TOKEN"] },
        recommendedAction: "Run tlo setup jira to save local Jira MCP credentials.",
        suggestions: [
          commandSuggestion(
            "Set up Jira MCP",
            ["tlo", "setup", "jira"],
            "Save local Jira MCP credentials in .orchestrator/jira.env."
          )
        ]
      }
    ];
  }

  checks.push({
    id: "jira_mcp_credentials",
    status: "pass",
    summary: "Jira MCP credentials are configured."
  });

  const commandCheck = await checkJiraMcpCommand(rootDir, commandRunner, jiraConfig);
  checks.push(commandCheck);
  if (commandCheck.status !== "pass") {
    return checks;
  }

  const provider = new JiraMcpProvider(jiraConfig.mcp, rootDir, jiraMcpSessionFactory);
  const toolCheck = await provider.checkIssueTool();
  if (toolCheck.status === "server_unavailable") {
    checks.push({
      id: "jira_mcp_server",
      status: "warn",
      summary: "Jira MCP server could not be started or queried.",
      details: {
        command: jiraConfig.mcp.command,
        args: jiraConfig.mcp.args,
        error: toolCheck.error
      },
      recommendedAction: "Check that uvx and mcp-atlassian can start, and confirm Jira credentials are valid.",
      suggestions: [
        commandSuggestion("Run Jira MCP server", [jiraConfig.mcp.command, ...jiraConfig.mcp.args], "Start the configured MCP server directly."),
        commandSuggestion(
          "Re-run Jira doctor",
          ["tlo", "doctor", "jira"],
          "Re-check Jira MCP after fixing server or credential issues."
        )
      ]
    });
    return checks;
  }

  checks.push({
    id: "jira_mcp_server",
    status: "pass",
    summary: "Jira MCP server starts and returns a tool list.",
    details: {
      command: jiraConfig.mcp.command,
      args: jiraConfig.mcp.args,
      availableTools: toolCheck.availableTools
    }
  });

  checks.push(
    toolCheck.status === "tool_available"
      ? {
          id: "jira_mcp_tool",
          status: "pass",
          summary: `Jira MCP server exposes ${jiraConfig.mcp.toolName}.`,
          details: { toolName: jiraConfig.mcp.toolName }
        }
      : {
          id: "jira_mcp_tool",
          status: "warn",
          summary: `Jira MCP server does not expose ${jiraConfig.mcp.toolName}.`,
          details: {
            expectedTool: jiraConfig.mcp.toolName,
            availableTools: toolCheck.availableTools
          },
          recommendedAction: "Confirm the mcp-atlassian version and Jira tool configuration.",
          suggestions: [
            commandSuggestion("Run Jira MCP server", [jiraConfig.mcp.command, ...jiraConfig.mcp.args], "Inspect the configured MCP server output."),
            commandSuggestion(
              "Re-run Jira doctor",
              ["tlo", "doctor", "jira"],
              "Re-check Jira MCP after updating the server or tool configuration."
            )
          ]
        }
  );

  return checks;
}

async function checkJiraMcpCommand(rootDir: string, commandRunner: CommandRunner, jiraConfig: JiraConfig): Promise<DoctorCheck> {
  const result = await commandRunner(jiraConfig.mcp.command, ["--version"], rootDir);
  if (result.exitCode === 0) {
    return {
      id: "jira_mcp_command",
      status: "pass",
      summary: `Jira MCP command is available: ${jiraConfig.mcp.command}.`,
      details: {
        command: jiraConfig.mcp.command,
        version: result.stdout.trim() || undefined
      }
    };
  }

  return {
    id: "jira_mcp_command",
    status: "warn",
    summary: `Jira MCP command is not available: ${jiraConfig.mcp.command}.`,
    details: {
      command: jiraConfig.mcp.command,
      stderr: result.stderr.trim() || undefined
    },
    recommendedAction: jiraConfig.mcp.command === "uvx" ? "Install uv so the uvx command is available." : "Install the configured MCP command.",
    suggestions:
      jiraConfig.mcp.command === "uvx"
        ? [commandSuggestion("Install uv with Homebrew", ["brew", "install", "uv"], "Install uvx for running mcp-atlassian.")]
        : [
            commandSuggestion(
              "Check MCP command",
              [jiraConfig.mcp.command, "--version"],
              "Verify that the configured MCP command is available on PATH."
            )
          ]
  };
}

async function checkJiraCli(rootDir: string, commandRunner: CommandRunner, id = "jira_cli"): Promise<DoctorCheck> {
  const result = await commandRunner("jira", ["version"], rootDir);
  if (result.exitCode === 0) {
    return {
      id,
      status: "pass",
      summary: "Jira CLI is installed.",
      details: {
        version: result.stdout.trim() || undefined
      }
    };
  }

  return {
    id,
    status: "warn",
    summary: "Jira CLI is not installed or is not available on PATH.",
    details: {
      stderr: result.stderr.trim() || undefined
    },
    recommendedAction: "Install and authenticate the Jira CLI before using tlo run ISSUE-KEY.",
    suggestions: [
      commandSuggestion(
        "Install Jira CLI with Homebrew",
        ["brew", "install", "jira-cli"],
        "Install the jira command on macOS."
      ),
      commandSuggestion("Initialize Jira CLI auth", ["jira", "init"], "Configure the Jira site and credentials.")
    ]
  };
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

interface CodexDoctorCheck {
  status?: string;
  summary?: string;
  details?: Record<string, string>;
}

interface CodexDoctorReport {
  codexVersion?: string;
  checks?: Record<string, CodexDoctorCheck>;
}

function parseCodexDoctorReport(stdout: string): CodexDoctorReport | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }

    const checks = isRecord(parsed.checks)
      ? Object.fromEntries(
          Object.entries(parsed.checks).flatMap(([key, value]) => {
            if (!isRecord(value)) {
              return [];
            }

            return [
              [
                key,
                {
                  status: typeof value.status === "string" ? value.status : undefined,
                  summary: typeof value.summary === "string" ? value.summary : undefined,
                  details: isRecord(value.details) ? stringifyRecord(value.details) : undefined
                }
              ]
            ];
          })
        )
      : undefined;

    return {
      codexVersion: typeof parsed.codexVersion === "string" ? parsed.codexVersion : undefined,
      checks
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringifyRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function initSuggestion(reason: string): DoctorCommandSuggestion {
  return commandSuggestion("Initialize orchestrator project", ["tlo", "init"], reason);
}

function ghAuthStatusSuggestion(): DoctorCommandSuggestion {
  return commandSuggestion("Check GitHub CLI auth", ["gh", "auth", "status"], "Inspect local gh authentication state.");
}

function commandSuggestion(
  label: string,
  command: string[],
  reason: string,
  destructive = false
): DoctorCommandSuggestion {
  return {
    label,
    command,
    reason,
    destructive
  };
}

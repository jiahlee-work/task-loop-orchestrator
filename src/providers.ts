import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { JiraMcpConfig } from "./config.js";
import type {
  GitHubCheckStatus,
  GitHubCheckSummary,
  GitHubPullRequestSummary,
  GitHubRepositoryInfo,
  JiraIssue,
  JiraIssueComment,
  PermissionMode,
  TaskSpec
} from "./domain.js";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args?: string[], cwd?: string) => Promise<CommandResult>;

export interface RepoSnapshot {
  status: string;
  diff?: string;
}

export interface RepoProvider {
  getStatus(): Promise<string>;
  getDiff(): Promise<string>;
  runCommand(command: string, args?: string[]): Promise<CommandResult>;
  prepareWorktree?(input: { branchHint: string; dryRun: boolean }): Promise<{ command: string[]; dryRun: boolean }>;
}

export interface GitHubProvider {
  getRepositoryInfo(): Promise<GitHubRepositoryInfo | undefined>;
  listPullRequests(): Promise<GitHubPullRequestSummary[]>;
  getCheckStatus(ref?: string): Promise<GitHubCheckSummary>;
}

export interface JiraProvider {
  getIssue(key: string): Promise<JiraIssue | undefined>;
  transitionIssue?(input: { key: string; transition: string }): Promise<unknown>;
}

export interface McpClientSession {
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export type McpClientSessionFactory = (config: JiraMcpConfig, rootDir: string) => Promise<McpClientSession>;

export type JiraMcpToolStatus = "server_unavailable" | "tool_missing" | "tool_available";

export interface JiraMcpToolCheck {
  status: JiraMcpToolStatus;
  toolName: string;
  availableTools: string[];
  error?: string;
}

export interface ToolProviders {
  repo: RepoProvider;
  github?: GitHubProvider;
  jira?: JiraProvider;
}

export class NoopRepoProvider implements RepoProvider {
  async getStatus(): Promise<string> {
    return "repo provider not configured";
  }

  async getDiff(): Promise<string> {
    return "";
  }

  async runCommand(): Promise<CommandResult> {
    return {
      exitCode: 0,
      stdout: "",
      stderr: ""
    };
  }
}

export class MockRepoProvider implements RepoProvider {
  constructor(private readonly snapshot: RepoSnapshot = { status: "mock repo status: clean", diff: "" }) {}

  async getStatus(): Promise<string> {
    return this.snapshot.status;
  }

  async getDiff(): Promise<string> {
    return this.snapshot.diff ?? "";
  }

  async runCommand(command: string, args: string[] = []): Promise<CommandResult> {
    return {
      exitCode: 0,
      stdout: `mock command: ${[command, ...args].join(" ")}`,
      stderr: ""
    };
  }

  async prepareWorktree(input: { branchHint: string; dryRun: boolean }): Promise<{ command: string[]; dryRun: boolean }> {
    return {
      command: ["git", "worktree", "add", "-b", input.branchHint, `.worktrees/${input.branchHint}`],
      dryRun: input.dryRun
    };
  }
}

export class GitRepoProvider implements RepoProvider {
  constructor(
    private readonly rootDir: string = process.cwd(),
    private readonly runner: CommandRunner = runCommand
  ) {}

  async getStatus(): Promise<string> {
    const result = await this.runGit(["status", "--short"]);
    return result.stdout.trim();
  }

  async getDiff(): Promise<string> {
    const headDiff = await this.runGit(["diff", "--stat", "HEAD"]);
    if (headDiff.exitCode === 0) {
      return headDiff.stdout.trim();
    }

    const fallbackDiff = await this.runGit(["diff", "--stat"]);
    return fallbackDiff.stdout.trim();
  }

  async runCommand(command: string, args: string[] = []): Promise<CommandResult> {
    return this.runner(command, args, this.rootDir);
  }

  async prepareWorktree(input: { branchHint: string; dryRun: boolean }): Promise<{ command: string[]; dryRun: boolean }> {
    const command = ["git", "worktree", "add", "-b", input.branchHint, `.worktrees/${input.branchHint}`];
    return {
      command,
      dryRun: input.dryRun
    };
  }

  private async runGit(args: string[]): Promise<CommandResult> {
    return this.runCommand("git", args);
  }
}

export class GitHubCliProvider implements GitHubProvider {
  constructor(
    private readonly rootDir: string = process.cwd(),
    private readonly runner: CommandRunner = runCommand,
    private readonly ghBinary: string = "gh"
  ) {}

  async getRepositoryInfo(): Promise<GitHubRepositoryInfo | undefined> {
    const result = await this.runGh(["repo", "view", "--json", "name,owner,url,defaultBranchRef,nameWithOwner"]);
    if (result.exitCode !== 0) {
      return undefined;
    }

    const parsed = parseJson(result.stdout);
    if (!isRecord(parsed)) {
      return undefined;
    }

    const nameWithOwner = typeof parsed.nameWithOwner === "string" ? parsed.nameWithOwner : undefined;
    const [ownerFromFullName, nameFromFullName] = nameWithOwner?.split("/") ?? [];
    const owner =
      isRecord(parsed.owner) && typeof parsed.owner.login === "string"
        ? parsed.owner.login
        : ownerFromFullName ?? "unknown";
    const defaultBranch =
      isRecord(parsed.defaultBranchRef) && typeof parsed.defaultBranchRef.name === "string"
        ? parsed.defaultBranchRef.name
        : "unknown";

    return {
      name: typeof parsed.name === "string" ? parsed.name : nameFromFullName ?? "unknown",
      owner,
      url: typeof parsed.url === "string" ? parsed.url : "",
      defaultBranch
    };
  }

  async listPullRequests(): Promise<GitHubPullRequestSummary[]> {
    const result = await this.runGh([
      "pr",
      "list",
      "--json",
      "number,title,state,headRefName,baseRefName,url,isDraft"
    ]);
    if (result.exitCode !== 0) {
      return [];
    }

    const parsed = parseJson(result.stdout);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRecord).map((item) => ({
      number: typeof item.number === "number" ? item.number : 0,
      title: typeof item.title === "string" ? item.title : "",
      state: typeof item.state === "string" ? item.state : "unknown",
      headRefName: typeof item.headRefName === "string" ? item.headRefName : "",
      baseRefName: typeof item.baseRefName === "string" ? item.baseRefName : "",
      url: typeof item.url === "string" ? item.url : "",
      isDraft: typeof item.isDraft === "boolean" ? item.isDraft : false
    }));
  }

  async getCheckStatus(ref?: string): Promise<GitHubCheckSummary> {
    const target = ref ?? "HEAD";
    const result = await this.runGh(["pr", "checks", target, "--json", "name,state,bucket,description,workflow"]);
    if (result.exitCode === 0) {
      const parsed = parseJson(result.stdout);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return createCheckSummaryFromItems(
          parsed.filter(isRecord).map((item) => ({
            name: typeof item.name === "string" ? item.name : typeof item.workflow === "string" ? item.workflow : "unknown",
            status: normalizeCheckStatus(item.state, item.bucket),
            summary: typeof item.description === "string" ? item.description : undefined
          })),
          target
        );
      }

      return {
        status: "not_found",
        summary: `No GitHub checks found for ${target}.`,
        ref: target,
        source: "github",
        details: []
      };
    }

    return this.getCommitCheckStatus(target, result.stderr);
  }

  private runGh(args: string[]): Promise<CommandResult> {
    return this.runner(this.ghBinary, args, this.rootDir);
  }

  private async getCommitCheckStatus(ref: string, prChecksError: string): Promise<GitHubCheckSummary> {
    const repository = await this.getRepositoryInfo();
    if (!repository || repository.owner === "unknown" || repository.name === "unknown") {
      return {
        status: classifyGhFailure(prChecksError),
        summary: prChecksError.trim() || `Unable to resolve GitHub repository for ${ref}.`,
        ref,
        source: "github"
      };
    }

    const result = await this.runGh([
      "api",
      `repos/${repository.owner}/${repository.name}/commits/${ref}/check-runs`,
      "--jq",
      ".check_runs"
    ]);
    if (result.exitCode !== 0) {
      return {
        status: classifyGhFailure(result.stderr),
        summary: result.stderr.trim() || `Unable to read GitHub check-runs for ${ref}.`,
        ref,
        source: "github"
      };
    }

    const parsed = parseJson(result.stdout);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        status: "not_found",
        summary: `No GitHub check-runs found for ${ref}.`,
        ref,
        source: "github",
        details: []
      };
    }

    return createCheckSummaryFromItems(
      parsed.filter(isRecord).map((item) => ({
        name: typeof item.name === "string" ? item.name : "unknown",
        status: normalizeCheckRunStatus(item.status, item.conclusion),
        summary: typeof item.conclusion === "string" ? item.conclusion : typeof item.status === "string" ? item.status : undefined
      })),
      ref
    );
  }
}

export class JiraCliProvider implements JiraProvider {
  constructor(
    private readonly rootDir: string = process.cwd(),
    private readonly runner: CommandRunner = runCommand,
    private readonly jiraBinary: string = "jira"
  ) {}

  async getIssue(key: string): Promise<JiraIssue | undefined> {
    const issueKey = key.trim();
    if (!issueKey) {
      return undefined;
    }

    const result = await this.runner(this.jiraBinary, ["issue", "view", issueKey, "--raw"], this.rootDir);
    if (result.exitCode !== 0) {
      return undefined;
    }

    const parsed = parseJson(result.stdout);
    if (!isRecord(parsed)) {
      return undefined;
    }

    return normalizeJiraIssue(issueKey, parsed);
  }
}

export class JiraMcpProvider implements JiraProvider {
  constructor(
    private readonly config: JiraMcpConfig,
    private readonly rootDir: string = process.cwd(),
    private readonly sessionFactory: McpClientSessionFactory = createStdioMcpSession
  ) {}

  async getIssue(key: string): Promise<JiraIssue | undefined> {
    const issueKey = key.trim();
    if (!issueKey) {
      return undefined;
    }

    if (!hasJiraMcpEnvironment(this.config)) {
      return undefined;
    }

    let session: McpClientSession | undefined;
    try {
      session = await this.sessionFactory(this.config, this.rootDir);
      const result = await session.callTool(this.config.toolName, {
        [this.config.issueKeyArgument]: issueKey
      });
      return normalizeJiraIssueFromMcpResult(issueKey, result);
    } catch {
      return undefined;
    } finally {
      await closeMcpSession(session);
    }
  }

  async hasIssueTool(): Promise<boolean> {
    if (!hasJiraMcpEnvironment(this.config)) {
      return false;
    }

    const result = await this.checkIssueTool();
    return result.status === "tool_available";
  }

  async checkIssueTool(): Promise<JiraMcpToolCheck> {
    if (!hasJiraMcpEnvironment(this.config)) {
      return {
        status: "server_unavailable",
        toolName: this.config.toolName,
        availableTools: [],
        error: "Jira MCP environment is not configured."
      };
    }

    let session: McpClientSession | undefined;
    try {
      session = await this.sessionFactory(this.config, this.rootDir);
      const result = await session.listTools();
      const availableTools = result.tools.map((tool) => tool.name);
      return {
        status: availableTools.includes(this.config.toolName) ? "tool_available" : "tool_missing",
        toolName: this.config.toolName,
        availableTools
      };
    } catch (error) {
      return {
        status: "server_unavailable",
        toolName: this.config.toolName,
        availableTools: [],
        error: errorMessage(error)
      };
    } finally {
      await closeMcpSession(session);
    }
  }
}

export function hasJiraMcpEnvironment(config: JiraMcpConfig): boolean {
  const env = mcpEnvironment(config.env);
  const hasUrl = Boolean(env.JIRA_URL);
  const hasCloudAuth = Boolean(env.JIRA_USERNAME && env.JIRA_API_TOKEN);
  const hasPersonalToken = Boolean(env.JIRA_PERSONAL_TOKEN);
  return hasUrl && (hasCloudAuth || hasPersonalToken);
}

export function createMockToolProviders(): ToolProviders {
  return {
    repo: new MockRepoProvider()
  };
}

export function createGitToolProviders(rootDir: string = process.cwd(), github?: GitHubProvider): ToolProviders {
  return {
    repo: new GitRepoProvider(rootDir),
    ...(github ? { github } : {})
  };
}

async function createStdioMcpSession(config: JiraMcpConfig, rootDir: string): Promise<McpClientSession> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: rootDir,
    env: mcpEnvironment(config.env),
    stderr: "pipe"
  });
  const client = new Client({ name: "task-loop-orchestrator", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  return {
    async listTools() {
      return client.listTools();
    },
    async callTool(name, args) {
      return client.callTool({ name, arguments: args });
    },
    async close() {
      await client.close();
      await transport.close();
    }
  };
}

function mcpEnvironment(overrides: Record<string, string>): Record<string, string> {
  const env = { ...getDefaultEnvironment() };
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && (key.startsWith("JIRA_") || key.startsWith("ATLASSIAN_"))) {
      env[key] = value;
    }
  }

  return { ...env, ...overrides };
}

async function closeMcpSession(session: McpClientSession | undefined): Promise<void> {
  if (!session) {
    return;
  }

  try {
    await session.close();
  } catch {
    // The primary MCP operation already produced the useful outcome.
  }
}

export function createTaskSpecFromJiraIssue(
  issue: JiraIssue,
  permissionMode: PermissionMode = "write",
  note?: string
): TaskSpec {
  const description = [
    issue.url ? `Jira: ${issue.url}` : undefined,
    issue.status ? `Status: ${issue.status}` : undefined,
    issue.issueType ? `Type: ${issue.issueType}` : undefined,
    issue.description,
    note?.trim() ? `User note:\n${note.trim()}` : undefined,
    issue.comments.length > 0
      ? `Comments:\n${issue.comments.map((comment) => `- ${comment.author ? `${comment.author}: ` : ""}${comment.body}`).join("\n")}`
      : undefined
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n");

  return {
    id: issue.key,
    title: `${issue.key}: ${issue.title}`,
    description: description || undefined,
    acceptanceCriteria:
      issue.acceptanceCriteria.length > 0
        ? issue.acceptanceCriteria
        : [`Read Jira issue ${issue.key} and produce bounded subtasks that preserve the issue requirements.`],
    permissionMode
  };
}

export async function runCommand(command: string, args: string[] = [], cwd: string = process.cwd()): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    return {
      exitCode: 0,
      stdout,
      stderr
    };
  } catch (error) {
    return commandErrorToResult(error);
  }
}

function commandErrorToResult(error: unknown): CommandResult {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { code?: number | string; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      exitCode: typeof maybeError.code === "number" ? maybeError.code : 1,
      stdout: typeof maybeError.stdout === "string" ? maybeError.stdout : maybeError.stdout?.toString() ?? "",
      stderr: typeof maybeError.stderr === "string" ? maybeError.stderr : maybeError.stderr?.toString() ?? ""
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: String(error)
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeJiraIssue(fallbackKey: string, value: Record<string, unknown>): JiraIssue | undefined {
  const fields = isRecord(value.fields) ? value.fields : value;
  const key = stringValue(value.key) ?? stringValue(fields.key) ?? fallbackKey;
  const title = stringValue(fields.summary) ?? stringValue(value.summary) ?? stringValue(value.title);
  if (!key || !title) {
    return undefined;
  }

  return {
    key,
    title,
    description: textFromUnknown(fields.description ?? value.description),
    status: namedValue(fields.status ?? value.status),
    issueType: namedValue(fields.issuetype ?? fields.issueType ?? value.issueType),
    url: stringValue(value.url) ?? stringValue(value.self),
    assignee: displayName(fields.assignee ?? value.assignee),
    reporter: displayName(fields.reporter ?? value.reporter),
    labels: stringArray(fields.labels ?? value.labels),
    comments: jiraComments(fields.comment ?? value.comments),
    acceptanceCriteria: acceptanceCriteriaFromFields(fields)
  };
}

function normalizeJiraIssueFromMcpResult(fallbackKey: string, result: unknown): JiraIssue | undefined {
  for (const candidate of jiraIssueCandidatesFromMcpResult(result)) {
    const issue = normalizeJiraIssue(fallbackKey, candidate);
    if (issue) {
      return issue;
    }
  }

  return undefined;
}

function jiraIssueCandidatesFromMcpResult(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result)) {
    return [];
  }

  const candidates: Record<string, unknown>[] = [];
  if (isRecord(result.structuredContent)) {
    candidates.push(result.structuredContent);
  }

  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    if (typeof item.text === "string") {
      const parsed = parseJson(item.text);
      if (isRecord(parsed)) {
        candidates.push(parsed);
      }
    }

    const resource = item.resource;
    if (isRecord(resource) && typeof resource.text === "string") {
      const parsed = parseJson(resource.text);
      if (isRecord(parsed)) {
        candidates.push(parsed);
      }
    }
  }

  return candidates;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function namedValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return stringValue(value);
  }

  if (isRecord(value)) {
    return stringValue(value.name) ?? stringValue(value.value);
  }

  return undefined;
}

function displayName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return stringValue(value);
  }

  if (isRecord(value)) {
    return stringValue(value.displayName) ?? stringValue(value.name) ?? stringValue(value.emailAddress);
  }

  return undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : undefined))
    .filter((item): item is string => Boolean(item));
}

function jiraComments(value: unknown): JiraIssueComment[] {
  const comments = isRecord(value) && Array.isArray(value.comments) ? value.comments : Array.isArray(value) ? value : [];
  return comments.filter(isRecord).flatMap((comment) => {
    const body = textFromUnknown(comment.body);
    if (!body) {
      return [];
    }

    return [
      {
        author: displayName(comment.author),
        body,
        createdAt: stringValue(comment.created)
      }
    ];
  });
}

function acceptanceCriteriaFromFields(fields: Record<string, unknown>): string[] {
  const candidates = [fields.acceptanceCriteria, fields.acceptance_criteria, fields.criteria];
  for (const candidate of candidates) {
    const text = textFromUnknown(candidate);
    if (text) {
      return text
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean);
    }
  }

  return [];
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    return stringValue(value);
  }

  if (isRecord(value)) {
    if (typeof value.text === "string") {
      return stringValue(value.text);
    }

    if (Array.isArray(value.content)) {
      return joinText(value.content);
    }
  }

  if (Array.isArray(value)) {
    return joinText(value);
  }

  return undefined;
}

function joinText(values: unknown[]): string | undefined {
  const text = values
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (!isRecord(item)) {
        return "";
      }

      if (typeof item.text === "string") {
        return item.text;
      }

      if (Array.isArray(item.content)) {
        return joinText(item.content) ?? "";
      }

      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return text || undefined;
}

function classifyGhFailure(stderr: string): GitHubCheckStatus {
  const normalized = stderr.toLowerCase();
  if (
    normalized.includes("command not found") ||
    normalized.includes("authentication") ||
    normalized.includes("not logged") ||
    normalized.includes("could not resolve")
  ) {
    return "unknown";
  }

  if (normalized.includes("not found") || normalized.includes("no pull requests")) {
    return "not_found";
  }

  return "unknown";
}

function normalizeCheckStatus(state: unknown, bucket: unknown): GitHubCheckStatus {
  const value = `${typeof state === "string" ? state : ""} ${typeof bucket === "string" ? bucket : ""}`.toLowerCase();
  if (value.includes("pass") || value.includes("success")) {
    return "success";
  }

  if (value.includes("fail") || value.includes("cancel")) {
    return "failure";
  }

  if (value.includes("error")) {
    return "error";
  }

  if (value.includes("pending") || value.includes("progress") || value.includes("queued") || value.includes("waiting")) {
    return "pending";
  }

  return "unknown";
}

function aggregateCheckStatus(statuses: GitHubCheckStatus[]): GitHubCheckStatus {
  if (statuses.some((status) => status === "error")) {
    return "error";
  }

  if (statuses.some((status) => status === "failure")) {
    return "failure";
  }

  if (statuses.some((status) => status === "pending")) {
    return "pending";
  }

  if (statuses.length > 0 && statuses.every((status) => status === "success")) {
    return "success";
  }

  return "unknown";
}

function summarizeCheckStatus(status: GitHubCheckStatus, count: number): string {
  return `GitHub checks ${status} (${count} check${count === 1 ? "" : "s"}).`;
}

function normalizeCheckRunStatus(status: unknown, conclusion: unknown): GitHubCheckStatus {
  const normalizedStatus = typeof status === "string" ? status.toLowerCase() : "";
  const normalizedConclusion = typeof conclusion === "string" ? conclusion.toLowerCase() : "";

  if (normalizedStatus && normalizedStatus !== "completed") {
    return "pending";
  }

  if (normalizedConclusion === "success" || normalizedConclusion === "neutral" || normalizedConclusion === "skipped") {
    return "success";
  }

  if (
    normalizedConclusion === "failure" ||
    normalizedConclusion === "cancelled" ||
    normalizedConclusion === "timed_out" ||
    normalizedConclusion === "action_required"
  ) {
    return "failure";
  }

  if (normalizedConclusion === "startup_failure") {
    return "error";
  }

  if (!normalizedConclusion) {
    return "pending";
  }

  return "unknown";
}

function createCheckSummaryFromItems(
  details: NonNullable<GitHubCheckSummary["details"]>,
  ref: string
): GitHubCheckSummary {
  const status = aggregateCheckStatus(details.map((detail) => detail.status));
  return {
    status,
    summary: summarizeCheckStatus(status, details.length),
    ref,
    source: "github",
    details
  };
}

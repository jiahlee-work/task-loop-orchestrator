export type PermissionMode = "read" | "write" | "maintainer";

export type ExecutorMode = "mock" | "codex-cli-dry-run" | "codex-cli";

export type ReviewerMode = "mock" | "local-evidence";

export type GitHubProviderMode = "none" | "gh-cli";

export type ReviewVerdict = "accept" | "request_changes" | "reschedule" | "owner_decision";

export type IntegrationCheckpointStatus = "clean" | "needs_attention" | "blocked";

export type GitHubCheckStatus = "success" | "pending" | "failure" | "error" | "not_found" | "unknown";

export type ReviewEvidenceKind =
  | "executor_summary"
  | "executor_command"
  | "repo_status"
  | "diff_stat"
  | "test_result_placeholder"
  | "acceptance_criteria_coverage";

export type ActionType =
  | "read_state"
  | "create_branch"
  | "write_file"
  | "run_tests"
  | "commit"
  | "push"
  | "create_pr"
  | "merge_pr"
  | "jira_transition"
  | "release";

export type RunStatus = "created" | "running" | "completed" | "blocked" | "failed";

export type RoleName = "planner" | "executor" | "reviewer";

export type RoleReportStatus = "ok" | "blocked" | "failed";

export type ContextItemKind = "fact" | "assumption" | "decision" | "completed" | "blocked";

export type LoopEventKind =
  | "discovered"
  | "planned"
  | "subtask_selected"
  | "execution_started"
  | "execution_completed"
  | "review_completed"
  | "verification_evidence_collected"
  | "integration_checkpoint_ready"
  | "context_updated"
  | "graph_updated"
  | "permission_denied"
  | "run_completed"
  | "run_blocked"
  | "run_failed";

export interface LoopEvent {
  id: string;
  kind: LoopEventKind;
  message: string;
  createdAt: string;
  role?: RoleName | "root";
  subtaskId?: string;
  action?: ActionType;
  data?: Record<string, unknown>;
}

export interface TaskSpec {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria: string[];
  permissionMode: PermissionMode;
}

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  text: string;
  source: RoleName | "root";
  createdAt: string;
}

export interface Context {
  runId: string;
  task: TaskSpec;
  items: ContextItem[];
}

export type SubtaskStatus = "pending" | "active" | "completed" | "blocked" | "failed";

export interface Subtask {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  status: SubtaskStatus;
  assignedRole?: RoleName;
  result?: string;
  verification?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphConflict {
  id: string;
  subtaskId?: string;
  description: string;
  createdAt: string;
}

export interface ActiveWorker {
  role: RoleName;
  subtaskId: string;
  startedAt: string;
}

export interface Graph {
  subtasks: Subtask[];
  conflicts: GraphConflict[];
  activeWorker?: ActiveWorker;
  nextCandidateId?: string;
}

export interface ContextDelta {
  items: Array<Omit<ContextItem, "id" | "createdAt">>;
}

export interface ExecutorTaskSpec {
  runId: string;
  subtaskId: string;
  taskSpecSummary: string;
  boundedGoal: string;
  nonGoals: string[];
  contextSummary: string;
  permissionMode: PermissionMode;
  worktree: {
    enabled: boolean;
    branchHint: string;
  };
}

export interface ReviewEvidence {
  kind: ReviewEvidenceKind;
  summary: string;
  data?: Record<string, unknown>;
}

export interface ReviewerReportData {
  [key: string]: unknown;
  verdict: ReviewVerdict;
  evidence: ReviewEvidence[];
  readOnly: true;
  limitedEvidence?: boolean;
  ownerDecisionReason?: string;
}

export interface IntegrationCheckpointCounts {
  completed: number;
  blocked: number;
  pending: number;
  active: number;
  failed: number;
}

export interface IntegrationCheckpointOwnerDecisionItem {
  source: "reviewer" | "graph" | "context";
  reason: string;
  subtaskId?: string;
}

export interface IntegrationCheckpointMaintainerActionCandidate {
  action: Extract<ActionType, "push" | "merge_pr" | "jira_transition" | "release" | "create_pr">;
  label: string;
  reason: string;
  decisionReady: true;
}

export interface GitHubRepositoryInfo {
  name: string;
  owner: string;
  url: string;
  defaultBranch: string;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
}

export interface GitHubCheckSummary {
  status: GitHubCheckStatus;
  summary: string;
  ref?: string;
  source: "github";
  details?: Array<{
    name: string;
    status: GitHubCheckStatus;
    summary?: string;
  }>;
}

export interface IntegrationCheckpointReport {
  id: string;
  runId: string;
  status: IntegrationCheckpointStatus;
  counts: IntegrationCheckpointCounts;
  repoStatus: string;
  diffStat: string;
  ciCheck: {
    status: GitHubCheckStatus | "not_run";
    summary: string;
    ref?: string;
    source: "placeholder" | "github";
    details?: GitHubCheckSummary["details"];
  };
  conflictRisks: string[];
  recommendedNextAction: string;
  maintainerActionCandidates: IntegrationCheckpointMaintainerActionCandidate[];
  ownerDecisionItems: IntegrationCheckpointOwnerDecisionItem[];
  createdAt: string;
}

export type ProposedSubtask = Omit<Subtask, "status" | "createdAt" | "updatedAt"> &
  Partial<Pick<Subtask, "createdAt" | "updatedAt">>;

export interface RoleReport {
  role: RoleName;
  status: RoleReportStatus;
  summary: string;
  subtaskId?: string;
  contextDelta?: ContextDelta;
  proposedSubtasks?: ProposedSubtask[];
  data?: Record<string, unknown>;
}

export interface LoopRun {
  id: string;
  spec: TaskSpec;
  context: Context;
  graph: Graph;
  events: LoopEvent[];
  status: RunStatus;
  iterations: number;
  permissionMode: PermissionMode;
  createdAt: string;
  updatedAt: string;
}

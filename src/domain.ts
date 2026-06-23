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

export interface PullRequestCommandCandidate {
  action: Extract<ActionType, "create_branch" | "commit" | "push" | "create_pr">;
  command: string[];
  reason: string;
  decisionReady: true;
}

export interface PullRequestPlan {
  id: string;
  runId: string;
  checkpointId?: string;
  sourceBranchHint: string;
  baseBranch: string;
  title: string;
  body: string;
  preconditions: string[];
  blockedReasons: string[];
  commandCandidates: PullRequestCommandCandidate[];
  createdAt: string;
}

export type ApprovalScope = "pr_execution";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type PullRequestExecutionMode = "dry-run" | "execute";

export type PullRequestExecutionStatus = "dry_run" | "ready" | "blocked";

export type ExecutionIntentStatus = "created" | "blocked" | "expired";

export type ExecutionTraceStatus = "planned" | "blocked";

export type ExecutionTracePolicyDecision = "dry_run_planned" | "blocked";

export interface ApprovalPlanSnapshot {
  planTitle: string;
  baseBranch: string;
  sourceBranchHint: string;
  blockedReasons: string[];
  commandCandidateActions: PullRequestCommandCandidate["action"][];
}

export interface ApprovalRecord {
  id: string;
  scope: ApprovalScope;
  planId: string;
  runId: string;
  checkpointId?: string;
  planSnapshot?: ApprovalPlanSnapshot;
  status: ApprovalStatus;
  approvedBy?: string;
  reason?: string;
  createdAt: string;
}

export interface PullRequestExecutionReport {
  id: string;
  planId: string;
  runId: string;
  mode: PullRequestExecutionMode;
  status: PullRequestExecutionStatus;
  approval?: ApprovalRecord;
  blockedReasons: string[];
  commandCandidates: PullRequestCommandCandidate[];
  executedCommands: string[][];
  message: string;
  createdAt: string;
}

export interface ExecutionIntentCommandCandidate {
  action: PullRequestCommandCandidate["action"];
  command: string[];
  reason: string;
  decisionReady: true;
}

export interface ExecutionIntentCommandActionSummary {
  action: PullRequestCommandCandidate["action"];
  count: number;
}

export interface ExecutionTraceCommandCandidate {
  action: PullRequestCommandCandidate["action"];
  argv: string[];
  reason: string;
}

export interface ExecutionIntent {
  id: string;
  runId: string;
  planId: string;
  planFingerprint: string;
  checkpointId?: string;
  approvalId: string;
  actor: string;
  reason?: string;
  createdAt: string;
  expiresAt: string;
  targetRef: string;
  baseBranch: string;
  sourceBranch: string;
  permissionMode: PermissionMode;
  policyVersion: string;
  commandCandidates: ExecutionIntentCommandCandidate[];
  status: ExecutionIntentStatus;
  blockedReasons: string[];
}

export interface ExecutionIntentReport {
  id: string;
  runId: string;
  planId: string;
  approvalId: string;
  checkpointId?: string;
  status: ExecutionIntentStatus;
  actor: string;
  reason?: string;
  createdAt: string;
  expiresAt: string;
  targetRef: string;
  baseBranch: string;
  sourceBranch: string;
  permissionMode: PermissionMode;
  policyVersion: string;
  commandCandidateCount: number;
  commandCandidateActions: PullRequestCommandCandidate["action"][];
  commandActionSummary: ExecutionIntentCommandActionSummary[];
  blockedReasonCount: number;
  blockedReasons: string[];
  executionEnabled: false;
  writeExecution: "disabled";
}

export interface ExecutionTraceRecord {
  id: string;
  intentId: string;
  runId: string;
  planId: string;
  approvalId: string;
  checkpointId?: string;
  commandCandidate: ExecutionTraceCommandCandidate;
  status: ExecutionTraceStatus;
  policyVersion: string;
  policyDecision: ExecutionTracePolicyDecision;
  blockedReasons: string[];
  createdAt: string;
  executionEnabled: false;
  writeExecution: "disabled";
}

export interface ExecutionTraceReport {
  id: string;
  intentId: string;
  runId: string;
  planId: string;
  approvalId: string;
  checkpointId?: string;
  action: PullRequestCommandCandidate["action"];
  argv: string[];
  reason: string;
  status: ExecutionTraceStatus;
  policyVersion: string;
  policyDecision: ExecutionTracePolicyDecision;
  blockedReasonCount: number;
  blockedReasons: string[];
  createdAt: string;
  executionEnabled: false;
  writeExecution: "disabled";
  hasExecutionResults: false;
}

export interface ExecutionAuditBundle {
  intent: ExecutionIntentReport;
  traces: ExecutionTraceReport[];
  traceCount: number;
  plannedTraceCount: number;
  blockedTraceCount: number;
  traceActionSummary: ExecutionIntentCommandActionSummary[];
  blockedReasonCount: number;
  blockedReasons: string[];
  mismatchedTraceCount: number;
  mismatchedTraceIds: string[];
  executionEnabled: false;
  writeExecution: "disabled";
  hasExecutionResults: false;
}

export interface ExecutionAuditListReport {
  status: "ok";
  bundleCount: number;
  bundles: ExecutionAuditBundle[];
  executionEnabled: false;
  writeExecution: "disabled";
  hasExecutionResults: false;
}

export interface ExecutionAuditErrorReport {
  status: "not_found" | "error";
  errorCode: string;
  message: string;
  intentId?: string;
  intent: null;
  details?: {
    kind: "execution_intent" | "execution_trace";
  };
  executionEnabled: false;
  writeExecution: "disabled";
  hasExecutionResults: false;
}

export type WriteExecutionReadinessStatus = "ready" | "blocked" | "unknown";

export type WriteExecutionReadinessCategory =
  | "approval"
  | "precondition"
  | "permission"
  | "trace"
  | "policy"
  | "ci"
  | "repo_state"
  | "unknown";

export type WriteExecutionReadinessCheckStatus = "pass" | "blocked" | "unknown";

export type WriteExecutionReadinessSource = "audit_bundle" | "preflight";

export interface WriteExecutionReadinessBlocker {
  category: WriteExecutionReadinessCategory;
  code: string;
  message: string;
  source: WriteExecutionReadinessSource;
}

export interface WriteExecutionReadinessCheck {
  category: WriteExecutionReadinessCategory;
  status: WriteExecutionReadinessCheckStatus;
  code: string;
  message: string;
  source: WriteExecutionReadinessSource;
}

export interface WriteExecutionReadinessPreflightInput {
  approvalFresh?: boolean;
  approvalNotExpired?: boolean;
  planFingerprintMatches?: boolean;
  checkpointMatches?: boolean;
  repoClean?: boolean;
  diffVerified?: boolean;
  refPolicySatisfied?: boolean;
  ciPolicySatisfied?: boolean;
  permissionAllowed?: boolean;
  commandRunnerConfigured?: boolean;
}

export interface WriteExecutionReadinessReport {
  readinessStatus: WriteExecutionReadinessStatus;
  ready: boolean;
  intentId: string;
  runId: string;
  planId: string;
  approvalId: string;
  checkpointId?: string;
  blockers: WriteExecutionReadinessBlocker[];
  checks: WriteExecutionReadinessCheck[];
  inputs: {
    auditBundle: "available";
    preflight: "missing" | "partial" | "available";
  };
  executionEnabled: false;
  writeExecution: "disabled";
  hasExecutionResults: false;
}

export interface WriteReadinessErrorReport {
  status: "not_found" | "error";
  errorCode:
    | "write_readiness_missing_intent"
    | "write_readiness_intent_not_found"
    | "invalid_execution_intent_file"
    | "invalid_execution_trace_file"
    | "write_readiness_preflight_unsupported";
  message: string;
  intentId?: string;
  readiness: null;
  details?: {
    kind: "execution_intent" | "execution_trace" | "preflight";
  };
  executionEnabled: false;
  writeExecution: "disabled";
  hasExecutionResults: false;
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

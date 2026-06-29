import { createContextDeltaItem } from "./context.js";
import type {
  Context,
  Graph,
  ReviewEvidence,
  ReviewerReportData,
  ReviewVerdict,
  RoleReport,
  Subtask,
  TaskSpec
} from "./domain.js";
import type { RepoProvider } from "./providers.js";
import type { RootContractArtifact } from "./run-state.js";
import type { ReviewerProvider, ReviewerProviderInput } from "./roles.js";

export interface ReviewEvidenceCollectorInput {
  spec: TaskSpec;
  context: Context;
  graph: Graph;
  rootContract?: RootContractArtifact;
  subtask: Subtask;
  executorReport: RoleReport;
  repo: RepoProvider;
}

export async function collectReviewEvidence(input: ReviewEvidenceCollectorInput): Promise<ReviewEvidence[]> {
  const [repoStatus, diffStat] = await Promise.all([input.repo.getStatus(), input.repo.getDiff()]);
  const command = extractExecutorCommand(input.executorReport);

  return [
    {
      kind: "executor_summary",
      summary: input.executorReport.summary,
      data: {
        status: input.executorReport.status,
        subtaskId: input.executorReport.subtaskId
      }
    },
    ...(command
      ? [
          {
            kind: "executor_command" as const,
            summary: command.join(" "),
            data: {
              command
            }
          }
        ]
      : []),
    {
      kind: "repo_status",
      summary: repoStatus || "clean",
      data: {
        raw: repoStatus
      }
    },
    {
      kind: "diff_stat",
      summary: diffStat || "no diff stat",
      data: {
        raw: diffStat
      }
    },
    {
      kind: "test_result_placeholder",
      summary: "No test command was run by reviewer; placeholder only.",
      data: {
        executed: false
      }
    },
    {
      kind: "acceptance_criteria_coverage",
      summary:
        acceptanceCriteria(input).length > 0
          ? `${acceptanceCriteria(input).length} acceptance criteria available for review.`
          : "No acceptance criteria available.",
      data: {
        criteria: acceptanceCriteria(input),
        covered: acceptanceCriteria(input).map((criterion) => ({
          criterion,
          covered: false,
          reason: "Automated evidence coverage is not implemented yet."
        }))
      }
    },
    {
      kind: "context_guard_coverage",
      summary:
        contextGuard(input).length > 0
          ? `${contextGuard(input).length} context guard item(s) available for review.`
          : "No context guard items available.",
      data: {
        contextGuard: contextGuard(input),
        checked: contextGuard(input).map((item) => ({
          item,
          passed: false,
          reason: "Automated context guard checking is not implemented yet."
        }))
      }
    }
  ];
}

export class LocalEvidenceReviewer implements ReviewerProvider {
  async review(input: ReviewerProviderInput): Promise<RoleReport> {
    const evidence = input.evidence ?? [];
    const verdict = decideVerdict(input, evidence);
    const status = verdict === "accept" ? "ok" : "blocked";
    const ownerDecisionReason =
      verdict === "owner_decision" ? "Acceptance criteria are required before reviewer can verify completion." : undefined;
    const limitedEvidence = isLimitedEvidence(evidence);
    const data: ReviewerReportData = {
      verdict,
      evidence,
      readOnly: true,
      ...(limitedEvidence ? { limitedEvidence } : {}),
      ...(ownerDecisionReason ? { ownerDecisionReason } : {})
    };

    return {
      role: "reviewer",
      status,
      subtaskId: input.subtask.id,
      summary: createSummary(verdict, input.subtask.title, ownerDecisionReason),
      contextDelta: createContextDeltaItem(
        status === "ok" ? "fact" : "blocked",
        `Reviewer verdict for ${input.subtask.id}: ${verdict}.`,
        "reviewer"
      ),
      data
    };
  }
}

export function isReviewerReportData(value: unknown): value is ReviewerReportData {
  return (
    typeof value === "object" &&
    value !== null &&
    "verdict" in value &&
    "evidence" in value &&
    "readOnly" in value &&
    (value as ReviewerReportData).readOnly === true
  );
}

function decideVerdict(input: ReviewerProviderInput, evidence: ReviewEvidence[]): ReviewVerdict {
  if (input.executorReport.status !== "ok") {
    return "request_changes";
  }

  if (acceptanceCriteria(input).length === 0) {
    return "owner_decision";
  }

  if (input.executorReport.data?.dryRun === true) {
    return "request_changes";
  }

  return "accept";
}

function createSummary(verdict: ReviewVerdict, subtaskTitle: string, ownerDecisionReason: string | undefined): string {
  if (ownerDecisionReason) {
    return `Owner decision required for ${subtaskTitle}: ${ownerDecisionReason}`;
  }

  if (verdict === "accept") {
    return `Accepted ${subtaskTitle} with collected local evidence.`;
  }

  if (verdict === "reschedule") {
    return `Reschedule requested for ${subtaskTitle}.`;
  }

  return `Changes requested for ${subtaskTitle}.`;
}

function isLimitedEvidence(evidence: ReviewEvidence[]): boolean {
  const hasDiff = evidence.some((item) => item.kind === "diff_stat" && item.summary !== "no diff stat");
  const hasExecutedTests = evidence.some(
    (item) => item.kind === "test_result_placeholder" && item.data?.executed === true
  );
  return !hasDiff || !hasExecutedTests;
}

function extractExecutorCommand(report: RoleReport): string[] | undefined {
  const command = report.data?.command;
  return Array.isArray(command) && command.every((item) => typeof item === "string") ? command : undefined;
}

function acceptanceCriteria(input: Pick<ReviewEvidenceCollectorInput, "spec" | "rootContract">): string[] {
  return input.rootContract?.acceptanceCriteria.length ? input.rootContract.acceptanceCriteria : input.spec.acceptanceCriteria;
}

function contextGuard(input: Pick<ReviewEvidenceCollectorInput, "rootContract">): string[] {
  return input.rootContract?.contextGuard ?? [];
}

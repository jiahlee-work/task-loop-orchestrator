import type { OpenAIConfig } from "./config.js";
import { createContextDeltaItem } from "./context.js";
import type { ReviewEvidence, ReviewerReportData, ReviewVerdict, RoleReport } from "./domain.js";
import type { ReviewerProvider, ReviewerProviderInput } from "./roles.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAIReviewerOptions {
  config: OpenAIConfig;
  fetchImpl?: FetchLike;
}

interface OpenAIReviewResponse {
  verdict?: ReviewVerdict;
  summary?: string;
  reasons?: string[];
}

export class OpenAIReviewer implements ReviewerProvider {
  private readonly config: OpenAIConfig;
  private readonly fetchImpl: FetchLike;

  constructor(options: OpenAIReviewerOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async review(input: ReviewerProviderInput): Promise<RoleReport> {
    if (!this.config.apiKey?.trim()) {
      return {
        role: "reviewer",
        status: "blocked",
        subtaskId: input.subtask.id,
        summary: "OpenAI Reviewer is not configured. Run tlo setup openai.",
        contextDelta: createContextDeltaItem("blocked", "OpenAI Reviewer credentials are missing.", "reviewer")
      };
    }

    try {
      const response = normalizeReviewResponse(await this.generateReview(input));
      const verdict = response.verdict ?? "request_changes";
      const status = verdict === "accept" ? "ok" : "blocked";
      const data: ReviewerReportData = {
        verdict,
        evidence: input.evidence ?? [],
        readOnly: true,
        provider: "openai",
        model: this.config.model,
        reasons: response.reasons ?? []
      };

      return {
        role: "reviewer",
        status,
        subtaskId: input.subtask.id,
        summary: response.summary ?? summaryForVerdict(verdict, input.subtask.title),
        contextDelta: createContextDeltaItem(
          status === "ok" ? "fact" : "blocked",
          `OpenAI reviewer verdict for ${input.subtask.id}: ${verdict}.`,
          "reviewer"
        ),
        data
      };
    } catch (error) {
      return {
        role: "reviewer",
        status: "blocked",
        subtaskId: input.subtask.id,
        summary: `OpenAI reviewer failed: ${error instanceof Error ? error.message : String(error)}`,
        contextDelta: createContextDeltaItem("blocked", `OpenAI reviewer failed for ${input.subtask.id}.`, "reviewer")
      };
    }
  }

  async checkConnection(): Promise<{ ok: boolean; summary: string }> {
    if (!this.config.apiKey?.trim()) {
      return {
        ok: false,
        summary: "OpenAI API key is not configured."
      };
    }

    try {
      await this.generateText("Return only this JSON object: {\"verdict\":\"accept\",\"summary\":\"ok\",\"reasons\":[]}");
      return {
        ok: true,
        summary: `OpenAI model ${this.config.model} responded successfully.`
      };
    } catch (error) {
      return {
        ok: false,
        summary: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async generateReview(input: ReviewerProviderInput): Promise<unknown> {
    const text = await this.generateText(reviewPrompt(input));
    return parseJsonText(text);
  }

  private async generateText(prompt: string): Promise<string> {
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    const response = await this.fetchImpl(`${endpoint}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey ?? ""}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model,
        input: prompt
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OpenAI API returned ${response.status}${text ? `: ${truncate(text, 500)}` : ""}`);
    }

    return extractResponseText((await response.json()) as unknown);
  }
}

function reviewPrompt(input: ReviewerProviderInput): string {
  return [
    "You are the Reviewer in a role-split task orchestrator.",
    "Review the executor result using only the supplied task, subtask, executor report, and local evidence.",
    "Return only JSON with this shape:",
    '{"verdict":"accept|request_changes|reschedule|owner_decision","summary":"short review summary","reasons":["specific reason"]}',
    "",
    "Rules:",
    "- Use accept only when the executor succeeded and evidence supports the acceptance criteria.",
    "- Use request_changes when the executor failed, evidence is missing, or the diff/test evidence is insufficient.",
    "- Do not mutate files or propose shell commands.",
    "",
    `Task: ${input.spec.title}`,
    input.spec.description ? `Task description:\n${input.spec.description}` : "Task description: none",
    `Acceptance criteria:\n${input.spec.acceptanceCriteria.map((item) => `- ${item}`).join("\n") || "- none"}`,
    `Subtask: ${input.subtask.title}`,
    input.subtask.description ? `Subtask description:\n${input.subtask.description}` : "Subtask description: none",
    `Executor status: ${input.executorReport.status}`,
    `Executor summary: ${input.executorReport.summary}`,
    `Evidence:\n${(input.evidence ?? []).map(formatEvidence).join("\n") || "- none"}`
  ].join("\n");
}

function formatEvidence(item: ReviewEvidence): string {
  return `- ${item.kind}: ${item.summary}`;
}

function normalizeReviewResponse(value: unknown): OpenAIReviewResponse {
  if (!isRecord(value)) {
    throw new Error("OpenAI reviewer response was not a JSON object.");
  }

  return {
    verdict: isReviewVerdict(value.verdict) ? value.verdict : undefined,
    summary: typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : undefined,
    reasons: Array.isArray(value.reasons)
      ? value.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
      : []
  };
}

function summaryForVerdict(verdict: ReviewVerdict, subtaskTitle: string): string {
  return verdict === "accept" ? `Accepted ${subtaskTitle} with OpenAI review.` : `OpenAI reviewer requested changes for ${subtaskTitle}.`;
}

function extractResponseText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (isRecord(payload) && Array.isArray(payload.output)) {
    const text = payload.output
      .filter(isRecord)
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter(isRecord)
      .map((item) => (typeof item.text === "string" ? item.text : ""))
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }

  throw new Error("OpenAI response did not include text content.");
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("OpenAI reviewer response was not valid JSON.");
  }
}

function isReviewVerdict(value: unknown): value is ReviewVerdict {
  return value === "accept" || value === "request_changes" || value === "reschedule" || value === "owner_decision";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

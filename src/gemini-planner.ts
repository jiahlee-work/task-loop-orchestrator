import type { GeminiConfig } from "./config.js";
import { createContextDeltaItem } from "./context.js";
import type { Context, Graph, ProposedSubtask, RoleReport, TaskSpec } from "./domain.js";
import { createId, nowIso } from "./ids.js";
import type { PlannerProvider } from "./roles.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GeminiPlannerOptions {
  config: GeminiConfig;
  fetchImpl?: FetchLike;
}

interface GeminiPlannerResponse {
  summary?: string;
  rootContract?: {
    goal?: string;
    nonGoals?: string[];
    mustFollow?: string[];
    acceptanceCriteria?: string[];
    contextGuard?: string[];
    repoConstraints?: string[];
    userDecisions?: string[];
  };
  taskTree?: {
    tasks?: Array<{
      title?: string;
      description?: string;
      dependsOn?: string[];
    }>;
  };
  subtasks?: Array<{
    title?: string;
    description?: string;
    dependsOn?: string[];
  }>;
}

export class GeminiPlanner implements PlannerProvider {
  private readonly config: GeminiConfig;
  private readonly fetchImpl: FetchLike;

  constructor(options: GeminiPlannerOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async plan(input: { spec: TaskSpec; context: Context; graph: Graph }): Promise<RoleReport> {
    if (input.graph.subtasks.length > 0) {
      return {
        role: "planner",
        status: "ok",
        summary: "Existing graph already has planned subtasks."
      };
    }

    if (!this.config.apiKey?.trim()) {
      return {
        role: "planner",
        status: "failed",
        summary: "Gemini planner is not configured. Run tlo setup gemini, then tlo doctor gemini."
      };
    }

    try {
      const plannerResponse = await this.generatePlan(input);
      const proposedSubtasks = createProposedSubtasks(plannerResponse, input.spec);
      const rootContract = createPlannerRootContract(plannerResponse, input.spec);
      const taskTree = createPlannerTaskTree(plannerResponse, proposedSubtasks);
      return {
        role: "planner",
        status: "ok",
        summary: plannerResponse.summary ?? `Gemini planned ${proposedSubtasks.length} bounded subtask(s).`,
        contextDelta: createContextDeltaItem(
          "decision",
          `Gemini planner generated a root contract and ${proposedSubtasks.length} task tree item(s) from the task input.`,
          "planner"
        ),
        proposedSubtasks,
        data: {
          provider: "gemini",
          model: this.config.model,
          rootContract,
          taskTree
        }
      };
    } catch (error) {
      return {
        role: "planner",
        status: "failed",
        summary: `Gemini planner failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async checkConnection(): Promise<{ ok: boolean; summary: string }> {
    if (!this.config.apiKey?.trim()) {
      return {
        ok: false,
        summary: "Gemini API key is not configured."
      };
    }

    try {
      await this.generateJson({
        contents: [
          {
            role: "user",
            parts: [{ text: 'Return only this JSON object: {"ok":true}' }]
          }
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json"
        }
      });
      return {
        ok: true,
        summary: `Gemini model ${this.config.model} responded successfully.`
      };
    } catch (error) {
      return {
        ok: false,
        summary: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async generatePlan(input: { spec: TaskSpec; context: Context; graph: Graph }): Promise<GeminiPlannerResponse> {
    const response = await this.generateJson({
      contents: [
        {
          role: "user",
          parts: [{ text: plannerPrompt(input.spec, input.context, input.graph) }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    });

    return normalizePlannerResponse(response);
  }

  private async generateJson(body: Record<string, unknown>): Promise<unknown> {
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    const response = await this.fetchImpl(`${endpoint}/v1beta/models/${encodeURIComponent(this.config.model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.config.apiKey ?? ""
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gemini API returned ${response.status}${text ? `: ${truncate(text, 500)}` : ""}`);
    }

    const payload = (await response.json()) as unknown;
    const text = extractGeminiText(payload);
    return parseJsonText(text);
  }
}

function plannerPrompt(spec: TaskSpec, context: Context, graph: Graph): string {
  return [
    "You are the Planner in a local task-loop orchestrator.",
    "Create a root contract and task tree from the task input.",
    "Return only JSON with this shape:",
    JSON.stringify({
      summary: "short summary",
      rootContract: {
        goal: "approved high-level goal",
        nonGoals: ["what must stay out of scope"],
        mustFollow: ["important instructions that every executor branch must preserve"],
        acceptanceCriteria: ["observable completion criteria"],
        contextGuard: ["checks root must apply to detect context drift"],
        repoConstraints: ["repository or safety constraints"],
        userDecisions: ["explicit decisions from the user or issue"]
      },
      taskTree: {
        tasks: [
          {
            title: "short action title",
            description: "specific bounded work",
            dependsOn: []
          }
        ]
      }
    }),
    "",
    "Rules:",
    "- Return 1 to 5 taskTree.tasks.",
    "- Keep each task concrete and independently reviewable.",
    "- Root contract must preserve the user's goal, notes, acceptance criteria, and safety constraints.",
    "- contextGuard must say how root should detect that an executor branch drifted from the approved contract.",
    "- Do not include shell commands, branch names, commits, pushes, PR creation, releases, or Jira transitions.",
    "- Preserve all acceptance criteria and user notes.",
    "- Use dependsOn as an array of earlier subtask titles only when needed.",
    "",
    `Task ID: ${spec.id}`,
    `Task title: ${spec.title}`,
    spec.description ? `Task description:\n${spec.description}` : "Task description: none",
    `Acceptance criteria:\n${spec.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
    `Current context:\n${context.items.map((item) => `- ${item.kind}: ${item.text}`).join("\n") || "- none"}`,
    `Existing subtasks: ${graph.subtasks.length}`
  ].join("\n");
}

function normalizePlannerResponse(value: unknown): GeminiPlannerResponse {
  if (!isRecord(value)) {
    throw new Error("Gemini response was not a JSON object.");
  }

  const summary = typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : undefined;
  const rootContract = normalizeRootContract(value.rootContract);
  const taskTreeTasks = isRecord(value.taskTree) && Array.isArray(value.taskTree.tasks)
    ? value.taskTree.tasks.filter(isRecord).map(normalizePlannerTask)
    : undefined;
  const subtasks = Array.isArray(value.subtasks)
    ? value.subtasks.filter(isRecord).map((item) => ({
        title: typeof item.title === "string" ? item.title.trim() : undefined,
        description: typeof item.description === "string" ? item.description.trim() : undefined,
        dependsOn: Array.isArray(item.dependsOn)
          ? item.dependsOn.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
          : []
      }))
    : [];

  return {
    summary,
    rootContract,
    taskTree: taskTreeTasks ? { tasks: taskTreeTasks } : undefined,
    subtasks
  };
}

function createProposedSubtasks(response: GeminiPlannerResponse, spec: TaskSpec): ProposedSubtask[] {
  const sourceTasks = response.taskTree?.tasks?.length ? response.taskTree.tasks : response.subtasks;
  const usable = (sourceTasks ?? []).filter((subtask) => subtask.title && subtask.title.length > 0).slice(0, 5);
  const subtasks = usable.length > 0 ? usable : [{ title: spec.title, description: spec.description, dependsOn: [] }];
  const titleToId = new Map<string, string>();
  const now = nowIso();

  for (const subtask of subtasks) {
    titleToId.set(subtask.title ?? "", createId("subtask"));
  }

  return subtasks.map((subtask) => ({
    id: titleToId.get(subtask.title ?? "") ?? createId("subtask"),
    title: subtask.title ?? spec.title,
    description: subtask.description || spec.description,
    dependsOn: (subtask.dependsOn ?? []).map((title) => titleToId.get(title)).filter((id): id is string => Boolean(id)),
    assignedRole: "executor",
    createdAt: now,
    updatedAt: now
  }));
}

function createPlannerRootContract(response: GeminiPlannerResponse, spec: TaskSpec): Record<string, unknown> {
  const contract = response.rootContract ?? {};

  return {
    goal: contract.goal?.trim() || spec.title,
    description: spec.description,
    nonGoals: contract.nonGoals ?? [],
    mustFollow: uniqueStrings([...(contract.mustFollow ?? []), ...spec.acceptanceCriteria]),
    acceptanceCriteria: (contract.acceptanceCriteria?.length ? contract.acceptanceCriteria : spec.acceptanceCriteria),
    contextGuard: contract.contextGuard ?? [],
    repoConstraints: contract.repoConstraints ?? [],
    userDecisions: contract.userDecisions ?? []
  };
}

function createPlannerTaskTree(response: GeminiPlannerResponse, proposedSubtasks: ProposedSubtask[]): Record<string, unknown> {
  const sourceTasks = response.taskTree?.tasks?.length ? response.taskTree.tasks : response.subtasks;
  const tasks = proposedSubtasks.map((subtask, index) => {
    const source = sourceTasks?.[index];

    return {
      id: subtask.id,
      title: subtask.title,
      description: subtask.description,
      dependsOn: [...subtask.dependsOn],
      sourceDependsOn: source?.dependsOn ?? []
    };
  });

  return { tasks };
}

function normalizeRootContract(value: unknown): GeminiPlannerResponse["rootContract"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    goal: typeof value.goal === "string" ? value.goal.trim() : undefined,
    nonGoals: stringArray(value.nonGoals),
    mustFollow: stringArray(value.mustFollow),
    acceptanceCriteria: stringArray(value.acceptanceCriteria),
    contextGuard: stringArray(value.contextGuard),
    repoConstraints: stringArray(value.repoConstraints),
    userDecisions: stringArray(value.userDecisions)
  };
}

function normalizePlannerTask(item: Record<string, unknown>): NonNullable<NonNullable<GeminiPlannerResponse["taskTree"]>["tasks"]>[number] {
  return {
    title: typeof item.title === "string" ? item.title.trim() : undefined,
    description: typeof item.description === "string" ? item.description.trim() : undefined,
    dependsOn: Array.isArray(item.dependsOn)
      ? item.dependsOn.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
      : []
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0).map((item) => item.trim())
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    throw new Error("Gemini response did not include candidates.");
  }

  const first = payload.candidates.find(isRecord);
  const content = isRecord(first?.content) ? first.content : undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = parts
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini response did not include text content.");
  }

  return text;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("Gemini response was not valid JSON.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

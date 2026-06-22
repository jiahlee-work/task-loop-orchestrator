import type { Context, ContextDelta, ContextItem, RoleName, TaskSpec } from "./domain.js";
import { createId, nowIso } from "./ids.js";

export function createContext(runId: string, task: TaskSpec): Context {
  return {
    runId,
    task,
    items: [
      {
        id: createId("ctx"),
        kind: "fact",
        text: `Task accepted: ${task.title}`,
        source: "root",
        createdAt: nowIso()
      }
    ]
  };
}

export function appendContextDelta(context: Context, delta: ContextDelta | undefined): Context {
  if (!delta || delta.items.length === 0) {
    return context;
  }

  const items: ContextItem[] = delta.items.map((item) => ({
    ...item,
    id: createId("ctx"),
    createdAt: nowIso()
  }));

  return {
    ...context,
    items: [...context.items, ...items]
  };
}

export function createContextDeltaItem(kind: ContextItem["kind"], text: string, source: RoleName): ContextDelta {
  return {
    items: [
      {
        kind,
        text,
        source
      }
    ]
  };
}

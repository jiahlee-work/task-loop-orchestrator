import type { LoopEvent, LoopEventKind, LoopRun } from "./domain.js";
import { createId, nowIso } from "./ids.js";

export type NewLoopEvent = Omit<LoopEvent, "id" | "createdAt"> & Partial<Pick<LoopEvent, "id" | "createdAt">>;

export function createLoopEvent(input: NewLoopEvent): LoopEvent {
  return {
    ...input,
    id: input.id ?? createId("event"),
    createdAt: input.createdAt ?? nowIso()
  };
}

export function appendEvent(run: LoopRun, event: NewLoopEvent): LoopRun {
  return {
    ...run,
    events: [...run.events, createLoopEvent(event)],
    updatedAt: nowIso()
  };
}

export function appendStatusEvent(run: LoopRun, kind: LoopEventKind, message: string): LoopRun {
  return appendEvent(run, {
    kind,
    message,
    role: "root",
    data: {
      status: run.status
    }
  });
}

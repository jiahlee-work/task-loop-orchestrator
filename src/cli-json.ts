import { nowIso } from "./ids.js";

export const cliJsonSchemaVersion = 1;

export const cliJsonCommands = [
  "init",
  "doctor",
  "run",
  "resume",
  "status",
  "checkpoint",
  "checks",
  "pr-plan",
  "pr-exec",
  "approve-pr"
] as const;

export type CliJsonCommand = (typeof cliJsonCommands)[number];

export type CliJsonReport<T extends object> = T & {
  schemaVersion: typeof cliJsonSchemaVersion;
  command: CliJsonCommand;
  createdAt: string;
};

export function createCliJsonReport<T extends object>(
  command: CliJsonCommand,
  payload: T,
  createdAt: string = nowIso()
): CliJsonReport<T> {
  return {
    ...payload,
    schemaVersion: cliJsonSchemaVersion,
    command,
    createdAt: payloadHasCreatedAt(payload) ? (payload as { createdAt: string }).createdAt : createdAt
  };
}

function payloadHasCreatedAt(payload: object): payload is { createdAt: string } {
  return "createdAt" in payload && typeof (payload as { createdAt?: unknown }).createdAt === "string";
}

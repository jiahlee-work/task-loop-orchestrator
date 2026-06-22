import { nowIso } from "./ids.js";

export const cliJsonSchemaVersion = 1;

export type CliJsonCommand = "init" | "doctor" | "run" | "resume" | "status";

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
    createdAt
  };
}

import type { ActionType, LoopRun, PermissionMode } from "./domain.js";
import { appendEvent } from "./audit.js";
import { nowIso } from "./ids.js";

const readActions = new Set<ActionType>(["read_state"]);

const writeActions = new Set<ActionType>([
  "read_state",
  "create_branch",
  "write_file",
  "run_tests",
  "commit",
  "create_pr"
]);

const maintainerActions = new Set<ActionType>([
  ...writeActions,
  "push",
  "merge_pr",
  "jira_transition",
  "release"
]);

export interface PermissionDecision {
  allowed: boolean;
  mode: PermissionMode;
  action: ActionType;
  reason: string;
}

export function checkPermission(mode: PermissionMode, action: ActionType): PermissionDecision {
  if (mode === "read") {
    return {
      allowed: readActions.has(action),
      mode,
      action,
      reason: readActions.has(action) ? "read mode allows state inspection." : "read mode only allows read_state."
    };
  }

  if (mode === "write") {
    return {
      allowed: writeActions.has(action),
      mode,
      action,
      reason: writeActions.has(action)
        ? "write mode allows bounded local implementation and PR preparation actions."
        : "write mode does not allow push, merge, Jira transition, or release actions."
    };
  }

  return {
    allowed: maintainerActions.has(action),
    mode,
    action,
    reason: maintainerActions.has(action)
      ? "maintainer mode can prepare privileged actions; merge, Jira transition, and release remain decision-ready and are not auto-executed."
      : `Unknown action ${action}.`
  };
}

export function applyPermissionGate(run: LoopRun, action: ActionType): { run: LoopRun; decision: PermissionDecision } {
  const decision = checkPermission(run.permissionMode, action);
  if (decision.allowed) {
    return { run, decision };
  }

  const blockedRun = appendEvent(
    {
      ...run,
      status: "blocked",
      updatedAt: nowIso()
    },
    {
      kind: "permission_denied",
      message: `Permission denied for ${action}: ${decision.reason}`,
      role: "root",
      action,
      data: {
        mode: decision.mode,
        reason: decision.reason
      }
    }
  );

  return {
    run: appendEvent(blockedRun, {
      kind: "run_blocked",
      message: `Run blocked by permission gate for ${action}.`,
      role: "root",
      action
    }),
    decision
  };
}

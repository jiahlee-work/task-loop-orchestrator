import type { LoopRun } from "./domain.js";
import { createRootContractArtifact, createTaskTreeArtifact } from "./run-state.js";

export function formatPlanPreview(run: LoopRun): string {
  const contract = createRootContractArtifact(run);
  const taskTree = createTaskTreeArtifact(run);
  const lines = [
    "",
    "Plan approval",
    "",
    "Root contract:",
    `- Goal: ${contract.goal}`,
    ...optionalList("Non-goals", contract.nonGoals),
    ...optionalList("Must follow", contract.mustFollow),
    ...optionalList("Acceptance criteria", contract.acceptanceCriteria),
    ...optionalList("Context guard", contract.contextGuard),
    ...optionalList("Repo constraints", contract.repoConstraints),
    ...optionalList("User decisions", contract.userDecisions),
    "",
    "Task tree:"
  ];

  if (taskTree.tasks.length === 0) {
    lines.push("- No tasks were proposed.");
  } else {
    for (const [index, task] of taskTree.tasks.entries()) {
      const dependencies = task.dependsOn.length > 0 ? ` depends on ${task.dependsOn.join(", ")}` : "";
      lines.push(`${index + 1}. [${task.status}] ${task.title}${dependencies}`);
      if (task.description) {
        lines.push(`   ${task.description}`);
      }
    }
  }

  lines.push("");
  lines.push("Decision:");
  lines.push("- y: approve this plan and start execution");
  lines.push("- n: enter a revision request, or leave it blank to stop");
  lines.push("");

  return lines.join("\n");
}

function optionalList(label: string, values: string[]): string[] {
  if (values.length === 0) {
    return [];
  }

  return [`- ${label}:`, ...values.map((value) => `  - ${value}`)];
}

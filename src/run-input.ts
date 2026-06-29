export interface RunInput {
  kind: "direct" | "jira";
  title?: string;
  jiraKey?: string;
  note?: string;
}

export interface RunInputParseArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

const jiraIssueKeyPattern = /^[A-Z][A-Z0-9]+-\d+$/;

export function parseRunInput(args: RunInputParseArgs): RunInput {
  const explicitJiraKey = stringFlag(args.flags, "jira");
  const note = trimmedStringFlag(args.flags, "note");

  if (explicitJiraKey) {
    const jiraKey = explicitJiraKey.trim();
    if (!isJiraIssueKey(jiraKey)) {
      throw new Error(`Invalid Jira issue key: ${explicitJiraKey}. Example: tlo run OUC-10`);
    }
    if (args.positional.length > 0) {
      throw new Error(
        [
          "run received both --jira and positional input.",
          "Use one of these forms:",
          "- tlo run OUC-10",
          '- tlo run OUC-10 --note "additional context"',
          '- tlo run "direct task instruction"'
        ].join("\n")
      );
    }

    return {
      kind: "jira",
      jiraKey,
      note
    };
  }

  const [first, ...rest] = args.positional;
  if (isJiraIssueKey(first)) {
    if (rest.length > 0) {
      throw new Error(
        [
          "run no longer accepts inline Jira notes after the issue key.",
          'Use --note for Jira context: tlo run OUC-10 --note "additional context"',
          'Use quotes for a direct task that starts with an issue-like token: tlo run "OUC-10 refactor the sidebar"'
        ].join("\n")
      );
    }

    return {
      kind: "jira",
      jiraKey: first,
      note
    };
  }

  if (note) {
    throw new Error(
      [
        "--note is only for Jira issue runs.",
        'For a direct task, include the extra context in the task text: tlo run "direct task instruction with context"'
      ].join("\n")
    );
  }

  return {
    kind: "direct",
    title: args.positional.join(" ").trim()
  };
}

export function isJiraIssueKey(value: string | undefined): boolean {
  return typeof value === "string" && jiraIssueKeyPattern.test(value);
}

function stringFlag(flags: RunInputParseArgs["flags"], key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function trimmedStringFlag(flags: RunInputParseArgs["flags"], key: string): string | undefined {
  const value = stringFlag(flags, key)?.trim();
  return value ? value : undefined;
}

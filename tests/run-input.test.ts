import { describe, expect, it } from "vitest";
import { isJiraIssueKey, parseRunInput } from "../src/run-input.js";

describe("run input parsing", () => {
  it("parses a Jira issue key", () => {
    expect(parseRunInput({ positional: ["OUC-10"], flags: {} })).toEqual({
      kind: "jira",
      jiraKey: "OUC-10",
      note: undefined
    });
  });

  it("parses a Jira issue key with an explicit note", () => {
    expect(parseRunInput({ positional: ["OUC-10"], flags: { note: "Keep the existing UI." } })).toEqual({
      kind: "jira",
      jiraKey: "OUC-10",
      note: "Keep the existing UI."
    });
  });

  it("parses a direct task instruction", () => {
    expect(parseRunInput({ positional: ["채팅 Sidebar 구조를 리팩터링해줘"], flags: {} })).toEqual({
      kind: "direct",
      title: "채팅 Sidebar 구조를 리팩터링해줘"
    });
  });

  it("keeps quoted issue-like direct tasks as direct input", () => {
    expect(parseRunInput({ positional: ["OUC-10 refactor the sidebar"], flags: {} })).toEqual({
      kind: "direct",
      title: "OUC-10 refactor the sidebar"
    });
  });

  it("supports the explicit --jira option without positional input", () => {
    expect(parseRunInput({ positional: [], flags: { jira: "OUC-10", note: "Use existing layout." } })).toEqual({
      kind: "jira",
      jiraKey: "OUC-10",
      note: "Use existing layout."
    });
  });

  it("rejects inline Jira notes and the old with syntax", () => {
    expect(() => parseRunInput({ positional: ["OUC-10", "with", "extra context"], flags: {} })).toThrow(
      "run no longer accepts inline Jira notes"
    );
    expect(() => parseRunInput({ positional: ["OUC-10", "extra context"], flags: {} })).toThrow(
      "Use --note for Jira context"
    );
  });

  it("rejects --note for direct task input", () => {
    expect(() => parseRunInput({ positional: ["Refactor the sidebar"], flags: { note: "Extra context." } })).toThrow(
      "--note is only for Jira issue runs"
    );
  });

  it("rejects invalid explicit Jira keys", () => {
    expect(() => parseRunInput({ positional: [], flags: { jira: "ouc-10" } })).toThrow("Invalid Jira issue key");
  });

  it("classifies Jira issue keys strictly", () => {
    expect(isJiraIssueKey("OUC-10")).toBe(true);
    expect(isJiraIssueKey("ABC123-456")).toBe(true);
    expect(isJiraIssueKey("ouc-10")).toBe(false);
    expect(isJiraIssueKey("OUC-10 extra")).toBe(false);
  });
});

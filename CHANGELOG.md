# Changelog

## 0.1.0 - Unreleased

Initial MVP for a local AI role-split closed-loop task orchestrator CLI.

### Added

- Root orchestrator loop scaffold with `run`, `resume`, and `status` commands.
- File-backed run, checkpoint, and approval storage under `.orchestrator/`.
- Project bootstrap and diagnostics with `init`, `doctor`, and `--version`.
- Read-only integration checkpoints and GitHub check summaries through `checkpoint` and `checks`.
- Decision-ready PR workflow with `pr-plan`, `approve-pr`, and dry-run `pr-exec` preflight.
- Permission gate, event/audit trail, provider interfaces, mock executor/reviewer, Codex CLI dry-run adapter, and local evidence reviewer.
- Stable CLI JSON envelope with schema metadata, command-specific schema branches, docs, sample smoke fixtures, and drift tests.
- Installable package contract with `bin`, Node 24 requirement, `npm pack` artifact allowlist, and installed binary package smoke.

### Not Included

- npm publish, GitHub release, or tag creation.
- GitHub write actions such as PR creation, PR mutation, merge, release, issue transition, branch creation, commit, or push.
- Jira/GitHub network write integrations.

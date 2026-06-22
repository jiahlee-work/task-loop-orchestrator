# Post-0.1.0 Roadmap

This is a candidate backlog for work after the `0.1.0 - Unreleased` candidate. It is not a committed schedule, not a release promise, and not approval to publish, tag, create GitHub releases, or execute write-side GitHub actions.

## Guiding Boundaries

- Keep write-side actions approval-gated and auditable.
- Prefer read-only provider expansion before write execution.
- Preserve local-first behavior and graceful fallback when external tools are missing.
- Keep CLI JSON contracts versioned, documented, and covered by smoke/drift tests.

## Candidate Backlog

### P0: Approval-Gated Write Execution Model

- Why: PR execution currently stops at decision-ready preflight. A real write runner needs stronger approval state, command replay protection, and explicit operator intent.
- Safety boundary: branch creation, commit, push, `gh pr create`, merge, release, and Jira transitions must remain blocked until an audited command runner and tests exist.
- First useful slice: persist execution intents and require an approval id plus a fresh checkpoint before any command runner can be considered.

### P0: Codex CLI Executor Hardening

- Why: `codex-cli-dry-run` already builds bounded executor commands, but real execution needs timeout controls, workspace isolation, report parsing, and failure recovery.
- Safety boundary: keep real Codex CLI execution opt-in and disabled by default; no long-running execution in smoke tests.
- First useful slice: add structured report parsing fixtures for dry-run command output before enabling any real invocation path.

### P1: Reviewer And Evidence Expansion

- Why: `local-evidence` is conservative and useful, but richer verification should reason about test results, diffs, acceptance criteria, and owner-decision items more explicitly.
- Safety boundary: reviewer adapters remain read-only and must return verdict/report data rather than mutating context or graph directly.
- First useful slice: add collected test command evidence and explicit acceptance-criteria coverage fields to reviewer reports.

### P1: Multi-Run Context And Graph UX

- Why: runs, checkpoints, and approvals are persisted, but users need better views across related runs and blocked decisions.
- Safety boundary: new UX should read local state first and avoid external writes.
- First useful slice: add a read-only run list/history command with JSON output and latest blocked/owner-decision summaries.

### P1: Persistent Audit And Report Export

- Why: the event trail, checkpoints, approvals, and JSON reports are useful for reviews, but need an exportable audit bundle for handoff.
- Safety boundary: export should be read-only and local-file based unless a separate upload/publish approval model exists.
- First useful slice: add an `export` or `report` command that writes a local summary artifact from existing `.orchestrator/` state.

### P2: GitHub Provider Expansion

- Why: read-only GitHub checks are useful; additional repository, PR, and review metadata can improve checkpoint and PR planning.
- Safety boundary: expand read-only APIs first. PR creation, mutation, merge, release, and issue operations remain out of scope until the approval-gated write model is implemented.
- First useful slice: enrich checkpoint reports with read-only PR list context when a matching branch or ref exists.

### P2: Jira Provider Skeleton To Read-Only Adapter

- Why: Jira status can inform owner-decision items and external workflow state, but write transitions are high-risk.
- Safety boundary: start with read-only issue lookup and status summaries. Jira transitions remain decision-ready candidates only.
- First useful slice: define a mockable Jira read provider and include optional read-only issue status evidence in checkpoints.

### P2: Packaging And Publish Workflow

- Why: 0.1.0 is installable from a local tarball, but actual npm publishing needs separate approval, provenance decisions, and release automation policy.
- Safety boundary: no `npm publish`, git tag, or GitHub release without explicit human approval and a documented release procedure.
- First useful slice: draft a publish runbook that remains disabled until approved.

## Documentation And Test Maintenance

- Keep [`quickstart.md`](quickstart.md), [`commands.md`](commands.md), [`json-output.md`](json-output.md), [`release-checklist.md`](release-checklist.md), and [`release-readiness.md`](release-readiness.md) aligned as the CLI surface changes.
- Keep package smoke, schema sample smoke, and docs drift tests focused on stable contracts rather than long prose.

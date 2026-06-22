# 0.1.0 Release Checklist

This is a pre-release checklist only. Do not publish to npm, create a GitHub release, or create a git tag from this checklist.

## Local Verification

- Confirm Node.js 24+ is active.
- Run `pnpm install --frozen-lockfile`.
- Run `pnpm run release:check` for the local pre-release verification bundle, including package artifact dry-run review.
- Run `pnpm run typecheck`.
- Run `pnpm test`.
- Run `pnpm run build`.
- Run `pnpm run lint`.
- Run `pnpm run package:smoke`.
- Run `node dist/cli.js --version` and confirm it matches `package.json`.
- Run `node dist/cli.js checks HEAD --json` and confirm the latest `verify` check is successful or pending for the current pushed commit.

## Package Artifact Review

- Confirm `package.json` name and version are correct.
- Confirm `package.json` `bin.task-loop-orchestrator` points to `dist/cli.js`.
- Confirm the package `files` allowlist is limited to `dist`, `schemas`, and `orchestrator.config.example.json`.
- Run `pnpm run package:artifacts` directly when you want to review the local `npm pack --dry-run --json` artifact listing without the full release check.
- Install the packed tarball into a temporary project and run `task-loop-orchestrator --help` and `task-loop-orchestrator --version`.

## Manual Safety Review

- Confirm GitHub Actions `verify` is successful on `main`.
- Confirm package smoke output reports installed binary JSON flows.
- Confirm `pr-exec --execute` still blocks before branch, commit, push, or PR creation.
- Confirm docs state that PR, merge, push, release, and publish actions are not executed by the current release candidate.

## Explicitly Out Of Scope

- `pnpm run release:check` is verification only and must not publish, tag, create releases, or perform write-side GitHub actions.
- `pnpm run package:artifacts` is dry-run review only and must not publish, tag, create releases, or perform write-side GitHub actions.
- Do not run `npm publish`.
- Do not create a GitHub release.
- Do not create or push a release tag.
- Do not create, mutate, merge, or close GitHub PRs or issues as part of this checklist.

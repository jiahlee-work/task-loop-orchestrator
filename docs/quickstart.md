# Local Install Quickstart

This CLI is not published to npm yet. Use a local checkout or a locally packed tarball.

The current release candidate does not create GitHub PRs, merge, push, publish, create tags, or create GitHub releases. PR-related commands produce decision-ready plans, approvals, and dry-run preflight reports only.

For command-by-command usage, see [commands.md](commands.md).

## Requirements

- Node.js 24 or newer
- pnpm through Corepack or a compatible pnpm 11.x install
- Git for project evidence and status commands
- Optional: `gh` authenticated to a GitHub repository when using `checks HEAD --json` or `--github gh-cli`

## From A Repository Clone

```bash
git clone https://github.com/jiahlee-work/task-loop-orchestrator.git
cd task-loop-orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm run build
node dist/cli.js --help
node dist/cli.js --version
```

Run the CLI directly from the checkout:

```bash
node dist/cli.js doctor --json
node dist/cli.js init --json
node dist/cli.js run "Quickstart smoke" --max-iterations 1 --json
node dist/cli.js status --json
node dist/cli.js resume run_xxx --max-iterations 1 --json
node dist/cli.js checks HEAD --json
```

`checks HEAD --json` is only meaningful in a repository with a GitHub remote and readable check-runs. Missing `gh`, missing auth, or no check-runs are reported as a graceful JSON status.

## From A Local Tarball

Build and pack from the repository checkout:

```bash
pnpm run build
npm pack --pack-destination /tmp
```

Install the packed tarball into a target project:

```bash
cd /path/to/your/git-project
npm install /tmp/task-loop-orchestrator-0.1.0.tgz
npx task-loop-orchestrator --help
npx task-loop-orchestrator --version
```

If you do not want to add the package to a project, install into a temporary prefix and call the installed binary directly:

```bash
tmpdir="$(mktemp -d)"
npm install --prefix "$tmpdir" /tmp/task-loop-orchestrator-0.1.0.tgz
"$tmpdir/node_modules/.bin/task-loop-orchestrator" --help
"$tmpdir/node_modules/.bin/task-loop-orchestrator" --version
```

## First Project Flow

Run these commands from the Git project where you want local orchestrator state. Use `npx` for a project-local tarball install, or omit `npx` when `task-loop-orchestrator` is already on your `PATH`.

```bash
npx task-loop-orchestrator doctor --json
npx task-loop-orchestrator init --json
npx task-loop-orchestrator run "Quickstart smoke" --max-iterations 1 --json
npx task-loop-orchestrator status --json
npx task-loop-orchestrator resume run_xxx --max-iterations 1 --json
```

`init` creates or updates only local bootstrap files:

- `orchestrator.config.json`
- `.gitignore`, adding `.orchestrator/` when missing

It does not overwrite an existing `orchestrator.config.json` unless `--force` is provided.

Run a read-only GitHub check refresh when the project has a GitHub remote and readable check-runs:

```bash
npx task-loop-orchestrator checks HEAD --json
```

Run a checkpoint brief after at least one run:

```bash
npx task-loop-orchestrator checkpoint --json
npx task-loop-orchestrator checkpoint --github gh-cli --json
```

The `--github gh-cli` form uses read-only GitHub CLI calls and falls back to an `unknown` or `not_found` check summary when GitHub data is unavailable.

## Advanced Read-Only Audit And Dry-Run Surfaces

This section is not required for the first install, `run`, `status`, and `resume` flow.

When a project already has persisted execution intent records under `.orchestrator/execution-intents/`, inspect them without enabling write execution:

```bash
npx task-loop-orchestrator execution-audit --all
npx task-loop-orchestrator execution-audit --all --json
npx task-loop-orchestrator execution-audit --intent intent_xxx
npx task-loop-orchestrator execution-audit --intent intent_xxx --json
npx task-loop-orchestrator write-readiness --intent intent_xxx
npx task-loop-orchestrator write-readiness --intent intent_xxx --json
npx task-loop-orchestrator write-readiness --intent intent_xxx --preflight readiness-preflight.json
npx task-loop-orchestrator write-readiness --intent intent_xxx --preflight readiness-preflight.json --json
npx task-loop-orchestrator write-runner --intent intent_xxx --json
npx task-loop-orchestrator write-runner --intent intent_xxx --preflight readiness-preflight.json --json
npx task-loop-orchestrator write-runner --intent intent_xxx --preflight readiness-preflight.json --simulate --json
npx task-loop-orchestrator write-runner --intent intent_xxx --preflight readiness-preflight.json --execute --json
```

Plain output is for people reading terminal summaries. Use `--json` for automation, scripts, or UI integrations that need the stable JSON envelope.

`execution-audit` and `write-readiness` are read-only. They read persisted intent and trace records; `write-readiness --preflight <path>` also reads one local evidence JSON file. This surface does not write files, execute external commands, create branches, commit, push, create PRs, merge, publish, create tags, or create GitHub releases. Preflight input can change the readiness summary, but it does not unlock write execution.

`write-runner` is the audited dry-run and simulation boundary after readiness. It can write local dry-run trace records under `.orchestrator/execution-traces/` only when readiness is `ready`. `--simulate` returns symbolic safe executor results without shell, git, or GitHub execution. `--execute` currently returns an `execute_disabled` report. It still does not execute external commands, create branches, commit, push, create PRs, merge, publish, create tags, or create GitHub releases.

`pr-exec` remains a dry-run/preflight and approval-intent surface. Even with `--execute`, current write execution is blocked before branch creation, commit, push, or PR creation.

## Local Verification

Before handing off a tarball or preparing a release candidate, run:

```bash
pnpm run release:check
```

This includes typecheck, tests, build, package artifact dry-run review, lint, installed binary package smoke, version output, and read-only check refresh. It does not publish, tag, create releases, push, create PRs, or merge anything.

For just the package file listing review:

```bash
pnpm run package:artifacts
```

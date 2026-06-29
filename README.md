# task-loop-orchestrator

AI 작업을 역할별로 나누고, 계획부터 검증까지의 진행 상태를 로컬 파일에 남기는 CLI 오케스트레이터입니다.

현재 MVP는 대상 레포에서 Jira 이슈를 읽고 Gemini Planner로 작업을 나눈 뒤, 사용자가 계획을 승인하면 Codex CLI Executor가 대상 레포의 dev worktree에서 작업하고 OpenAI Reviewer가 결과를 검토하는 단계입니다. 커밋, 푸시, PR 생성은 아직 하지 않습니다.

## 요구 사항

- Node.js 24 이상
- Corepack으로 활성화한 pnpm 11.x, 또는 호환되는 pnpm 설치
- 작업시킬 대상 프로젝트는 Git 저장소여야 합니다. `tlo init`은 Git 저장소가 아닌 폴더에서도 현재 디렉터리에 초기화할 수 있지만, Codex 실행은 Git worktree를 만들기 때문에 Git 저장소 밖에서는 실패할 수 있습니다.

## 설치와 실행

아직 npm에 배포하지 않았습니다. 지금은 GitHub 저장소를 clone한 뒤 pnpm으로 빌드해서 사용합니다.

```bash
git clone https://github.com/jiahlee-work/task-loop-orchestrator.git
cd task-loop-orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm setup
source ~/.zshrc
pnpm add -g .
node dist/cli.js --help
node dist/cli.js --version
```

이후 다른 로컬 프로젝트에서는 `tlo` 명령으로 실행합니다.

```bash
cd /path/to/your-git-project
tlo --help
tlo doctor
```

## 첫 사용 흐름

대상 프로젝트에서 아래 순서로 실행합니다.

```bash
tlo init
tlo setup
tlo run OUC-10
```

`tlo run`은 필요한 provider 설정을 먼저 확인합니다. Gemini, Jira, OpenAI 설정이 빠져 있으면 run을 저장하지 않고 실패 이유와 다음에 실행할 명령을 안내합니다.

처음에는 `tlo setup`으로 Jira, Gemini, OpenAI를 한 번에 설정하는 흐름을 추천합니다. 특정 provider만 다시 설정할 때는 `tlo setup jira`, `tlo setup gemini`, `tlo setup openai`를 사용할 수 있습니다. 연결을 따로 확인하고 싶을 때는 `tlo doctor jira`, `tlo doctor gemini`, `tlo doctor openai`를 실행합니다. 설정이 끝난 프로젝트에서는 `tlo run OUC-10`만 바로 실행하면 됩니다.

## Gemini 계정 등록

Gemini Planner를 쓰려면 Google AI Studio에서 Gemini API key를 발급받아야 합니다.

1. Google 계정으로 [Google AI Studio API Keys](https://aistudio.google.com/app/apikey)에 접속합니다.
2. 처음 쓰는 계정이면 약관에 동의하고 API key를 만듭니다. 기존 Google Cloud 프로젝트를 쓰고 있다면 AI Studio에서 해당 프로젝트를 선택하거나 가져온 뒤 key를 만듭니다.
3. 대상 프로젝트에서 `tlo setup` 또는 `tlo setup gemini`를 실행하고 발급받은 API key를 붙여 넣습니다.
4. 등록이 끝나면 다시 `tlo run OUC-10`을 실행합니다.

Gemini key는 대상 프로젝트의 `.orchestrator/gemini.env`에 저장되며, 이 파일은 `.gitignore` 대상입니다.

## OpenAI Reviewer 등록

OpenAI Reviewer를 쓰려면 OpenAI API key를 발급받아야 합니다.

1. [OpenAI API keys](https://platform.openai.com/api-keys)에 접속해 API key를 만듭니다.
2. 대상 프로젝트에서 `tlo setup` 또는 `tlo setup openai`를 실행하고 발급받은 API key를 붙여 넣습니다.
3. 등록이 끝나면 `tlo doctor openai`로 연결을 확인할 수 있습니다.

OpenAI key는 대상 프로젝트의 `.orchestrator/openai.env`에 저장되며, 이 파일도 `.gitignore` 대상입니다.

## 실행 승인

`tlo run`은 Gemini가 만든 plan을 먼저 보여준 뒤 `Proceed with Codex execution? [y/N]`로 실행 승인을 받습니다. `n`을 입력하면 어떤 점을 수정할지 터미널에 적을 수 있고, 그 내용을 반영해 plan을 다시 만듭니다. `y`를 입력하면 Codex CLI가 대상 레포의 `.orchestrator/dev-workspaces/` 아래에 만든 run별 Git worktree에서 실행됩니다.

Jira 이슈에 설명을 덧붙이거나, Jira 없이 직접 작업 설명만 넘길 수도 있습니다.

```bash
tlo run OUC-10 --note "이번에는 UI 문구까지 같이 정리해줘"
tlo run "README의 설치 흐름을 현재 CLI 기준으로 정리해줘"
```

자동화나 스크립트에서 run id를 정확히 꺼내야 할 때만 `--json`을 붙이면 됩니다.

```bash
run_json="$(tlo run "Quickstart smoke" --max-iterations 1 --json)"
run_id="$(printf '%s' "$run_json" | node -e 'let input=""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => console.log(JSON.parse(input).runId));')"
tlo status "$run_id" --json
```

`run --json`이 반환한 `runId`를 `status <runId>`와 `resume <runId>`에 넘기는 것이 기본 패턴입니다. 실행 기록은 대상 프로젝트의 `.orchestrator/runs/<runId>.json`에 저장됩니다.

`init`은 다시 실행해도 기존 `orchestrator.config.json`을 덮어쓰지 않습니다. `.orchestrator/`가 `.gitignore`에 빠져 있으면 추가하고, 이미 있으면 그대로 둡니다. 설정이 이상해 보일 때는 `tlo doctor` 또는 `tlo doctor jira`를 먼저 실행해 다음 조치 안내를 확인하세요.

## 자주 쓰는 개발 명령

이 저장소 자체를 개발하거나 검증할 때 사용합니다.

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run lint
pnpm run package:smoke
pnpm run release:check
```

패키지에 포함될 파일 목록만 확인하려면 `pnpm run package:artifacts`를 실행합니다.
`pnpm run package:smoke`는 현재 checkout을 tarball로 묶은 뒤 임시 프로젝트에 설치해, 실제 설치된 바이너리 기준으로 MVP 흐름을 검증합니다.

## MVP 범위

MVP에서 확인하는 것은 다음 흐름입니다.

- 프로젝트 초기화: `init`
- 로컬 설정 진단: `doctor`
- Jira MCP 기반 이슈 읽기
- Gemini Planner 기반 subtask 생성
- 승인 후 대상 레포의 Git worktree에서 Codex CLI Executor 실행
- OpenAI Reviewer 기반 결과 검토
- 저장된 run 조회와 이어 실행: `status`, `resume`

반대로 아래 작업은 현재 MVP 범위가 아닙니다.

- 임의 shell 명령 실행
- 브랜치 생성, 커밋, 푸시
- GitHub PR 생성, 머지, 릴리스
- npm publish
- Jira/GitHub 쓰기 API 연동

`checkpoint`, `checks`, `pr-plan`, `approve-pr`, `pr-exec`, `execution-audit`, `write-readiness`, `write-runner` 같은 명령은 고급 진단 또는 dry-run 경계로 남겨 둔 기능입니다. 첫 설치와 기본 루프 확인에는 필요하지 않습니다. 특히 `write-runner`는 shell, git, GitHub 명령을 실행하지 않으며 PR, 태그, 릴리스를 만들지 않습니다.

## 문서

- 빠른 시작: [docs/quickstart.md](docs/quickstart.md)
- 명령어 전체 목록: [docs/commands.md](docs/commands.md)
- JSON 출력 계약: [docs/json-output.md](docs/json-output.md)
- JSON schema: [schemas/cli-json.schema.json](schemas/cli-json.schema.json)
- 릴리스 점검표: [docs/release-checklist.md](docs/release-checklist.md)
- 릴리스 준비 요약: [docs/release-readiness.md](docs/release-readiness.md)
- 이후 작업 후보: [docs/roadmap.md](docs/roadmap.md)
- 변경 내역: [CHANGELOG.md](CHANGELOG.md)

## 구조 요약

Root Orchestrator가 context와 graph를 관리합니다. Planner, Executor, Reviewer는 각자의 보고서와 context delta만 반환하고, context와 graph를 직접 수정하지 않습니다.

기본 Planner는 Gemini를 사용합니다. Executor는 로컬 로그인된 Codex CLI를 사용하되 대상 레포의 `.orchestrator/dev-workspaces/` 아래에 만든 Git worktree에서 실행하고, Reviewer는 OpenAI API를 사용합니다. 외부 GitHub/Jira 쓰기는 안전 경계 밖에 둡니다.

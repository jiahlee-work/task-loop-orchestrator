# 빠른 시작

아직 npm에 배포하지 않았습니다. 지금은 GitHub 저장소를 clone한 뒤 pnpm으로 빌드해서 사용합니다. 명령별 자세한 옵션은 [commands.md](commands.md)를 보세요.

현재 MVP는 대상 레포에 `.orchestrator/` 상태를 만들고, Jira 이슈를 읽어 Gemini Planner로 작업을 나눈 뒤 사용자가 plan을 승인하면 대상 레포의 dev worktree에서 Codex CLI Executor와 OpenAI Reviewer를 실행하는 흐름을 확인하는 단계입니다. 브랜치 생성, 커밋, 푸시, PR 생성, 릴리스, npm publish는 하지 않습니다.

## 요구 사항

- Node.js 24 이상
- Corepack으로 활성화한 pnpm 11.x 또는 호환되는 pnpm 설치
- 작업시킬 대상 프로젝트는 Git 저장소여야 합니다. `tlo init`은 Git 저장소가 아닌 폴더에서도 현재 디렉터리에 초기화할 수 있지만, Codex 실행은 Git worktree를 만들기 때문에 Git 저장소 밖에서는 실패할 수 있습니다.

## CLI 저장소 준비

CLI 저장소를 clone하고 빌드합니다.

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

다른 프로젝트에서는 `tlo` 명령으로 실행합니다.

```bash
cd /path/to/your-git-project
tlo --help
tlo doctor
```

## 대상 프로젝트 첫 실행

대상 프로젝트에서 아래 순서로 실행합니다.

```bash
tlo init
tlo setup
tlo run OUC-10
```

`tlo setup`은 Jira, Gemini, OpenAI 설정을 순서대로 진행합니다. 특정 provider만 다시 설정할 때는 `tlo setup jira`, `tlo setup gemini`, `tlo setup openai`를 사용할 수 있습니다. `tlo run`은 실행 전에 필요한 provider 설정을 확인하고, 빠진 설정이 있으면 run 파일을 만들지 않고 실패 이유와 다음 명령을 보여 줍니다. 설정이 끝난 프로젝트에서는 `tlo run OUC-10`만 바로 실행하면 됩니다.

## Gemini API key 준비

Gemini Planner를 쓰려면 Google AI Studio에서 API key를 발급받아 현재 프로젝트에 저장해야 합니다.

```bash
tlo setup gemini
```

실행하면 Gemini API key를 입력하라는 프롬프트가 나옵니다. key는 [Google AI Studio API Keys](https://aistudio.google.com/app/apikey)에서 만들거나 확인할 수 있습니다. 새 계정은 약관 동의 후 기본 Google Cloud 프로젝트와 key를 만들 수 있고, 기존 Cloud 프로젝트를 쓰는 경우에는 AI Studio에서 프로젝트를 선택하거나 가져온 뒤 key를 만들면 됩니다.

저장된 key는 `.orchestrator/gemini.env`에 들어가며, `init`이 `.orchestrator/`를 `.gitignore`에 추가합니다.

## OpenAI API key 준비

OpenAI Reviewer를 쓰려면 OpenAI API key를 발급받아 현재 프로젝트에 저장해야 합니다.

```bash
tlo setup openai
```

실행하면 OpenAI API key를 입력하라는 프롬프트가 나옵니다. key는 [OpenAI API keys](https://platform.openai.com/api-keys)에서 만들거나 확인할 수 있습니다. 저장된 key는 `.orchestrator/openai.env`에 들어갑니다.

## plan 승인과 Codex 실행

`tlo run`은 Gemini plan을 보여준 뒤 `Proceed with Codex execution? [y/N]`를 묻습니다. `n`을 입력하면 수정할 내용을 직접 적을 수 있고, 그 내용을 반영해 plan을 다시 만듭니다. `y`를 입력하면 Codex CLI가 대상 레포의 `.orchestrator/dev-workspaces/<runId>/<subtaskId>/` Git worktree에서 실행되고, OpenAI Reviewer가 결과를 검토합니다.

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

`init`은 다시 실행해도 기존 `orchestrator.config.json`을 덮어쓰지 않습니다. `.orchestrator/`가 `.gitignore`에 빠져 있으면 추가하고, 이미 있으면 그대로 둡니다.

`tlo doctor`는 설정, `.gitignore`, Git 상태 같은 준비 상태를 `pass`, `warn`, `fail`로 알려 줍니다. `init` 전에는 설정과 gitignore 관련 warning이 나올 수 있고, 이때는 `tlo init`을 먼저 실행하면 됩니다. Jira, Gemini, OpenAI 연결을 따로 점검하고 싶을 때만 `tlo doctor jira`, `tlo doctor gemini`, `tlo doctor openai`를 실행하세요.

GitHub remote와 읽을 수 있는 check-run이 있는 프로젝트에서는 CI 상태도 읽기 전용으로 확인할 수 있습니다.

```bash
tlo checks HEAD --json
```

GitHub 정보가 없거나 인증이 부족하면 실패 대신 `unknown` 또는 `not_found` 계열의 JSON 상태로 안내합니다.

## 릴리스 검증용 패키지 확인

일반 사용 흐름은 clone 후 `pnpm add -g .`로 `tlo`를 등록해 실행하는 방식입니다. 패키지에 포함될 파일이나 설치된 바이너리 동작을 확인해야 할 때만 아래 명령을 사용하세요.

```bash
pnpm run package:artifacts
pnpm run package:smoke
pnpm run release:check
```

`release:check`는 typecheck, test, build, package artifact dry-run review, lint, installed binary smoke, version, read-only checks 조회를 묶어 실행합니다. 이 명령도 publish, tag, GitHub release 생성, push, PR 생성, merge를 하지 않습니다.

## 고급 명령 위치

`checkpoint`, `checks`, `pr-plan`, `approve-pr`, `pr-exec`, `execution-audit`, `write-readiness`, `write-runner`는 첫 실행 흐름에 필요하지 않습니다. 필요할 때 [commands.md](commands.md)에서 동작과 안전 경계를 확인하세요.

특히 `write-runner`는 dry-run/simulation 경계로 남아 있으며 shell, git, GitHub 명령을 실행하지 않습니다. 브랜치, 커밋, 푸시, PR, 태그, 릴리스도 만들지 않습니다.

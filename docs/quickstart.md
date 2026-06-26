# 빠른 시작

아직 npm에 배포하지 않았습니다. 지금은 GitHub 저장소를 clone한 뒤 pnpm으로 빌드해서 사용합니다. 명령별 자세한 옵션은 [commands.md](commands.md)를 보세요.

현재 MVP는 로컬 프로젝트에 `.orchestrator/` 상태를 만들고, Jira 이슈를 읽어 Gemini Planner로 작업을 나눈 뒤 저장된 run을 조회하고 이어 실행하는 흐름을 확인하는 단계입니다. Executor와 Reviewer는 아직 mock 기반입니다. 브랜치 생성, 커밋, 푸시, PR 생성, 릴리스, npm publish는 하지 않습니다.

## 요구 사항

- Node.js 24 이상
- Corepack으로 활성화한 pnpm 11.x 또는 호환되는 pnpm 설치
- 대상 프로젝트가 Git 저장소이면 `doctor`와 `checks` 결과가 더 유용합니다.

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
tlo doctor
tlo setup jira
tlo setup gemini
tlo doctor jira
tlo doctor gemini
tlo run OUC-10
```

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

`tlo doctor`는 설정, `.gitignore`, Git 상태 같은 준비 상태를 `pass`, `warn`, `fail`로 알려 줍니다. `init` 전에는 설정과 gitignore 관련 warning이 나올 수 있고, 이때는 `tlo init`을 먼저 실행하면 됩니다.

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

# 빠른 시작

아직 npm에 배포하지 않았습니다. 지금은 GitHub 저장소를 clone한 뒤 pnpm으로 빌드해서 사용합니다. 명령별 자세한 옵션은 [commands.md](commands.md)를 보세요.

현재 MVP는 로컬 프로젝트에 `.orchestrator/` 상태를 만들고, mock 기반 작업 루프를 실행한 뒤 저장된 run을 조회하고 이어 실행하는 흐름을 확인하는 단계입니다. 브랜치 생성, 커밋, 푸시, PR 생성, 릴리스, npm publish는 하지 않습니다.

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
node dist/cli.js --help
node dist/cli.js --version
```

다른 프로젝트에서 반복해서 쓰려면 빌드된 CLI 경로를 환경 변수로 잡아 두세요.

```bash
export TLO="/absolute/path/to/task-loop-orchestrator/dist/cli.js"
cd /path/to/your-git-project
node "$TLO" --help
node "$TLO" doctor --json
```

## 대상 프로젝트 첫 실행

대상 프로젝트에서 아래 순서로 실행합니다.

```bash
node "$TLO" init
node "$TLO" doctor --json

run_json="$(node "$TLO" run "Quickstart smoke" --max-iterations 1 --json)"
run_id="$(printf '%s' "$run_json" | node -e 'let input=""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => console.log(JSON.parse(input).runId));')"

node "$TLO" status "$run_id" --json
node "$TLO" resume "$run_id" --max-iterations 1 --json
node "$TLO" status "$run_id" --json
```

`run --json`이 반환한 `runId`를 `status <runId>`와 `resume <runId>`에 넘기는 것이 기본 패턴입니다. 실행 기록은 대상 프로젝트의 `.orchestrator/runs/<runId>.json`에 저장됩니다.

`init`은 다시 실행해도 기존 `orchestrator.config.json`을 덮어쓰지 않습니다. `.orchestrator/`가 `.gitignore`에 빠져 있으면 추가하고, 이미 있으면 그대로 둡니다.

`doctor --json`은 설정, `.gitignore`, Git 상태 같은 준비 상태를 `pass`, `warn`, `fail`로 알려 줍니다. `init` 전에는 설정과 gitignore 관련 warning이 나올 수 있고, 이때는 `node "$TLO" init`을 먼저 실행하면 됩니다.

GitHub remote와 읽을 수 있는 check-run이 있는 프로젝트에서는 CI 상태도 읽기 전용으로 확인할 수 있습니다.

```bash
node "$TLO" checks HEAD --json
```

GitHub 정보가 없거나 인증이 부족하면 실패 대신 `unknown` 또는 `not_found` 계열의 JSON 상태로 안내합니다.

## 릴리스 검증용 패키지 확인

일반 사용 흐름은 clone 후 `node dist/cli.js` 또는 `node "$TLO"`로 실행하는 방식입니다. 패키지에 포함될 파일이나 설치된 바이너리 동작을 확인해야 할 때만 아래 명령을 사용하세요.

```bash
pnpm run package:artifacts
pnpm run package:smoke
pnpm run release:check
```

`release:check`는 typecheck, test, build, package artifact dry-run review, lint, installed binary smoke, version, read-only checks 조회를 묶어 실행합니다. 이 명령도 publish, tag, GitHub release 생성, push, PR 생성, merge를 하지 않습니다.

## 고급 명령 위치

`checkpoint`, `checks`, `pr-plan`, `approve-pr`, `pr-exec`, `execution-audit`, `write-readiness`, `write-runner`는 첫 실행 흐름에 필요하지 않습니다. 필요할 때 [commands.md](commands.md)에서 동작과 안전 경계를 확인하세요.

특히 `write-runner`는 dry-run/simulation 경계로 남아 있으며 shell, git, GitHub 명령을 실행하지 않습니다. 브랜치, 커밋, 푸시, PR, 태그, 릴리스도 만들지 않습니다.

# task-loop-orchestrator

AI 작업을 역할별로 나누고, 계획부터 검증까지의 진행 상태를 로컬 파일에 남기는 CLI 오케스트레이터입니다.

현재 MVP는 실제 코드를 대신 작성하거나 GitHub에 변경을 올리는 도구가 아닙니다. 먼저 `init`, `doctor`, `run`, `status`, `resume` 흐름으로 “작업 루프를 만들고, 저장하고, 이어서 확인하는” 기본 사용성을 검증하는 단계입니다.

## 요구 사항

- Node.js 24 이상
- Corepack으로 활성화한 pnpm 11.x, 또는 호환되는 pnpm 설치
- 사용 대상 프로젝트가 Git 저장소이면 `doctor`와 상태 진단 결과가 더 정확합니다.

## 설치와 실행

아직 npm에 배포하지 않았습니다. 지금은 GitHub 저장소를 clone한 뒤 pnpm으로 빌드해서 사용합니다.

```bash
git clone https://github.com/jiahlee-work/task-loop-orchestrator.git
cd task-loop-orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm link --global
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
tlo doctor
tlo setup jira
tlo doctor jira
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

MVP에서 확인하는 것은 다음 네 가지입니다.

- 프로젝트 초기화: `init`
- 로컬 설정 진단: `doctor`
- mock 기반 작업 루프 실행과 저장: `run`
- 저장된 run 조회와 이어 실행: `status`, `resume`

반대로 아래 작업은 현재 MVP 범위가 아닙니다.

- 실제 Codex CLI 실행
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

기본 executor와 reviewer는 mock 기반입니다. 외부 GitHub, Jira, Codex 연동은 provider 인터페이스나 읽기 전용 진단 경계로만 다룹니다.

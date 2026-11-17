# 압박 면접 연습

기술 압박 면접을 혼자 연습하는 개인용 도구다. 주제를 고르면 면접관 셋이 번갈아 묻고, 답의 결함에 따라 다음 질문이 정해진다. 면접이 끝나면 복기에서 질문 의도, 숨은 정답지, 면접 중 판정을 다시 검사한 결과를 보여 주고, 가정별 결과를 기억해 다음 면접에 쓴다.

설계는 [`docs/specs/2026-11-16-pressure-interview-design.md`](docs/specs/2026-11-16-pressure-interview-design.md), 구현 계획은 [`docs/plans/`](docs/plans/), 실제로 돌려 본 기록은 [`docs/r1-review.md`](docs/r1-review.md)와 [`docs/a-review.md`](docs/a-review.md)에 있다.

## 필요한 것

- Node.js 24.21 이상 (`.nvmrc`)
- Docker (PostgreSQL 18을 컨테이너로 띄운다)
- Anthropic API 키

## 처음 한 번

```bash
npm install
```

`.env.example`을 `.env`로 복사하고 `ANTHROPIC_API_KEY`를 채운다. `.env`는 git에 올라가지 않는다. 나머지 값은 그대로 두면 앱은 `127.0.0.1:3110`, DB는 `127.0.0.1:5436`을 쓴다.

Windows PowerShell에서 `npm`이 실행 정책에 걸리면 `npm.cmd`로 부른다.

## 띄우기

```bash
docker compose up -d --wait db
```

```bash
npm run migration:run
```

```bash
npm run start:app
```

브라우저에서 `http://127.0.0.1:3110`을 연다. 끌 때는 앱을 Ctrl+C로 멈추고 DB는 아래 명령으로 멈춘다. 면접 기록은 남는다.

```bash
docker compose stop db
```

## 과금

`npm run start:app`으로 띄운 앱은 실제 모델 API를 부른다. 호출이 나가는 때는 다음과 같다.

- 면접 시작, 답 보내기, 되묻기
- 질문이 화면에 나간 뒤 뒤에서 도는 정답지 작성과 검증
- 복기 만들기(답한 질문마다 한 번)

2026-11-17에 질문 6개짜리 면접을 두 번 돌렸을 때, 기록된 토큰 수에 가격표를 곱한 값은 한 판에 약 $1.4~$2.0이었다. 청구서 금액이 아니라 계산값이고, 주제와 답 길이에 따라 달라진다. 복기 비용은 아직 재지 않았다.

시스템 프롬프트는 프롬프트 캐싱으로 보낸다. 캐시 수명은 면접 중 호출이 1시간, 복기 호출이 5분이다. 그래서 입력 토큰은 셋으로 나뉘어 기록된다: 캐시되지 않은 입력(`input_tokens`), 캐시에 쓴 입력(`cache_creation_input_tokens`), 캐시에서 읽은 입력(`cache_read_input_tokens`). `claude-opus-5-5`의 가격표는 100만 토큰당 입력 $4, 출력 $20, 캐시 읽기 $0.20, 캐시 쓰기 $8(1시간)·$5(5분)이다. 호출별 토큰 수는 `llm_usage` 테이블에 남고, 복기 화면의 사용량 표에서 볼 수 있다. 위의 $1.4~$2.0은 캐싱을 넣기 전의 값이다.

`npm run r1`(엔진만 따로 돌려 보는 실행기)도 실제 API를 부른다.

## 과금 없이 써 보기

```bash
npm run start:fake
```

가짜 모델 응답과 임시 DB로 앱을 `http://127.0.0.1:3199`에 띄운다. 화면 흐름을 볼 때 쓴다. Ctrl+C로 끄거나 `http://127.0.0.1:3199/__fake/stop`을 열면 임시 DB까지 지우고 끝난다.

## 테스트

| 명령 | 하는 일 |
|---|---|
| `npm test` | 단위 테스트 |
| `npm run test:e2e` | 임시 PostgreSQL 컨테이너와 가짜 모델 응답으로 도는 e2e. Docker가 떠 있어야 한다 |
| `npm run typecheck` | 서버 타입 검사 |
| `npm run lint` | ESLint |
| `npm run frontend:verify` | 화면의 타입 검사, lint, 테스트, 빌드 |

테스트는 실제 API를 부르지 않는다.

## 구조

- `src/interview/` 엔진: 모델 호출(질문, 정답지, 전제 검사, 검증, 흘림 검사, 분석, 되묻기, 복기)과 다음 질문자를 고르는 규칙
- `src/session/` 면접 한 판의 진행과 HTTP API
- `src/review/` 복기와 추이
- `src/memory/` 가정별 기억
- `frontend/` 화면(React, Vite, Tailwind). 빌드한 결과를 서버가 같은 주소에서 내려 준다
- `scripts/` e2e 실행기, 가짜 응답 앱, R1 실행기

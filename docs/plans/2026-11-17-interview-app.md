# 압박 면접 앱 구현 계획 (계획 2/2): 서버·화면·복기·기억

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계획 1의 엔진 위에, 브라우저에서 주제를 골라 면접 한 판을 하고 복기까지 보는 개인용 앱을 만든다. 면접 기록과 가정별 결과는 PostgreSQL에 남고, 다음 면접이 그 기억을 쓴다.

**Architecture:**
- 엔진(`src/interview/`)은 그대로 두고 필요한 만큼만 넓힌다. 그 위에 세션 계층(`src/session/`)이 DB를 상태로 삼아 한 판을 진행한다. 진행은 "DB를 보고 빠진 다음 단계를 한다"는 `advance` 하나로 모은다. 그래서 모델 호출이 중간에 실패하거나 서버가 다시 떠도 같은 호출로 이어 간다.
- 면접 중 응답은 공개 필드만 고른 뷰로 내보낸다. 질문 의도, 정답지, 바뀐 가정, 분석, 반응 의도, 성향은 복기 뷰에서만 나간다.
- 복기(`src/review/`)는 면접이 끝난 뒤 턴마다 재검사 호출을 하고, 그 결과로 기억(`src/memory/`)을 고친다. 기억은 다음 면접의 질문 프롬프트에 입력으로 들어간다.
- 화면은 BlueGang처럼 Vite로 빌드한 `frontend/dist`를 Nest가 같은 origin에서 내려준다. 라우터 없이 화면 셋을 상태로 바꾼다.

**Tech Stack:** 계획 1의 스택에 `@nestjs/platform-express`, `@nestjs/typeorm`, `typeorm`, `pg`, `dotenv`, `supertest`, React 19, Vite 8, Tailwind 4(`@tailwindcss/vite`)를 더한다. PostgreSQL은 `postgres:18.4-alpine` 이미지를 쓴다.

**Spec:** [`docs/specs/2026-11-16-pressure-interview-design.md`](../specs/2026-11-16-pressure-interview-design.md). R1 판정과 그 반영은 [`docs/r1-review.md`](../r1-review.md), 계획 1은 [`2026-11-16-r1-core-engine.md`](2026-11-16-r1-core-engine.md).

**Status:** 사용자 승인 (2026-11-17). 표의 [제안] P1~P18도 함께 수락됐다. 실행 방식은 subagent-driven이고 에이전트는 한 번에 하나만 돌린다. 사용자가 같은 날 계획 2 작성을 지시했고, Claude는 이를 R1 통과로 읽었다. 초안은 정적 검토를 두 번 거쳐 고쳤다(1차: 설계 대조·진행 로직·기술 사실 검토자 셋, 2차: 고친 문서의 재검토 하나). 코드를 실행해 확인한 것은 없다.

## 결정과 제안

**[결정]** 은 사용자가 정한 것, **[제안]** 은 이 계획을 쓰며 Claude가 정한 것이다. [제안]은 계획 승인으로 함께 수락되고, 승인 전에 바꿀 수 있다.

이어받는 [결정]: 설계 문서의 [결정] 전부, `docs/r1-review.md`의 D1~D9, 그리고 계획 1 실행을 지시할 때 사용자가 정한 것(커밋에 Claude 표시 없음, API 키를 명령·출력·커밋에 넣지 않음, 실제 API 실행은 매번 승인, BlueGang은 읽기만 함).

이 계획의 [제안] 가운데 사용자가 한 번 봐 주면 좋은 것:

| # | [제안] | 다른 선택 |
|---|---|---|
| P1 | 한 문서에 두 부분으로 쓴다. A(면접 한 판)가 끝나면 체크포인트 A에서 실제로 한 판 해 보고 B(복기·기억)로 간다. | 문서 둘로 나누기 |
| P2 | 직무형 면접관의 직무는 면접 시작 때 작은 모델 호출 하나가 주제를 보고 고른다. | 무작위, 또는 시작 화면에서 사용자가 고르기 |
| P3 | 성향은 세 가지를 섞어 한 명에 하나씩 준다. 면접 중 화면에는 직무만 보이고 성향은 복기에서 공개한다. | 성향 중복 허용, 면접 중 성향 표시 |
| P4 | 덧붙이기는 "번갈아" 방식이다. 첫 면접관의 질문에 답한 다음에 두 번째 면접관이 "저도 하나 덧붙이면" 하고 묻는다. 덧붙이는 질문도 질문 수에 든다. 덧붙이기를 기다리는 사이에 한 답은 분석해서 복기에 남기지만 다음 질문자 선택에는 쓰지 않는다. 다만 그 답이 오답 의심이거나 "모른다"는 답이면 덧붙이기를 버리고 그 답에 반응한다. | 두 질문을 한 화면에 함께 보여 주고 한 번에 답하기. 기다리던 덧붙이기를 항상 묻기 |
| P5 | 끼어들기 흉내는 이 계획에서 뺀다. 설계가 우선순위를 낮게 두었고, 한 판을 써 본 뒤에 정한다. | 이 계획에 넣기 |
| P6 | 질문 수 상한의 기본값은 6이고 시작 화면에서 바꿀 수 있다(2~30). 사용자가 "여기서 끝내기"로 일찍 끝낼 수 있다. 일찍 끝낸 판에는 가정 변경 질문이 없을 수 있다. | 다른 기본값 |
| P7 | 한 판의 절반을 넘도록 가정 변경 질문이 없었으면 다음 질문에 정체성 비교 축(`identity_swap`)을 지정한다. | 질문자의 직무 축을 지정 |
| P8 | 흔들렸거나 틀린 가정은 마지막으로 만난 뒤 24시간이 지나면 다시 낼 후보가 된다. 주제와 이어지는지는 질문을 쓰는 모델이 판단한다. | 다른 간격, 면접 횟수 기준 |
| P9 | "예상했음" 표시는 두 곳에 쓴다. 다시 낼 후보는 "예상 밖"이었던 것을 앞에 두고, 예상했던 가정은 "비슷한 것은 피한다" 목록으로 프롬프트에 준다. | 추이 표시에만 쓰기 |
| P10 | 복기 재검사는 턴마다 호출 하나다. 모델 기본값은 다른 호출과 같은 `claude-opus-5-5`, effort는 `high`다. 설계 3장의 "복기에 상위 모델"과는 다르다(계획 1에서 모든 호출의 기본값을 한 모델로 정했다). `ENGINE_MODEL_REVIEW`로 바꿀 수 있다. | 상위 모델, 더 높은 effort, 여러 번 확인 |
| P11 | 되묻기 응답에도 흘림 검사를 한다(F2). 다시 만들어도 위반이 남으면 질문과 같은 방식으로 처리한다: 응답은 보여 주고, 흘림 표시를 남겨 복기에서 알린다. 되묻기 횟수에는 상한을 두지 않고 기록만 한다. | 위반이 남은 응답을 막기, 횟수 상한 |
| P12 | 화면에 BlueGang의 shadcn 컴포넌트 묶음(`@base-ui/react`, `class-variance-authority`, `cn`, `lucide-react`)과 자체 글꼴은 들이지 않는다. 화면 셋에 버튼·입력·카드뿐이라 Tailwind 클래스로 쓴다. | BlueGang과 같은 컴포넌트 묶음 |
| P13 | 서버는 `127.0.0.1`에만 연다. 로그인이 없기 때문이다. 포트는 앱 3110, DB 5436다(2026-11-17 확인: 이 PC에서 3100은 다른 node 프로세스가, 5435는 `bluegang-basic-db` 컨테이너가 잡고 있어 처음 적었던 값에서 바꿨다. BlueGang의 3000, 5433과도 겹치지 않는다). | 다른 포트 |
| P14 | 사용량은 토큰 수로만 보여 준다. 금액은 가격표가 바뀌므로 앱이 계산하지 않는다. | 가격을 설정으로 받아 금액 표시 |
| P15 | 기술 대체 축의 대체 기술 이름("Redis 대신 X라면?")은 지금처럼 전제로 허용한다. D6이 비교 대상을 꺼내도 좋다고 한 범위로 읽었다. | 금지 |
| P16 | 프롬프트에 싣는 기억에 상한을 둔다: 다시 내지 않는 가정 30, 다시 낼 가정 5, 예상했던 가정 10. 잘 답한 가정이 30개를 넘으면 오래된 것이 목록에서 빠져 다시 나올 수 있다. | 상한 없음, 축별로 자르기 |
| P17 | 복기와 기억 반영은 사용자가 복기 화면에서 "복기 만들기"를 누를 때 한다. 복기하지 않은 면접의 가정은 기억에 남지 않는다. | 면접이 끝나면 바로 복기를 만든다(끝낼 때마다 과금) |
| P18 | 답은 저장됐는데 분석이 실패한 채로(또는 되묻기에 응답을 받기 전에) 면접을 끝내면, 그 턴은 복기에서 빠진다. | 끝내기 전에 분석을 마치게 한다 |

이 계획에 넣지 않은 것: 끼어들기 흉내(P5), 2단계 서류 입력, 음성, 로그인, 면접 삭제 기능, 금액 계산, `ENGINE_MAX_REGENERATIONS=0` 허용.

## Global Constraints

**환경**
- Windows, PowerShell 5.1이다. `&&`가 없으니 명령은 하나씩 실행한다. npm은 `npm.cmd`, npx는 `npx.cmd`로 부른다.
- 작업 폴더는 `C:\Users\dosac\projects\interview`다. 시작 전에 checkout, branch, HEAD를 확인한다. 엔진 코드는 `feat/r1-core-engine`에 있다. 이 계획의 작업 브랜치는 실행을 시작할 때 사용자에게 묻는다.
- BlueGang(`C:\Users\dosac\projects\BlueGang`, main `1ea20e8`)은 읽기만 한다. `C:\Users\dosac\.codex` 아래는 보지 않는다.
- Docker 자원은 이 프로젝트 것만 쓴다. compose 프로젝트 이름은 `pressure-interview`(개발)와 `pressure-interview-e2e-<pid>-<시각>`(테스트)이다. 다른 프로젝트의 컨테이너와 볼륨을 건드리지 않는다.

**스택과 관례 (BlueGang main을 따른다)**
- 패키지는 루트 `package.json` 하나다. 워크스페이스를 만들지 않는다. 프런트 패키지는 루트 `devDependencies`에 넣는다.
- 새로 넣는 의존성의 버전 문자열은 BlueGang `package.json`에서 그대로 복사한다. 조사 때 읽은 값: `@nestjs/platform-express` ^11.2.7, `@nestjs/typeorm` ^11.0.3, `typeorm` ^1.1.0, `pg` ^8.22.0, `dotenv` ^17.4.2, `supertest` ^7.2.2, `@types/supertest` ^7.2.1, `react` ^19.3.0, `react-dom` ^19.3.0, `@types/react` ^19.3.0, `@types/react-dom` ^19.3.0, `vite` ^8.3.3, `tailwindcss` ^4.3.3, `@tailwindcss/vite` ^4.3.3.
- 요청 검증은 class-validator 없이 손으로 쓴다. 컨트롤러는 `@Body() body: unknown`으로 받고, 검증 함수가 문제 목록을 모아 오류를 던진다.
- 엔티티: 파일 이름은 `*.entity.ts`, 기본 키는 uuid, 테이블과 컬럼 이름은 `@Entity({ name })`, `@Column({ name })`으로 snake_case를 직접 적는다. 시각은 `timestamptz`다. 관계 데코레이터는 쓰지 않고 FK는 SQL에만 둔다.
- 마이그레이션은 손으로 쓴 SQL(`QueryRunner.query`)이다. `synchronize: false`, `migrationsRun: false`, `installExtensions: false`다. 앱이 시작할 때 마이그레이션을 돌리지 않는다.
- 단위 테스트는 소스 옆 `*.spec.ts`(Jest), DB를 쓰는 테스트는 `test/*.e2e-spec.ts`(실제 PostgreSQL)다. 프런트의 순수 로직 테스트는 `node:test`다.
- 화면 금지 사항(BlueGang `DESIGN.md`): HTML `style` 속성, HTML 안 `script`, 외부 출처의 글꼴·그림·요청, `data:` 자원. 색만으로 상태를 전하지 않고 글로 함께 적는다. 버튼과 입력의 최소 높이는 44px, 입력 글자는 16px다.
- 태스크마다 끝에서 `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`가 통과해야 한다. DB나 HTTP를 건드린 태스크는 `npm.cmd run test:e2e`도, 프런트를 건드린 태스크는 `npm.cmd run frontend:verify`도 통과해야 한다.

**DB 쓰기**
- 턴과 세션을 고칠 때는 바꾸는 컬럼만 `repository.update(id, { … })`로 쓴다. 읽어 둔 엔티티를 통째로 `save`하지 않는다. 백그라운드 사후 검증과 `advance`가 같은 턴을 고칠 수 있어서, 통째로 저장하면 한쪽이 쓴 값을 다른 쪽이 옛 값으로 덮는다.
- 두 테이블을 함께 바꾸는 곳은 `dataSource.transaction`으로 묶는다. 모델 호출은 트랜잭션 밖에서 한다(호출이 수십 초 걸린다).

**Claude 호출과 비용**
- 계획 1의 규칙이 그대로다. 모든 호출은 `LlmService.callJson`을 거친다. 모델 기본값은 `claude-opus-5-5`다.
- **자동 테스트는 실제 API를 부르지 않는다.** e2e는 `ANTHROPIC_CLIENT`를 가짜로 바꾸고, 실행기가 `ANTHROPIC_BASE_URL=http://127.0.0.1:9`를 함께 건다. 가짜로 바꾸는 것을 빠뜨려도 연결 실패로 끝나게 하기 위해서다.
- 프로젝트 `.env`에는 실제 키가 있다. `.env`를 읽거나 출력하지 않는다. `npm.cmd run start:app`으로 띄운 앱에서 면접을 시작하면 과금된다. 실제 API를 쓰는 실행은 체크포인트 A와 B에서만, 사용자 승인을 받고 한다.
- 화면을 과금 없이 확인할 때는 `npm.cmd run start:fake`(Task 9)를 쓴다.

**git**
- 커밋 메시지와 PR 설명에 Claude 표시를 넣지 않는다. **[결정]**
- `.gitattributes`의 `* text=auto eol=lf`를 유지한다. `frontend/dist`, `frontend/.test`는 gitignore에 넣는다.

**프롬프트**
- 프롬프트와 출력은 한국어다. 지시에는 이유를 함께 적는다. 구체 기술 이름을 시스템 프롬프트의 예시로 새로 넣지 않는다(다른 주제에서 이름 규칙 위반을 만든다).

## Review Focus

1. **숨긴 정보가 면접 중 응답에 실려 나간다.** 정답지, 질문 의도, 바뀐 가정, 분석, 반응 의도, 성향은 면접이 끝나 복기를 열기 전까지 어떤 응답에도 없어야 한다. 오류 응답도 마찬가지다. 테스트: Task 7(뷰), Task 8(HTTP 응답과 오류 본문), Task 12(진행 중인 면접의 복기 요청).
2. **모델 호출이 턴 중간에 실패한다**(거절, `max_tokens`, 네트워크). 사용자의 답은 이미 저장돼 있어야 하고, 다시 시도하면 빠진 단계부터 이어 가야 한다. 같은 답을 두 번 분석하지 않는다. 테스트: Task 7.
3. **같은 답을 두 번 보낸다**(더블 클릭, 새로고침 뒤 재전송). 이미 답한 턴에 온 답은 409로 거절하고 상태를 바꾸지 않는다. 동시에 온 두 요청은 세션별로 줄 세워 모델 호출이 겹치지 않는다. 테스트: Task 7, Task 8.
4. **서버가 면접 도중 다시 뜬다.** DB만으로 이어 간다. 끝나지 않은 사후 검증은 답을 받을 때 다시 한다. 테스트: Task 7.
5. **복기를 두 번 누르거나 생성 도중 일부가 실패한다.** 턴마다 한 번만 만들고, 실패한 턴만 다시 만든다. 기억 반영은 여러 번 해도 결과가 같고, 반영이 실패해도 다시 갈 길이 있다. 테스트: Task 11, Task 12.

---

# A부: 면접 한 판

### Task 1: 서버 뼈대, DB 연결, e2e 실행기

**Files:**
- Modify: `package.json`, `.env.example`, `.gitignore`
- Create: `compose.yaml`, `compose.e2e.yaml`
- Create: `src/main.ts`, `src/configure-app.ts`, `src/app.module.ts`, `src/config/environment.ts`, `src/database/database.options.ts`, `src/database/data-source.ts`, `src/health/health.controller.ts`
- Create: `scripts/run-e2e.ts`, `test/jest-e2e.json`, `test/e2e-environment.ts`, `test/support/fake-anthropic.ts`, `test/support/test-app.ts`, `test/support/reset-db.ts`
- Test: `src/config/environment.spec.ts`, `src/health/health.controller.spec.ts`, `test/app.e2e-spec.ts`

**Interfaces:**
- Produces
  - `src/config/environment.ts`: `interface EnvironmentVariables { NODE_ENV: 'development' | 'test' | 'production'; PORT: number; DB_HOST: string; DB_PORT: number; DB_USERNAME: string; DB_PASSWORD: string; DB_DATABASE: string }`, `validateEnvironment(env: Record<string, unknown>): Record<string, unknown> & EnvironmentVariables`.
    - 없는 값(빈 문자열 포함)은 아래 "정하는 값"의 기본값으로 채운다. 사용자의 `.env`에는 DB 줄이 없으므로, 기본값만으로 개발 DB에 붙어야 한다.
    - 값이 있는데 틀리면 변수 이름을 담은 Error를 던진다. 값은 메시지에 넣지 않는다.
    - **받은 `env`의 나머지 키를 그대로 실어 돌려준다**(`{ ...env, ...검증한 일곱 값 }`). `@nestjs/config`는 `validate`가 돌려준 객체의 키만 `process.env`에 옮긴다. 일곱 값만 돌려주면 `.env`의 `ANTHROPIC_API_KEY`와 `ENGINE_*`가 버려져, 실제 실행에서 키를 찾지 못하고 사용자의 모델 설정이 무시된다.
  - `src/database/database.options.ts`: `createDataSourceOptions(env: EnvironmentVariables): DataSourceOptions`. BlueGang의 같은 파일과 같은 모양이다(`entities: **/*.entity.{ts,js}`, `migrations: src/database/migrations/*.{ts,js}`, `migrationsTableName: 'typeorm_migrations'`, `migrationsRun: false`, `synchronize: false`, `installExtensions: false`).
  - `src/app.module.ts`: `AppModule`. `ConfigModule.forRoot({ cache: true, isGlobal: true, validate: validateEnvironment, load: [engineConfig], ignoreEnvFile: process.env.NODE_ENV === 'test' })`, `TypeOrmModule.forRootAsync`(`autoLoadEntities: true`), `EngineModule`, `HealthController`. 테스트에서는 `.env`를 읽지 않는다. 사용자의 `.env`(실제 키, 바꾼 설정)에 테스트가 흔들리지 않게 하기 위해서다.
  - `src/configure-app.ts`: `configureApp(app: NestExpressApplication): void`. 전역 prefix `v1`을 건다. 전역 오류 필터는 Task 8이, `frontend/dist` 정적 파일은 Task 9가 여기에 더한다. `main.ts`와 테스트와 `start:fake`가 이 함수를 쓴다. `main.ts`에 두지 않는 까닭은, `main.ts`를 import하면 파일 끝의 부트스트랩이 돌아 서버가 열리기 때문이다.
  - `src/main.ts`: `NestFactory.create<NestExpressApplication>(AppModule)` → `configureApp(app)` → `app.listen(PORT, '127.0.0.1')`.
  - HTTP: 모든 API 경로는 `/v1` 아래다. `GET /v1/health` → `200 { "status": "ok" }`.
  - `test/support/fake-anthropic.ts`
    ```ts
    export type CallKind = 'question' | 'analyze' | 'leak' | 'verify' | 'clarify' | 'jobRole' | 'review';
    export type FakeReply = object | Error | ((params: Record<string, unknown>) => object | Promise<object>);
    export function rawText(text: string): object; // JSON으로 감싸지 않고 이 글자를 그대로 text 블록에 싣게 하는 표시
    export interface FakeAnthropic {
      client: { beta: { messages: { create: (params: Record<string, unknown>) => Promise<object> } } };
      calls: { kind: CallKind; params: Record<string, unknown> }[];
      on(kind: CallKind, reply: FakeReply): void;   // 이 종류의 호출에 앞으로 이 응답을 준다
      once(kind: CallKind, reply: FakeReply): void; // 다음 한 번만 이 응답을 준다. on보다 먼저 쓰인다
    }
    export function createFakeAnthropic(): FakeAnthropic;
    ```
    - 호출 종류는 요청의 `output_config.format.schema.required`로 알아낸다: `questionIntent`가 있으면 question, `kind`면 analyze, `techs`면 leak, `premiseOk`면 verify, `reply`면 clarify, `role`이면 jobRole, `intent`면 review.
    - 응답 모양: `{ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 10, output_tokens: 5, iterations: null }, model: 'fake-model' }`. `Error`를 주면 그 오류를 던진다.
    - 종류마다 기본 응답을 둔다. question: 가정 없는 질문(`assumption: { axis: 'none', statement: '' }`, `answerKey.keyPoints: ['k1']`). analyze: `{ kind: 'answer', defects: [], mentionedTechs: [], unknownTechs: [] }`. leak: `{ techs: [] }`. verify: `premiseOk: true`, 문제 없음. clarify: `{ reply: '범위는 한 대의 서버입니다.' }`. jobRole: `{ role: 'dba' }`. review: Task 10의 `TurnReview` 모양에서 `assumption.result: 'none'`, 나머지는 빈 값.
  - `test/support/test-app.ts`: `createTestApp(fake: FakeAnthropic, overrides?: { provide: unknown; useValue: unknown }[]): Promise<NestExpressApplication>`. `AppModule`을 올리고 `ANTHROPIC_CLIENT`를 `fake.client`로 바꾼 뒤 `configureApp(app)`을 적용하고 `app.init()`까지 한다. `overrides`는 compile 전에 `overrideProvider`로 건다. 뒤 태스크의 테스트가 `RNG`, `MEMORY_SOURCE` 같은 provider를 바꿀 때 쓴다.
  - `test/support/reset-db.ts`: `resetDb(dataSource: DataSource): Promise<void>`. 이 프로젝트의 테이블을 모두 `TRUNCATE … CASCADE`한다(Task 2 뒤로는 네 테이블). `DB_DATABASE`가 `interview_e2e`가 아니면 던진다. e2e 파일마다 `beforeEach`에서 부른다. 세션에 FK가 없는 테이블(`assumption_records`, `llm_usage`)이 다음 파일의 단언을 흔들지 않게 한다.
  - npm scripts: `build`, `start`(`nest start`), `start:dev`, `migration:show`, `migration:run`, `migration:revert`(BlueGang과 같은 명령), `test:e2e`(`ts-node scripts/run-e2e.ts`), `test:e2e:jest`(`jest --config ./test/jest-e2e.json --runInBand`). `lint`와 `format`의 대상에 `test`를 더한다(`"{src,test,scripts}/**/*.ts"`).

**정하는 값**
- 환경 변수의 기본값이자 `.env.example`에 더하는 줄: `NODE_ENV=development`, `PORT=3110`, `DB_HOST=127.0.0.1`, `DB_PORT=5436`, `DB_USERNAME=interview`, `DB_PASSWORD=interview_local`, `DB_DATABASE=interview`. `compose.yaml`의 기본값과 같아야 한다.
- `compose.yaml`: `name: pressure-interview`, 서비스 `db`, 이미지 `postgres:18.4-alpine`, `container_name: pressure-interview-db`, 포트 `"127.0.0.1:${DB_PORT:-5436}:5432"`, 볼륨 `postgres_data:/var/lib/postgresql`, healthcheck `pg_isready`. 환경 변수는 BlueGang `compose.yaml`처럼 `${DB_DATABASE:-interview}` 꼴로 받는다.
- `compose.e2e.yaml`: 같은 이미지, DB와 사용자 `interview_e2e`, 포트 `"127.0.0.1::5432"`(호스트 포트 임의 배정).
- `scripts/run-e2e.ts`가 하는 일(순서대로)
  1. `docker compose -p pressure-interview-e2e-<pid>-<시각> -f compose.e2e.yaml up -d --wait db`
  2. `docker compose … port db 5432`로 포트를 읽는다.
  3. 자식 프로세스에 줄 환경을 만든다: `NODE_ENV=test`, `DB_*`(e2e 값), `ANTHROPIC_BASE_URL=http://127.0.0.1:9`, `ANTHROPIC_API_KEY=e2e-not-a-key`.
  4. `migration:run`, 이어서 `test:e2e:jest`를 돌린다. npm은 BlueGang `scripts/run-e2e.ts`처럼 `spawn(process.execPath, [process.env.npm_execpath, 'run', …], { env })`로 부른다. `npm.cmd`를 직접 spawn하지 않는다(Windows에서 shell 없이 `.cmd`를 spawn하면 실패한다). `npm_execpath`가 없으면 "npm run으로 실행해야 한다"는 오류로 끝낸다. docker는 `spawn('docker', …)`로 직접 부른다.
  5. 성공하든 실패하든 `docker compose … down --volumes --remove-orphans`.
  6. jest의 종료 코드로 끝낸다.
  - BlueGang의 `--external-db` 등 다른 옵션은 만들지 않는다.
- `test/e2e-environment.ts`: `NODE_ENV !== 'test'`이거나 `DB_DATABASE !== 'interview_e2e'`이면 예외를 던진다. 개발 DB를 테스트가 건드리지 못하게 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// src/config/environment.spec.ts
it('아무 값도 없으면 기본값으로 채운다', () => {
  expect(validateEnvironment({})).toEqual({ NODE_ENV: 'development', PORT: 3110, DB_HOST: '127.0.0.1',
    DB_PORT: 5436, DB_USERNAME: 'interview', DB_PASSWORD: 'interview_local', DB_DATABASE: 'interview' });
});
it('빈 문자열은 없는 값으로 본다', () => {
  expect(validateEnvironment({ PORT: '' }).PORT).toBe(3110);
});
it('모르는 키도 결과에 남는다(.env의 나머지 값이 process.env로 가야 한다)', () => {
  expect(validateEnvironment({ ENGINE_MAX_CONSECUTIVE: '3' }).ENGINE_MAX_CONSECUTIVE).toBe('3');
});
it('틀린 값은 변수 이름으로 알리고 값은 메시지에 넣지 않는다', () => {
  const run = () => validateEnvironment({ DB_PORT: 'not-a-port-9731' });
  expect(run).toThrow(/DB_PORT/);
  expect(run).not.toThrow(/9731/);
});
it('PORT가 1~65535의 정수가 아니면 던진다', () => {
  expect(() => validateEnvironment({ PORT: '0' })).toThrow(/PORT/);
});
it('NODE_ENV가 목록 밖이면 던진다', () => {
  expect(() => validateEnvironment({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
});
```

```ts
// test/app.e2e-spec.ts
it('GET /v1/health 는 200과 { status: "ok" }를 준다', async () => { /* supertest */ });
it('마이그레이션 테이블이 있다', async () => {
  const rows = await dataSource.query(`SELECT to_regclass('public.typeorm_migrations') AS t`);
  expect(rows[0].t).toBe('typeorm_migrations');
});
it('가짜 클라이언트가 호출 종류를 알아낸다', async () => {
  const fake = createFakeAnthropic();
  await fake.client.beta.messages.create({ output_config: { format: { schema: { required: ['techs'] } } } });
  expect(fake.calls[0].kind).toBe('leak');
});
it('once가 on보다 먼저 쓰이고 한 번만 쓰인다', async () => { /* once → on → on */ });
it('rawText는 글자를 그대로 싣는다', async () => { /* content[0].text === '{깨진' */ });
```

- [ ] **Step 2: 실패를 확인한다.** 실행: `npm.cmd test -- environment`. 기대: `validateEnvironment`가 없어 FAIL.
- [ ] **Step 3: 의존성을 넣고 위 Files를 만든다.** `npm.cmd install`로 `@nestjs/platform-express`, `@nestjs/typeorm`, `typeorm`, `pg`, `dotenv`와 개발용 `supertest`, `@types/supertest`를 넣는다. 설정 파일은 BlueGang의 같은 파일을 읽고 이 프로젝트 이름과 값으로 옮긴다.
- [ ] **Step 4: 개발 DB를 띄워 본다.** 실행: `docker compose up -d --wait db`, 이어서 `npm.cmd run migration:show`. 기대: 연결 성공, 마이그레이션 0개. 확인 뒤 `docker compose stop db`.
- [ ] **Step 5: 전체 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run test:e2e`. 기대: 모두 통과. e2e가 끝난 뒤 `docker ps -a --filter name=pressure-interview-e2e`가 비어 있다.
- [ ] **Step 6: 커밋.** 위 파일을 이름으로 `git add`하고 `git commit -m "feat: 서버 뼈대와 DB 연결, e2e 실행기"`.

### Task 2: 스키마와 엔티티

**Files:**
- Create: `src/database/migrations/1794873600000-InterviewCore.ts`
- Create: `src/session/interview-session.entity.ts`, `src/session/interview-turn.entity.ts`, `src/memory/assumption-record.entity.ts`, `src/usage/llm-usage.entity.ts`
- Modify: `src/interview/types.ts`(아래 타입 추가), `test/support/reset-db.ts`(네 테이블)
- Test: `test/schema.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1의 `createTestApp`, `resetDb`. 계획 1의 `PanelMember`, `Question`, `Analysis`, `Pick`, `PickChoice`, `Defect`, `Verification`, `PreparedQuestion`, `AxisId`, `ReactionIntentId`
- Produces
  - `src/interview/types.ts`에 추가
    ```ts
    export interface AssumptionRef { axis: AxisId; statement: string }
    export interface QuestionMemory { retired: AssumptionRef[]; reissue: AssumptionRef[]; expected: AssumptionRef[] }
    export interface PendingSecondary { choice: PickChoice; causeTurnId: string } // 기다리는 덧붙이기와, 그것을 낳은 답의 턴
    export interface Clarification { ask: string; reply: string; leak: boolean }
    ```
  - 마이그레이션 클래스 `InterviewCore1794873600000`(`name` 필드도 같은 값). `down`은 네 테이블을 지운다.
    ```sql
    CREATE TABLE public.interview_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      topic text NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
      panel jsonb NOT NULL,
      question_limit integer NOT NULL CHECK (question_limit BETWEEN 2 AND 30),
      status text NOT NULL CHECK (status IN ('in_progress','finished')),
      user_mentioned jsonb NOT NULL,
      unknown_techs jsonb NOT NULL DEFAULT '[]',
      pending_secondary jsonb,
      memory jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      reviewed_at timestamptz
    );
    CREATE TABLE public.interview_turns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
      seq integer NOT NULL CHECK (seq > 0),
      interviewer_id text NOT NULL,
      add_on boolean NOT NULL DEFAULT false,
      cause_turn_id uuid REFERENCES public.interview_turns(id) ON DELETE SET NULL,
      reaction_intent text,
      defect jsonb,
      target_axis text,
      question jsonb NOT NULL,
      prepared jsonb NOT NULL,
      verification jsonb,
      clarifications jsonb NOT NULL DEFAULT '[]',
      answer text,
      answer_start_ms integer CHECK (answer_start_ms >= 0),
      answered_at timestamptz,
      analysis jsonb,
      pick jsonb,
      surprise text CHECK (surprise IN ('expected','unexpected')),
      review jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_interview_turns_session_seq" UNIQUE (session_id, seq)
    );
    CREATE TABLE public.assumption_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      axis text NOT NULL,
      statement text NOT NULL,
      status text NOT NULL CHECK (status IN ('well','wobbly','wrong')),
      encounters jsonb NOT NULL,
      last_seen_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX "IDX_assumption_records_axis" ON public.assumption_records (axis);
    -- session_id에 FK를 두지 않는다. 면접을 시작하다 실패한 호출도 과금되므로, 세션 행이 없어도 사용량은 남아야 한다.
    CREATE TABLE public.llm_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL,
      call_role text NOT NULL,
      model text NOT NULL,
      input_tokens integer NOT NULL CHECK (input_tokens >= 0),
      output_tokens integer NOT NULL CHECK (output_tokens >= 0),
      fallback boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX "IDX_llm_usage_session" ON public.llm_usage (session_id);
    ```
  - `cause_turn_id`는 이 질문의 반응 의도와 결함을 낳은 답이 있는 턴이다. 첫 질문은 null이다. 복기가 "이 답 뒤에 온 반응"을 찾을 때 쓴다. 덧붙이는 질문은 바로 앞 턴이 아니라 그 앞 턴의 답에서 나오므로, 순서만으로는 짝을 지을 수 없다.
  - 엔티티 필드(TS 이름 → 타입). 컬럼 이름은 위 SQL의 snake_case다.
    - `InterviewSession`: `id: string`, `topic: string`, `panel: PanelMember[]`, `questionLimit: number`, `status: 'in_progress' | 'finished'`, `userMentioned: string[]`, `unknownTechs: string[]`, `pendingSecondary: PendingSecondary | null`, `memory: QuestionMemory`, `createdAt: Date`, `finishedAt: Date | null`, `reviewedAt: Date | null`
    - `InterviewTurn`: `id`, `sessionId: string`, `seq: number`, `interviewerId: string`, `addOn: boolean`, `causeTurnId: string | null`, `reactionIntent: ReactionIntentId | null`, `defect: Defect | null`, `targetAxis: AxisId | null`, `question: Question`, `prepared: { flags: PreparedQuestion['flags']; answerKeyCorrected: boolean; attempts: PreparedQuestion['attempts'] }`, `verification: Verification | null`, `clarifications: Clarification[]`, `answer: string | null`, `answerStartMs: number | null`, `answeredAt: Date | null`, `analysis: Analysis | null`, `pick: Pick | null`, `surprise: 'expected' | 'unexpected' | null`, `review: unknown`(Task 10에서 `TurnReview | null`로 좁힌다), `createdAt: Date`
    - `AssumptionRecord`: `id`, `axis: AxisId`, `statement: string`, `status: 'well' | 'wobbly' | 'wrong'`, `encounters: { sessionId: string; turnId: string; topic: string; result: 'well' | 'wobbly' | 'wrong'; surprise: 'expected' | 'unexpected' | null; at: string }[]`, `lastSeenAt: Date`, `createdAt: Date`
    - `LlmUsage`: `id`, `sessionId`, `callRole: string`, `model: string`, `inputTokens: number`, `outputTokens: number`, `fallback: boolean`, `createdAt: Date`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/schema.e2e-spec.ts — 리포지토리는 app.get(DataSource).getRepository(엔티티)로 꺼낸다(아직 forFeature로 등록한 모듈이 없다). beforeEach에서 resetDb
it('세션과 턴을 저장하고 jsonb를 그대로 읽는다', async () => {
  const s = await sessions.save(sessions.create({ topic: 'Redis', panel, questionLimit: 6,
    status: 'in_progress', userMentioned: ['Redis'], unknownTechs: [], pendingSecondary: null,
    memory: { retired: [], reissue: [], expected: [] } }));
  const t = await turns.save(turns.create({ sessionId: s.id, seq: 1, interviewerId: 'p1', question,
    prepared: { flags: { leak: false, premise: false }, answerKeyCorrected: false, attempts: [] } }));
  const read = await turns.findOneByOrFail({ id: t.id });
  expect(read.question.answerKey.keyPoints).toEqual(question.answerKey.keyPoints);
  expect(read.clarifications).toEqual([]);
  expect(read.addOn).toBe(false);
  expect(read.causeTurnId).toBeNull();
});
it('정한 id로 세션을 insert할 수 있다', async () => { /* sessions.insert({ id: randomUUID(), … }) → findOneBy 성공 */ });
it('같은 세션에 같은 seq를 두 번 넣지 못한다', async () => { /* rejects */ });
it('세션을 지우면 턴이 함께 지워진다', async () => { /* count 0 */ });
it('세션 행이 없는 session_id로도 사용량을 넣을 수 있다', async () => { /* insert 성공 */ });
it('status가 목록 밖이거나 question_limit이 1이면 거절된다', async () => { /* rejects 둘 */ });
it('update는 준 컬럼만 바꾼다', async () => { /* turns.update(id, { answer: 'a' }) 뒤 verification 등 다른 컬럼 불변 */ });
```

- [ ] **Step 2: 실패를 확인한다.** 실행: `npm.cmd run test:e2e`. 기대: 테이블이 없어 FAIL.
- [ ] **Step 3: 마이그레이션과 엔티티를 쓴다.**
- [ ] **Step 4: 통과와 되돌리기를 확인한다.** 실행: `npm.cmd run test:e2e`. 기대: 통과. 이어서 개발 DB에서 `npm.cmd run migration:run` → `npm.cmd run migration:revert` → `npm.cmd run migration:run`이 모두 오류 없이 끝난다.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 면접 스키마와 엔티티"`

### Task 3: 사용량 기록

계획 1은 응답을 만든 시도의 토큰만 리포트에 실었다. 폴백으로 거절된 시도와 오류로 끝난 턴의 사용량이 빠졌다(`docs/r1-review.md` 4장, 10장). 여기서 호출마다 DB에 남긴다.

**Files:**
- Create: `src/interview/llm/usage-recorder.ts`, `src/usage/usage.service.ts`, `src/usage/usage.module.ts`
- Modify: `src/interview/llm/llm.service.ts`, `src/interview/engine.module.ts`, `src/app.module.ts`
- Test: `src/interview/llm/usage-recorder.spec.ts`, `src/interview/llm/llm.service.spec.ts`(추가·수정), `test/usage.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2의 `LlmUsage`
- Produces
  ```ts
  // src/interview/llm/usage-recorder.ts
  export interface UsageRow { role: CallRole; model: string; input_tokens: number; output_tokens: number; fallback: boolean }
  export type UsageSink = (sessionId: string, rows: UsageRow[]) => void;
  @Injectable() export class UsageRecorder {
    setSink(sink: UsageSink): void;
    run<T>(sessionId: string, fn: () => Promise<T>): Promise<T>; // AsyncLocalStorage로 sessionId를 건다
    record(rows: UsageRow[]): void; // 걸린 sessionId와 sink가 모두 있으면 넘긴다. 없으면 아무것도 하지 않는다
  }
  // src/interview/llm/llm.service.ts
  export function usageRows(role: CallRole, res: { model: string; usage: { input_tokens: number; output_tokens: number; iterations?: unknown } }): UsageRow[];
  // src/usage/usage.service.ts
  @Injectable() export class UsageService implements OnModuleInit {
    summarize(sessionId: string): Promise<{ role: string; model: string; inputTokens: number; outputTokens: number; calls: number; fallbacks: number }[]>;
    flush(): Promise<void>; // 진행 중인 넣기가 끝날 때까지 기다린다(테스트와 종료 때 쓴다)
  }
  ```
- `usageRows` 규칙: `usage.iterations`가 비어 있지 않은 배열이면, `type`이 `message` 또는 `fallback_message`인 항목마다 한 줄을 만든다(그 항목의 `input_tokens`, `output_tokens`, `model`. 항목의 `model`이 없거나 null이면 응답의 `model`). `fallback`은 `type === 'fallback_message'`다. 그 밖에는 최상위 usage로 한 줄을 만든다. 둘을 함께 세지 않으므로 겹치지 않고, 거절된 시도도 한 번씩 센다. SDK의 `BetaUsage.iterations`와 `BetaFallbackMessageIterationUsage` 주석(`node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts`)을 읽고 맞춘다.
- `LlmService.callJson`은 응답을 받으면 `stop_reason`을 보기 전에 `recorder.record(usageRows(req.role, res))`를 부른다. 거절이나 `max_tokens`로 끝난 호출도 과금되기 때문이다. 반환 모양은 바꾸지 않는다. 기존 `// shortcut:` 주석(최상위 usage만 센다)은 지운다.
- `UsageService.onModuleInit`이 `recorder.setSink`로 `llm_usage`에 넣는 함수를 건다. 넣다가 난 오류는 로그만 남기고 삼킨다. 사용량 기록 실패가 면접을 멈추면 안 되기 때문이다.
- `UsageRecorder`는 `EngineModule`의 provider이자 export다. R1 실행기처럼 sink가 없는 곳에서는 기록이 버려진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// usage-recorder.spec.ts
it('run 안에서 부른 record만 sink로 간다', async () => {
  const seen: [string, UsageRow[]][] = [];
  const r = new UsageRecorder();
  r.setSink((id, rows) => seen.push([id, rows]));
  r.record([row]);                                   // 컨텍스트 없음: 버린다
  await r.run('s1', async () => { await Promise.resolve(); r.record([row]); });
  expect(seen).toEqual([['s1', [row]]]);
});
it('run 안에서 시작해 기다리지 않은 작업의 record도 같은 세션으로 간다', async () => { /* setTimeout 뒤 record */ });
it('동시에 도는 두 run이 서로 섞이지 않는다', async () => { /* s1, s2 */ });

// llm.service.spec.ts에 추가
it('iterations가 없으면 최상위 usage 한 줄', () => {
  expect(usageRows('analyze', { model: 'm', usage: { input_tokens: 3, output_tokens: 2, iterations: null } }))
    .toEqual([{ role: 'analyze', model: 'm', input_tokens: 3, output_tokens: 2, fallback: false }]);
});
it('거절된 시도와 폴백 응답을 각각 한 줄로 센다', () => {
  const rows = usageRows('question', { model: 'b', usage: { input_tokens: 9, output_tokens: 9, iterations: [
    { type: 'message', model: 'a', input_tokens: 5, output_tokens: 1 },
    { type: 'fallback_message', model: 'b', input_tokens: 5, output_tokens: 4 } ] } });
  expect(rows.map((r) => [r.model, r.input_tokens, r.output_tokens, r.fallback]))
    .toEqual([['a', 5, 1, false], ['b', 5, 4, true]]);
});
it('항목의 model이 null이면 응답의 model을 쓴다', () => { /* 'b' */ });
it('message도 fallback_message도 아닌 항목은 세지 않는다', () => { /* type: 'compaction' */ });
it('거절로 끝난 호출도 기록한 뒤에 RefusalError를 던진다', async () => { /* record 호출 확인 */ });
```

```ts
// test/usage.e2e-spec.ts
it('run 안의 호출이 llm_usage에 남고 summarize가 역할별로 합친다', async () => {
  await recorder.run(sessionId, () => llm.callJson({ role: 'leak', system: 's', user: 'u', schema: { required: ['techs'] } }));
  await usage.flush();
  expect(await usage.summarize(sessionId)).toEqual([
    { role: 'leak', model: 'fake-model', inputTokens: 10, outputTokens: 5, calls: 1, fallbacks: 0 } ]);
});
```

- [ ] **Step 2: 실패를 확인한다.** 실행: `npm.cmd test -- usage-recorder`. 기대: FAIL.
- [ ] **Step 3: 구현한다.** `UsageRecorder`는 `node:async_hooks`의 `AsyncLocalStorage`를 쓴다. `record`는 sink가 끝나기를 기다리지 않는다. 기존 `llm.service.spec.ts`의 테스트 모듈을 만드는 도우미(`make()`)에 `UsageRecorder` provider를 더한다. `LlmService`가 이것을 주입받게 되어, 더하지 않으면 기존 테스트가 의존성을 풀지 못한다. 기존 단언은 바꾸지 않는다.
- [ ] **Step 4: 통과를 확인한다.** 실행: `npm.cmd test`, `npm.cmd run test:e2e`, `npm.cmd run typecheck`, `npm.cmd run lint`.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 호출별 사용량을 DB에 남긴다"`

### Task 4: 엔진 넓히기 (기억 입력, 모른다고 한 기술, 덧붙이기, 사후 검증)

**Files:**
- Modify: `src/interview/types.ts`, `src/interview/naming.ts`, `src/interview/calls/question.call.ts`, `src/interview/turn.service.ts`, `scripts/r1/run.ts`
- Test: `src/interview/naming.spec.ts`, `src/interview/calls/question.call.spec.ts`, `src/interview/turn.service.spec.ts`, `scripts/r1/run.spec.ts`, `scripts/r1/report.spec.ts`(추가·수정)

**Interfaces:**
- Consumes: Task 2의 `QuestionMemory`
- Produces
  ```ts
  // types.ts — QuestionInput의 새 필드는 선택이라 기존 호출은 그대로 돈다
  export interface QuestionInput { /* 기존 필드 */ avoidTechs?: string[]; addOn?: boolean; memory?: QuestionMemory }
  export interface NamingResult { ok: boolean; violations: string[]; avoided: string[] } // avoided는 violations의 부분집합
  export interface AnswerResult { /* 기존 필드 */ unknownTechs: string[] } // 걸러 낸 뒤의 목록
  // naming.ts
  export function checkNaming(input: { techs: TechMention[]; userMentioned: string[]; avoid?: string[] }): NamingResult;
  // turn.service.ts
  verifyLate(input: { topic: string; question: Question }): Promise<{ verification: Verification; usage: TokenUsage }>;
  ```
- 규칙
  1. `checkNaming`: `avoid`에 든 기술(대소문자·앞뒤 공백을 맞춰 비교)은 역할이 `premise`나 `user`여도 위반이다. 그 이름을 `violations`와 `avoided`에 넣는다. 돌려주는 이름은 지금처럼 앞뒤 공백을 뗀 것이다. 나머지 규칙은 그대로다.
  2. `prepareQuestion`: `checkNaming`에 `avoid: input.avoidTechs`를 넘긴다. 재생성 피드백은 둘로 나눈다. `avoided`에 든 이름은 `지원자가 모른다고 해서 질문에 다시 넣으면 안 되는 기술: <이름들>`, 나머지 위반은 기존 문장 `해답으로 꺼내면 안 되는 기술: <이름들>`이다. 해당 이름이 없는 문장은 붙이지 않는다.
  3. `handleAnswer`: 걸러 낸 `unknownTechs`를 결과에 싣는다. 모름 경로의 메모에서 마지막 문장("받는 말에 이름만 넣어도 …")을 지운다. 피드백 문장이 모름 경로를 직접 말하게 됐기 때문이다. 두 `// shortcut:` 주석 가운데 "여러 턴에 걸쳐 기억" 줄은 지운다(세션이 맡는다).
  4. `verifyLate`: `verifyAnswerKey`를 부르고 결과를 돌려준다. R1 실행기(`scripts/r1/run.ts`)는 지금처럼 `verifyAnswerKey`를 직접 부른다(테스트를 덜 고치기 위해 그대로 둔다). 실행기는 후속 질문을 만들 때 `avoidTechs: answered.unknownTechs`만 더 넘긴다.
  5. 질문 프롬프트(`buildQuestionPrompt`)
     - user 메시지에 `input.memory`가 있고 세 목록 중 하나라도 비어 있지 않으면 `기억(이전 면접들에서 만난 가정):` 절을 넣는다. 항목은 `<축 id> <축 이름>: <문장>` 꼴이다.
       - `retired` → `- 다시 내지 않는 가정(이미 잘 답했다): …`
       - `reissue` → `- 다시 낼 수 있는 가정(흔들렸거나 틀렸다): …` 뒤에 "이번 주제와 자연스럽게 이어지는 것이 있으면 그 가운데 하나를 다른 기술 조합에 끼워 낸다. 이어지지 않으면 쓰지 않는다."
       - `expected` → `- 지원자가 예상했던 가정: …` 뒤에 "비슷한 가정은 뻔하므로 새 가정을 고를 때 피한다."
       - 비어 있는 목록의 줄은 넣지 않는다.
     - `input.avoidTechs`가 비어 있지 않으면 `지원자가 모른다고 한 기술(질문에 다시 넣지 않는다. 전제로도 쓰지 않는다): <이름들>` 줄을 "지원자가 지금까지 말한 기술" 줄 다음에 넣는다.
     - `input.addOn`이 참이면 `이번 질문:` 절에 `- 덧붙이는 질문이다. "저도 하나 덧붙이면"처럼 시작한다. 아래 결함은 바로 앞 답변이 아니라 그 앞의 답변(대화 목록의 끝에서 두 번째)에서 나왔다.` 줄을 넣는다.
     - 시스템 프롬프트의 "저장 매체를 바꾸는 가정은 내지 않고 다른 원인을 고른다"는 문장은 **여기서 지우지 않는다.** 기억이 실제로 연결되는 Task 11에서 지운다(D8). A부의 실제 한 판에는 기억이 비어 있어, 지금 지우면 그 가정을 막는 것이 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// naming.spec.ts
it('모른다고 한 기술은 전제여도 위반이고 avoided에 든다', () => {
  expect(checkNaming({ techs: [{ name: 'memcached ', role: 'premise' }], userMentioned: ['Redis'], avoid: ['Memcached'] }))
    .toEqual({ ok: false, violations: ['memcached'], avoided: ['memcached'] });
});
it('지원자가 말한 기술이어도 avoid에 있으면 위반이다', () => { /* role: 'user' */ });
it('avoid가 없으면 avoided는 빈 배열이다', () => { /* 기존 사례에 avoided: [] */ });

// question.call.spec.ts
it('기억의 세 목록을 축 이름과 함께 싣고, 빈 목록의 줄은 넣지 않는다', () => {
  const { user } = buildQuestionPrompt({ ...base, memory: {
    retired: [{ axis: 'durability', statement: '쓰기가 재시작 뒤에도 남아야 한다' }], reissue: [], expected: [] } });
  expect(user).toContain('다시 내지 않는 가정');
  expect(user).toContain('durability 영속성·전달 보장: 쓰기가 재시작 뒤에도 남아야 한다');
  expect(user).not.toContain('다시 낼 수 있는 가정');
});
it('기억이 없거나 모두 비면 기억 절이 없다', () => { /* not.toContain('기억(') */ });
it('모른다고 한 기술 줄과 덧붙이는 질문 줄을 넣는다', () => { /* avoidTechs, addOn */ });

// turn.service.spec.ts
it('모른다고 한 기술이 전제로 나오면 버리고, 모름용 피드백으로 다시 만든다', async () => {
  // leak: 1차 [{ name: 'Memcached', role: 'premise' }], 2차 []
  const r = await turn.prepareQuestion({ ...input('durability'), avoidTechs: ['Memcached'] });
  expect(r.attempts).toHaveLength(2);
  expect(secondQuestionCall.user).toContain('지원자가 모른다고 해서 질문에 다시 넣으면 안 되는 기술: Memcached');
  expect(secondQuestionCall.user).not.toContain('해답으로 꺼내면 안 되는 기술');
});
it('handleAnswer는 걸러 낸 unknownTechs를 돌려준다', async () => { /* ['Memcached'], 이미 말한 기술이면 [] */ });
it('verifyLate는 검증 결과와 사용량을 돌려준다', async () => { /* verify 호출 1회 */ });
```

- [ ] **Step 2: 실패를 확인한다.** 실행: `npm.cmd test -- naming question.call turn.service`. 기대: 새 테스트 FAIL.
- [ ] **Step 3: 구현하고, 타입이 바뀌어 깨지는 기존 테스트를 고친다.** 고칠 곳은 이것뿐이다. 그 밖의 단언과 입력값은 바꾸지 않는다.
  - `NamingResult`를 통째로 비교하거나 픽스처로 쓰는 곳에 `avoided: []`를 더한다. `naming.spec.ts`, `turn.service.spec.ts`, `scripts/r1/report.spec.ts`에서 `naming:`과 `violations`를 찾아 고친다.
  - `scripts/r1/run.spec.ts`의 `AnswerResult` 픽스처에 `unknownTechs: []`를 더한다.
- [ ] **Step 4: 두 프롬프트를 처음부터 끝까지 다시 읽는다.** 새 줄이 다른 문장과 부딪히지 않는지 본다. 특히 "전제 기술이면 지원자가 말한 적 없어도 꺼낼 수 있다"와 "모른다고 한 기술은 전제로도 쓰지 않는다"가 함께 있을 때 뒤쪽이 그 기술에 한한 예외로 읽히는지 확인한다.
- [ ] **Step 5: 통과를 확인한다.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`.
- [ ] **Step 6: 커밋.** `git commit -m "feat: 엔진에 기억 입력과 모름 기술 금지, 덧붙이기, 사후 검증을 더한다"`

### Task 5: 되묻기 응답과 직무 고르기

**Files:**
- Create: `src/interview/calls/clarify.call.ts`, `src/interview/calls/job-role.call.ts`
- Modify: `src/interview/turn.service.ts`, `src/interview/types.ts`
- Test: `src/interview/calls/clarify.call.spec.ts`, `src/interview/calls/job-role.call.spec.ts`, `src/interview/turn.service.spec.ts`(추가)

**Interfaces:**
- Consumes: 계획 1의 `REQUIRED_RULES`, `detectTechs`, `ROLES`. Task 4의 `checkNaming`
- Produces
  ```ts
  // types.ts
  export type JobRoleId = 'dba' | 'security' | 'architect';
  export interface ClarifyInput {
    topic: string; interviewer: PanelMember; question: Question;
    questionTechs: TechMention[];                 // 그 질문에서 검출된 기술(prepared.attempts의 마지막 항목의 techs. 없으면 [])
    exchanges: { ask: string; reply: string }[];  // 이 질문에서 앞서 주고받은 되묻기
    ask: string; userMentioned: string[]; avoidTechs: string[];
  }
  export interface ClarifyResult { reply: string; leak: boolean; usage: TokenUsage[] }
  // calls/clarify.call.ts
  export const CLARIFY_SCHEMA: { type: 'object'; additionalProperties: false; required: ['reply']; properties: { reply: { type: 'string' } } };
  export function buildClarifyPrompt(input: ClarifyInput & { feedback: string[] }): { system: string; user: string };
  export function answerClarification(llm: JsonLlm, input: ClarifyInput & { feedback: string[] }): Promise<{ data: { reply: string }; usage: TokenUsage }>;
  // calls/job-role.call.ts
  export const JOB_ROLE_SCHEMA: { type: 'object'; additionalProperties: false; required: ['role']; properties: { role: { type: 'string'; enum: ['dba', 'security', 'architect'] } } };
  export function pickJobRole(llm: JsonLlm, topic: string): Promise<{ data: { role: JobRoleId }; usage: TokenUsage }>;
  // turn.service.ts
  replyToClarification(input: ClarifyInput): Promise<ClarifyResult>;
  pickJobRole(topic: string): Promise<{ role: JobRoleId; usage: TokenUsage }>;
  ```
- 호출 역할: 되묻기 응답은 `question`, 직무 고르기는 `analyze`의 모델·effort 설정을 쓴다. 여기서는 `CallRole`을 늘리지 않는다.
- 되묻기 프롬프트가 담을 것(설계 6.2-2): 같은 면접관이 답한다. 질문의 범위와 조건까지만 답한다. 질문 의도, 기대하는 답, 힌트는 말하지 않는다. 성향과 상관없이 같은 방식이다. 한두 문장이다. `REQUIRED_RULES`를 그대로 싣는다. user 메시지에는 질문 문장, 바뀐 가정 문장(있으면), 앞선 되묻기, 이번 되묻기를 준다. **정답지와 질문 의도는 주지 않는다.** 범위를 답하는 데 필요 없고, 주면 새어 나갈 수 있기 때문이다.
- `replyToClarification`: 응답을 만든 뒤 `detectTechs`로 응답 문장의 기술을 뽑는다. 응답은 새 가정을 세우지 않으므로 `premise`는 `solution`으로 바꿔 본다. 허용 이름은 `userMentioned`에 `questionTechs`의 이름을 더한 것이다(질문에 이미 나온 기술은 다시 말해도 흘림이 아니다). `checkNaming`에 `avoid: avoidTechs`를 넘긴다. 위반이면 Task 4와 같은 피드백 문장으로 다시 만들고, 시도는 `1 + maxRegenerations`번까지다. 끝까지 위반이면 마지막 응답과 `leak: true`를 돌려준다(P11).
- 직무 프롬프트: 세 직무의 이름, 주로 바꾸는 축, 주로 확인하는 의도를 `ROLES`에서 만들어 싣고, 주제와 가장 잘 맞는 직무 하나를 고르게 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// clarify.call.spec.ts
it('정답지와 질문 의도를 프롬프트에 싣지 않는다', () => {
  const { system, user } = buildClarifyPrompt(input);
  for (const hidden of [...input.question.answerKey.keyPoints, input.question.answerKey.alternatives[0].name]) {
    expect(system + user).not.toContain(hidden);
  }
  expect(user).not.toContain(`${input.question.questionIntent} `);
  expect(user).toContain(input.question.text);
  expect(user).toContain(input.ask);
});
it('기술 이름 규칙 문장을 그대로 싣는다', () => { /* REQUIRED_RULES의 모든 줄 */ });
it('앞선 되묻기를 순서대로 싣는다', () => { /* exchanges 2개 */ });

// job-role.call.spec.ts
it('스키마의 enum이 직무형 역할 셋과 같다', () => { /* ROLES에서 type === 'job'인 id */ });
it('세 직무의 축 이름을 프롬프트에 싣는다', () => { /* '영속성·전달 보장', '공격', '기술 대체' */ });

// turn.service.spec.ts
it('되묻기 응답이 질문에 나온 전제 기술을 다시 말해도 통과한다', async () => {
  // leak: [{ name: 'Memcached', role: 'premise' }], questionTechs에 Memcached(premise)
  expect((await turn.replyToClarification(clarify)).leak).toBe(false);
});
it('되묻기 응답이 새 기술을 꺼내면 다시 만들고, 끝까지 남으면 leak true', async () => { /* clarify 호출 2회, leak true */ });
it('되묻기 응답이 모른다고 한 기술을 말하면 위반이다', async () => { /* avoidTechs, 피드백 문장 */ });
```

- [ ] **Step 2~4:** 실패 확인(`npm.cmd test -- clarify job-role turn.service`) → 구현 → `npm.cmd test`, `typecheck`, `lint` 통과.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 되묻기 응답과 직무 고르기 호출"`

### Task 6: 진행 규칙 (순수 함수)과 면접 설정

**Files:**
- Create: `src/session/session-rules.ts`, `src/config/interview.config.ts`
- Modify: `.env.example`, `src/app.module.ts`(`load`에 `interviewConfig` 추가)
- Test: `src/session/session-rules.spec.ts`, `src/config/interview.config.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `PendingSecondary`, Task 5의 `JobRoleId`
- Produces
  ```ts
  // src/config/interview.config.ts
  export interface InterviewConfig { questionLimit: number; reissueAfterHours: number }
  export function readInterviewConfig(env: NodeJS.ProcessEnv): InterviewConfig; // INTERVIEW_QUESTION_LIMIT(기본 6, 2~30), MEMORY_REISSUE_AFTER_HOURS(기본 24, 양의 정수). 빈 문자열은 설정 안 함. 틀리면 변수 이름으로 던진다
  export const interviewConfig = registerAs('interview', () => readInterviewConfig(process.env));
  // src/session/session-rules.ts
  export function composePanel(jobRole: JobRoleId, rng: () => number): PanelMember[];
  export function pickOpener(panel: PanelMember[], rng: () => number): PanelMember;
  export function chooseTargetAxis(s: { nextSeq: number; questionLimit: number; assumptionAxes: (AxisId | 'none')[] }): AxisId | null;
  // 여기서 Pick은 TS의 유틸리티 타입이 아니라 src/interview/types.ts의 인터페이스다
  export function nextAsker(input: { lastTurnId: string; pick: Pick; pending: PendingSecondary | null }):
    { choice: PickChoice; addOn: boolean; causeTurnId: string; pending: PendingSecondary | null };
  export const CLOSING_TEXT = '준비한 질문은 여기까지입니다. 수고하셨습니다.';
  ```
- 규칙
  - `composePanel`: id는 `p1`, `p2`, `p3`, 직무는 차례로 `[jobRole, 'textbook', 'scenario']`. 성향은 `['persistent', 'helper', 'shaker']`를 `rng`로 섞어(Fisher–Yates) 하나씩 준다.
  - `pickOpener`: `panel[Math.floor(rng() * panel.length)]`. 마무리도 이 면접관이 한다.
  - `chooseTargetAxis`: `nextSeq === 1`이면 `null`(첫 질문은 기본 질문이어도 된다). `assumptionAxes`에 `'none'`이 아닌 값이 하나도 없고 `nextSeq > Math.ceil(questionLimit / 2)`이면 `'identity_swap'`. 그 밖에는 `null`.
  - `nextAsker`(P4): `input.pick`은 방금 답의 분석에서 나온 것이고 `lastTurnId`는 그 답이 있는 턴이다.
    - `pending`이 있고, 방금 답이 오답 의심도 아니고(`pick.defect.type !== 'wrong'`) 모른다는 답도 아니면(`pick.reactionIntent !== 'B11'`): 기다리던 덧붙이기를 쓴다. `{ choice: pending.choice, addOn: true, causeTurnId: pending.causeTurnId, pending: null }`. 방금 답의 `pick`은 다음 질문자 선택에 쓰지 않는다.
    - 그 밖에는 방금 답에 반응한다. `{ choice: pick의 앞부분(interviewerId, defect, reactionIntent), addOn: false, causeTurnId: lastTurnId, pending: pick.secondary ? { choice: pick.secondary, causeTurnId: lastTurnId } : null }`. 기다리던 덧붙이기가 있었으면 버린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('패널은 직무형·교과형·시나리오형이고 성향 셋이 한 번씩 나온다', () => {
  const panel = composePanel('security', () => 0.42);
  expect(panel.map((m) => [m.id, m.role])).toEqual([['p1', 'security'], ['p2', 'textbook'], ['p3', 'scenario']]);
  expect(panel.map((m) => m.temperament).sort()).toEqual(['helper', 'persistent', 'shaker']);
});
it('rng가 다르면 성향 배정이 달라진다', () => { /* () => 0 과 () => 0.99 */ });
it('첫 질문에는 축을 지정하지 않는다', () => {
  expect(chooseTargetAxis({ nextSeq: 1, questionLimit: 6, assumptionAxes: [] })).toBeNull();
});
it('절반을 넘도록 가정 변경이 없으면 정체성 비교 축을 지정한다', () => {
  expect(chooseTargetAxis({ nextSeq: 3, questionLimit: 6, assumptionAxes: ['none', 'none'] })).toBeNull();
  expect(chooseTargetAxis({ nextSeq: 4, questionLimit: 6, assumptionAxes: ['none', 'none', 'none'] })).toBe('identity_swap');
});
it('가정 변경이 이미 있었으면 지정하지 않는다', () => {
  expect(chooseTargetAxis({ nextSeq: 5, questionLimit: 6, assumptionAxes: ['none', 'scale', 'none', 'none'] })).toBeNull();
});
it('질문 수 상한이 2면 둘째 질문에 지정한다', () => {
  expect(chooseTargetAxis({ nextSeq: 2, questionLimit: 2, assumptionAxes: ['none'] })).toBe('identity_swap');
});
it('덧붙이기가 기다리고 있으면 그것을 쓰고, 그것을 낳은 턴을 원인으로 적는다', () => {
  const r = nextAsker({ lastTurnId: 't2', pick: pickVague, pending: { choice: choiceB, causeTurnId: 't1' } });
  expect(r).toEqual({ choice: choiceB, addOn: true, causeTurnId: 't1', pending: null });
});
it('기다리는 덧붙이기가 있어도 방금 답이 오답 의심이면 그 답에 반응하고 덧붙이기를 버린다', () => {
  const r = nextAsker({ lastTurnId: 't2', pick: pickWrong, pending: { choice: choiceB, causeTurnId: 't1' } });
  expect(r.addOn).toBe(false);
  expect(r.causeTurnId).toBe('t2');
  expect(r.choice.interviewerId).toBe(pickWrong.interviewerId);
});
it('기다리는 덧붙이기가 있어도 방금 답이 모른다는 답(B11)이면 그 답에 반응한다', () => { /* addOn false */ });
it('pick에 secondary가 있으면 primary를 쓰고 secondary를 대기시킨다', () => {
  const r = nextAsker({ lastTurnId: 't1', pick: pickWithSecondary, pending: null });
  expect(r.addOn).toBe(false);
  expect(r.pending).toEqual({ choice: pickWithSecondary.secondary, causeTurnId: 't1' });
});
// interview.config.spec.ts
it('기본값은 질문 6개, 24시간', () => { /* readInterviewConfig({}) */ });
it('질문 수가 2~30 밖이면 변수 이름으로 던진다', () => { /* '1', '31' */ });
```

- [ ] **Step 2~4:** 실패 확인 → 구현 → `npm.cmd test`, `typecheck`, `lint`.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 면접 진행 규칙과 설정"`

### Task 7: 면접 서비스

**Files:**
- Create: `src/session/interview.service.ts`, `src/session/interview.view.ts`, `src/session/session-errors.ts`, `src/session/session.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/session/interview.view.spec.ts`, `test/interview.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 엔티티, Task 3 `UsageRecorder`, Task 4·5 `TurnService`, Task 6 규칙과 `interviewConfig`
- Produces
  ```ts
  // session-errors.ts
  export class NotFoundError extends Error {}                 // 세션이나 턴이 없다
  export type ConflictCode = 'TURN_NOT_OPEN' | 'INTERVIEW_FINISHED' | 'NOTHING_TO_RETRY' | 'INTERVIEW_NOT_FINISHED' | 'NOT_REVIEWABLE'; // 뒤의 둘은 Task 12가 쓴다
  export class ConflictError extends Error { constructor(readonly code: ConflictCode) }
  export type UpstreamReason = 'REFUSAL' | 'MAX_TOKENS' | 'BAD_RESPONSE' | 'API_ERROR';
  export class UpstreamError extends Error { constructor(readonly reason: UpstreamReason, readonly category: string | null) }
  export function toUpstreamError(e: unknown): UpstreamError;
  // interview.view.ts
  export interface PublicTurn { id: string; seq: number; interviewerId: string; addOn: boolean; text: string;
    clarifications: { ask: string; reply: string }[]; answer: string | null }
  export interface InterviewView { id: string; topic: string; status: 'in_progress' | 'finished'; questionLimit: number;
    panel: { id: string; roleName: string }[]; turns: PublicTurn[];
    pending: 'answer' | 'retry' | null; closing: { interviewerId: string; text: string } | null; createdAt: string }
  export function toInterviewView(session: InterviewSession, turns: InterviewTurn[]): InterviewView;
  // interview.service.ts
  export const RNG = Symbol('RNG');                   // () => number. 기본 Math.random, 테스트에서 고정값으로 바꾼다
  export const MEMORY_SOURCE = Symbol('MEMORY_SOURCE');
  export interface MemorySource { snapshot(now: Date): Promise<QuestionMemory> }
  @Injectable() export class InterviewService {
    start(input: { topic: string; questionLimit?: number }): Promise<InterviewView>;
    submitAnswer(sessionId: string, input: { turnId: string; text: string; answerStartMs: number | null }): Promise<InterviewView>;
    advance(sessionId: string): Promise<InterviewView>;   // 실패한 단계를 다시 시도
    finish(sessionId: string): Promise<InterviewView>;    // 사용자가 일찍 끝냄
    getView(sessionId: string): Promise<InterviewView>;
    list(): Promise<{ id: string; topic: string; status: string; createdAt: string; questionCount: number }[]>; // 최근 20개
  }
  ```
- `toUpstreamError`: `RefusalError` → `REFUSAL`(그 `category`를 싣는다). 메시지가 `max_tokens`인 Error → `MAX_TOKENS`. `SyntaxError`이거나 메시지가 "응답에 text 블록이 없다"로 시작하면 → `BAD_RESPONSE`. 그 밖에는 `API_ERROR`. **원래 오류의 메시지는 `UpstreamError`에 싣지 않는다.** 서버 로그에만 남긴다. JSON 파싱 오류의 메시지에는 응답 글자의 일부가 들어가고, 그 응답이 질문과 정답지다.
- `toInterviewView`: 위 타입에 적힌 필드만 고른다. `clarifications`에서 `leak`은 뺀다. `pending`은 끝났으면 `null`, 마지막 턴에 답이 없으면 `'answer'`, 그 밖에는 `'retry'`다. `closing`은 끝났을 때만 `{ interviewerId: turns[0].interviewerId, text: CLOSING_TEXT }`다. `roleName`은 `ROLES[role].name`이다.
- `MEMORY_SOURCE`: A부에서는 빈 목록 셋을 돌려주는 기본 provider를 `SessionModule`에 둔다. Task 11이 실제 구현으로 바꾼다.
- 세션 잠금: `Map<sessionId, Promise>`로 같은 세션의 `submitAnswer`, `advance`, `finish`를 줄 세운다. `// shortcut: 프로세스 하나를 전제한다, 서버를 여러 개 띄우게 되면 DB 잠금으로`.
- `start`
  1. 세션 id를 `randomUUID()`로 먼저 정한다. 모델 호출의 사용량에 세션 id가 필요한데, 세션 행은 첫 질문이 만들어진 뒤에야 넣기 때문이다.
  2. `recorder.run(id, …)` 안에서 `memorySource.snapshot(now)` → `pickJobRole(topic)` → `composePanel` → `pickOpener` → `prepareQuestion`을 차례로 한다. 첫 질문 입력: `reactionIntent: null`, `defect: null`, `targetAxis: null`, `history: []`, `userMentioned: [topic]`, `feedback: []`, `avoidTechs: []`, `addOn: false`, `memory`는 snapshot.
  3. 세션(정한 id로 `insert`. `memory`에 snapshot, `userMentioned: [topic]`)과 첫 턴(`seq: 1`, `causeTurnId: null`)을 한 트랜잭션으로 넣는다. 가정 없는 질문이면 사후 검증을 시작한다(아래 6번과 같다).
  4. `questionLimit`이 없으면 설정값을 쓴다.
  5. 2가 던지면 `toUpstreamError`로 바꿔 던진다. 세션 행은 남지 않고, 그때까지의 사용량은 `llm_usage`에 남는다.
- `submitAnswer`(세션 잠금 안에서): 세션이 끝났으면 `ConflictError('INTERVIEW_FINISHED')`. `turnId`가 마지막 턴이 아니거나 그 턴에 이미 답이 있으면 `ConflictError('TURN_NOT_OPEN')`. 답과 `answeredAt`을 저장한다. `answerStartMs`는 그 턴에 아직 값이 없을 때만 저장한다(되묻기 뒤의 재입력이 첫 입력 시간을 덮어쓰지 않게). 저장한 다음 아래 본체를 돈다.
- `advance`(세션 잠금 안에서): 아래 본체를 돈다. 본체가 할 일이 없었으면(1번에서 끝남) `ConflictError('NOTHING_TO_RETRY')`.
- **본체** (`recorder.run(sessionId, …)` 안에서. 단계마다 DB에서 다시 읽은 값으로 판단한다)
  1. 세션이 끝났거나 마지막 턴에 답이 없으면 끝낸다.
  2. 마지막 턴에 `analysis`가 없으면 분석한다.
     - 사후 검증을 먼저 맞춘다. 그 질문이 가정 없는 질문(`assumption.axis === 'none'`)이고 `verification`이 없으면: 진행 중인 사후 검증(6번의 Map)이 있으면 끝날 때까지 기다린 뒤 턴을 다시 읽는다. 그래도 `verification`이 없으면 `verifyLate`를 지금 돌리고 `applyLateVerification`으로 반영한다.
     - `handleAnswer`를 부른다. `question`은 방금 다시 읽은 턴의 것(고친 정답지 포함), `history`는 지금까지 턴의 `interviewerId` 목록, `userMentioned`는 세션 값이다.
     - 한 트랜잭션으로 저장한다: 턴의 `analysis`와 `pick`, 세션의 `userMentioned`와 `unknownTechs`(기존 값과 결과의 합집합). 되묻기(`analysis.kind === 'clarify'`)여도 `analysis`를 저장한다. 3번이 실패했을 때 같은 입력을 다시 분석하지 않기 위해서다.
  3. 마지막 턴의 `analysis.kind`가 `'clarify'`면 되묻기에 답한다. `replyToClarification`을 부르고(`ask`는 턴의 `answer`, `exchanges`는 턴의 `clarifications`), 턴을 한 번의 `update`로 고친다: `clarifications`에 `{ ask, reply, leak }`를 더하고 `answer`, `answeredAt`, `analysis`, `pick`을 비운다. 그리고 끝낸다(사용자의 답을 다시 기다린다).
  4. 턴 수가 `questionLimit`에 닿았으면 세션을 `finished`로 바꾸고(`finishedAt`) 끝낸다.
  5. 다음 질문을 만든다. `nextAsker({ lastTurnId, pick, pending: session.pendingSecondary })`의 결과는 아직 저장하지 않는다. `chooseTargetAxis`로 축을 정하고 `prepareQuestion`을 부른다. 입력은 다음과 같다.
     - `interviewer`: 패널에서 `choice.interviewerId`인 사람
     - `reactionIntent: choice.reactionIntent`, `defect: choice.defect`, `addOn`
     - `targetAxis`: `chooseTargetAxis({ nextSeq, questionLimit, assumptionAxes: 지금까지 턴들의 question.assumption.axis })`
     - `history`: 답이 있는 턴들의 `{ interviewerId, text, answer }`. 되묻기가 있던 턴의 `text`에는 `\n(되묻기) 지원자: … / 면접관: …` 줄을 붙인다.
     - `userMentioned: session.userMentioned`, `avoidTechs: session.unknownTechs`, `memory: session.memory`, `feedback: []`
  6. 한 트랜잭션으로 저장한다: 새 턴 insert(`seq`, `interviewerId`, `addOn`, `causeTurnId`, `reactionIntent`, `defect`, `targetAxis`, `question`, `prepared`, `verification`)와 세션의 `pendingSecondary`(5번 결과의 `pending`). 질문 생성이 실패하면 `pendingSecondary`가 바뀌지 않아야, 다시 시도했을 때 같은 질문자가 나온다. 새 질문이 가정 없는 질문이면 `verifyLate`를 기다리지 않고 시작해 `Map<turnId, Promise>`에 둔다. 끝나면 `applyLateVerification`으로 반영하고 맵에서 지운다. 실패하면 로그만 남긴다(다음 답 때 2번이 다시 돌린다).
  - 2~5의 모델 호출이 던지면 `toUpstreamError`로 바꿔 던진다. 그때까지 저장한 것은 그대로 둔다.
- `applyLateVerification(turnId, verification)`: `verification` 컬럼을 쓰고, `verification.problems`가 있으면 `question`(정답지를 고친 것으로 바꾼 객체)과 `prepared`(`answerKeyCorrected: true`)도 함께 쓴다. 준 컬럼만 `update`한다. 사후 검증 결과를 반영하는 곳은 이 함수 하나다.
- `finish`(세션 잠금 안에서): 세션을 `finished`로 바꾼다(`finishedAt`). 이미 끝났으면 그대로 돌려준다. 마지막 턴에 답이나 분석이 없어도 된다. 그런 턴은 복기에서 빠진다(P18).
- 알려진 한계: 되묻기에 답하고 나면 같은 턴이 다시 열린다. 그래서 같은 되묻기를 연달아 두 번 보내면 둘 다 처리된다. 화면이 보내는 동안 입력을 잠가 막는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// interview.view.spec.ts — turnWithEverything은 모든 컬럼을 채운 턴이다
it('뷰의 키는 타입에 적힌 것뿐이다 (Review Focus 1)', () => {
  const v = toInterviewView(session, [turnWithEverything]);
  expect(Object.keys(v).sort()).toEqual(['closing', 'createdAt', 'id', 'panel', 'pending', 'questionLimit', 'status', 'topic', 'turns']);
  expect(Object.keys(v.turns[0]).sort()).toEqual(['addOn', 'answer', 'clarifications', 'id', 'interviewerId', 'seq', 'text']);
  expect(Object.keys(v.turns[0].clarifications[0]).sort()).toEqual(['ask', 'reply']);
  expect(Object.keys(v.panel[0]).sort()).toEqual(['id', 'roleName']);
});
it('숨긴 값이 뷰의 어디에도 없다 (Review Focus 1)', () => {
  const json = JSON.stringify(toInterviewView(session, [turnWithEverything]));
  const q = turnWithEverything.question;
  for (const hidden of [q.answerKey.keyPoints[0], q.answerKey.alternatives[0].name, q.assumption.statement,
    turnWithEverything.defect.note, turnWithEverything.analysis.defects[0].note, '집요형', '조력형', '흔드는형']) {
    expect(json).not.toContain(hidden);
  }
  expect(json).toContain(q.text);
});
it('pending은 답을 기다리면 answer, 답 뒤 단계가 빠졌으면 retry, 끝났으면 null', () => { /* 세 경우 */ });
```

```ts
// test/interview.e2e-spec.ts — createTestApp(fake, [{ provide: RNG, useValue: () => 0 }]). beforeEach에서 resetDb
it('시작하면 직무를 고르고 첫 질문을 만든다', async () => {
  fake.on('jobRole', { role: 'architect' });
  const v = await service.start({ topic: 'Redis' });
  expect(v.panel.map((p) => p.roleName)).toEqual(['아키텍트', '교과형', '시나리오형']);
  expect(v.turns).toHaveLength(1);
  expect(v.pending).toBe('answer');
  expect(v.questionLimit).toBe(6);
});
it('답하면 분석하고 다음 질문을 만든다. 새 턴의 cause_turn_id는 답한 턴이다', async () => { /* turns 2개 */ });
it('둘째 질문의 프롬프트에 세션의 기억과 지금까지 말한 기술이 실린다', async () => {
  // MEMORY_SOURCE를 retired 1개를 주는 가짜로 바꾼 앱에서
  expect(userOf(lastCall('question'))).toContain('기억(');
});
it('되묻기면 같은 턴에 응답을 붙이고 답을 다시 기다린다', async () => {
  fake.once('analyze', { kind: 'clarify', defects: [], mentionedTechs: [], unknownTechs: [] });
  const v = await service.submitAnswer(id, { turnId, text: '읽기 위주인가요?', answerStartMs: 1200 });
  expect(v.turns).toHaveLength(1);
  expect(v.turns[0].clarifications).toEqual([{ ask: '읽기 위주인가요?', reply: expect.any(String) }]);
  expect(v.turns[0].answer).toBeNull();
  expect(v.pending).toBe('answer');
});
it('되묻기 뒤의 답이 첫 입력 시간을 덮어쓰지 않는다', async () => { /* DB의 answer_start_ms === 1200 */ });
it('되묻기 응답 호출이 실패하면, 다시 시도할 때 분석을 다시 하지 않는다 (Review Focus 2)', async () => {
  fake.once('analyze', { kind: 'clarify', defects: [], mentionedTechs: [], unknownTechs: [] });
  fake.once('clarify', new Error('boom'));
  await expect(service.submitAnswer(id, ask)).rejects.toBeInstanceOf(UpstreamError);
  await service.advance(id);
  expect(fake.calls.filter((c) => c.kind === 'analyze')).toHaveLength(1);
});
it('되묻기 응답에 흘림이 남으면 응답은 보여 주고 leak을 DB에 남긴다', async () => { /* DB clarifications[0].leak === true, 뷰에는 leak 키 없음 */ });
it('분석이 실패하면 답은 남고, advance가 이어 간다 (Review Focus 2)', async () => {
  fake.once('analyze', new Error('boom'));
  await expect(service.submitAnswer(id, answer)).rejects.toBeInstanceOf(UpstreamError);
  expect((await service.getView(id)).pending).toBe('retry');
  const v = await service.advance(id);
  expect(v.turns).toHaveLength(2);
  expect(fake.calls.filter((c) => c.kind === 'analyze')).toHaveLength(2); // 실패 1 + 성공 1
});
it('질문 생성이 실패하면 분석은 남고, advance는 분석을 다시 하지 않는다 (Review Focus 2)', async () => { /* analyze 호출 1회, 턴 2개 */ });
it('secondary가 있는 답 뒤에 질문 생성이 한 번 실패해도, 다시 시도하면 primary가 먼저 묻는다', async () => {
  // analyze → secondary가 있는 pick이 나오게, question 1회 Error
  await expect(service.submitAnswer(id, answer)).rejects.toBeInstanceOf(UpstreamError);
  const v = await service.advance(id);
  expect(v.turns[1].addOn).toBe(false);
  // 다음 답 뒤의 seq 3은 addOn true이고 cause_turn_id는 seq 1의 턴이다
});
it('이미 답한 턴에 온 답은 TURN_NOT_OPEN이고 상태가 그대로다 (Review Focus 3)', async () => { /* rejects, 턴 수 불변 */ });
it('동시에 온 같은 답 둘 중 하나만 받고, 모델 호출이 겹치지 않는다 (Review Focus 3)', async () => {
  const results = await Promise.allSettled([service.submitAnswer(id, answer), service.submitAnswer(id, answer)]);
  const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  expect(rejected).toHaveLength(1);
  expect((rejected[0].reason as ConflictError).code).toBe('TURN_NOT_OPEN');
  expect(fake.calls.filter((c) => c.kind === 'analyze')).toHaveLength(1);
  expect(fake.calls.filter((c) => c.kind === 'question')).toHaveLength(2); // 첫 질문 + 다음 질문
});
it('질문을 만드는 사이에 온 finish는 줄을 서고, 끝난 뒤 턴이 늘지 않는다', async () => {
  // question 호출을 풀어 주기 전에 finish를 부른다 → 둘 다 끝난 뒤 status finished, 그 뒤 턴 수 불변
});
it('앱을 다시 띄워도 이어 간다. 끝나지 않은 사후 검증은 답할 때 다시 돈다 (Review Focus 4)', async () => {
  // 가정 없는 첫 질문 → verify가 끝나지 않게(끝나지 않는 Promise) 한 뒤 app.close(), 새 app으로 submitAnswer
  // 기대: 새 app에서 verify 호출이 analyze 호출보다 먼저 있고, 다음 질문이 만들어진다
});
it('사후 검증이 정답지를 고치면 분석은 고친 정답지를 받고, DB에 고친 정답지가 남는다', async () => { /* analyze params.user에 고친 keyPoint, prepared.answerKeyCorrected true */ });
it('백그라운드 사후 검증이 끝난 뒤 답을 저장해도 검증 결과가 지워지지 않는다', async () => { /* verification 컬럼 유지 */ });
it('덧붙이기: secondary가 있으면 다음 질문 뒤에 두 번째 면접관이 addOn으로 묻는다', async () => { /* seq 3이 addOn true, 그 질문 프롬프트에 "덧붙이는 질문" */ });
it('덧붙이기가 기다리는데 지원자가 모른다고 하면 덧붙이기를 버리고 같은 면접관이 넘어간다', async () => { /* seq 3 addOn false, reaction_intent B11 */ });
it('모른다고 한 기술은 세션에 쌓여 이후 질문의 avoidTechs로 간다', async () => { /* question params.user에 모른다고 한 기술 줄 */ });
it('절반을 넘도록 가정 변경이 없으면 정체성 비교 축을 지정한다', async () => { /* question params.user에 identity_swap */ });
it('질문 수 상한에 닿으면 마지막 답을 분석하고 끝낸다', async () => { /* questionLimit 2: status finished, closing 있음, 턴 2개 */ });
it('끝난 면접에 온 답은 INTERVIEW_FINISHED', async () => { /* rejects */ });
it('finish는 답이 없는 턴이 있어도 끝낸다', async () => { /* status finished */ });
it('호출 사용량이 세션에 남는다(시작 전 호출 포함)', async () => { /* summarize에 jobRole의 analyze, question, leak */ });
it('시작이 실패하면 세션은 남지 않고 사용량은 남는다', async () => { /* question 호출 Error → sessions count 0, llm_usage 1줄 */ });
it('모델이 깨진 JSON을 주면 BAD_RESPONSE이고 오류에 응답 글자가 없다 (Review Focus 1)', async () => {
  fake.once('question', rawText('{"answerKey":{"keyPoints":["비밀-핵심-7731"'));
  const e = await service.start({ topic: 'Redis' }).catch((x) => x);
  expect(e).toBeInstanceOf(UpstreamError);
  expect(e.reason).toBe('BAD_RESPONSE');
  expect(e.message).not.toContain('7731');
});
```

- [ ] **Step 2: 실패를 확인한다.** 실행: `npm.cmd run test:e2e`. 기대: `InterviewService`가 없어 FAIL.
- [ ] **Step 3: 구현한다.** 리포지토리는 `@InjectRepository`로 받는다. Global Constraints의 "DB 쓰기" 규칙을 따른다.
- [ ] **Step 4: 통과를 확인한다.** 실행: `npm.cmd test`, `npm.cmd run test:e2e`, `npm.cmd run typecheck`, `npm.cmd run lint`.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 면접 서비스"`

### Task 8: HTTP API

**Files:**
- Create: `src/session/interview-input.ts`, `src/session/interview.controller.ts`, `src/http/http-error.filter.ts`, `src/http/input-error.ts`
- Modify: `src/session/session.module.ts`, `src/configure-app.ts`(필터 등록)
- Test: `src/session/interview-input.spec.ts`, `test/interview-http.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 7 `InterviewService`와 오류 클래스
- Produces
  ```ts
  // src/http/input-error.ts
  export interface InputIssue { field: string; reason: 'REQUIRED' | 'MUST_BE_OBJECT' | 'MUST_BE_STRING' | 'MUST_BE_INTEGER' | 'OUT_OF_RANGE' | 'TOO_LONG' | 'EMPTY' | 'UNEXPECTED_FIELD' | 'MUST_BE_UUID' | 'NOT_ALLOWED' }
  export class InputError extends Error { constructor(readonly issues: InputIssue[]) }
  // src/session/interview-input.ts
  export function parseStartInput(body: unknown): { topic: string; questionLimit?: number };
  export function parseAnswerInput(body: unknown): { turnId: string; text: string; answerStartMs: number | null };
  export function parseId(value: string, field: string): string; // uuid가 아니면 InputError
  ```
- 검증 값: `topic`은 앞뒤 공백을 뗀 뒤 1~200자. `questionLimit`은 2~30의 정수(없어도 됨). `text`는 앞뒤 공백을 뗀 뒤 1~20,000자. `answerStartMs`는 0 이상의 정수 또는 null(없으면 null). `turnId`는 uuid. 모르는 필드가 있으면 `UNEXPECTED_FIELD`.
- 경로(모두 `/v1` 아래, 응답은 JSON)

  | 메서드와 경로 | 본문 | 성공 |
  |---|---|---|
  | `POST /interviews` | `{ topic, questionLimit? }` | 201 `InterviewView` |
  | `GET /interviews` | | 200 목록 |
  | `GET /interviews/:id` | | 200 `InterviewView` |
  | `POST /interviews/:id/answers` | `{ turnId, text, answerStartMs }` | 200 `InterviewView` |
  | `POST /interviews/:id/advance` | | 200 `InterviewView` |
  | `POST /interviews/:id/finish` | | 200 `InterviewView` |

- 오류 응답(`HttpErrorFilter`, 전역): `InputError` → 400 `{ error: 'INVALID_INPUT', issues }`. `NotFoundError` → 404 `{ error: 'NOT_FOUND' }`. `ConflictError` → 409 `{ error: <code> }`. `UpstreamError` → 502 `{ error: 'LLM_FAILED', reason, category }`. Nest의 `HttpException`은 그 상태 코드 그대로. 그 밖에는 500 `{ error: 'INTERNAL' }`이고 서버 로그에 스택을 남긴다. 응답 본문에 오류 메시지, 스택, 환경 값을 넣지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// interview-input.spec.ts
it('공백만 있는 답은 EMPTY', () => {
  expect(issuesOf(() => parseAnswerInput({ turnId: uuid, text: '   ', answerStartMs: null })))
    .toEqual([{ field: 'text', reason: 'EMPTY' }]);
});
it('2만 자를 넘는 답은 TOO_LONG', () => { /* 'a'.repeat(20001) */ });
it('answerStartMs가 음수나 소수면 거절', () => { /* OUT_OF_RANGE, MUST_BE_INTEGER */ });
it('모르는 필드는 UNEXPECTED_FIELD', () => { /* { topic: 'Redis', role: 'dba' } */ });
it('주제는 앞뒤 공백을 떼고 200자까지', () => { /* '  Redis ' → 'Redis', 201자 TOO_LONG */ });
it('질문 수는 2~30', () => { /* 1과 31은 OUT_OF_RANGE */ });
it('본문이 객체가 아니면 MUST_BE_OBJECT', () => { /* null, 'x', [] */ });
```

```ts
// test/interview-http.e2e-spec.ts
it('면접 중의 모든 응답 본문에 숨긴 값이 없다 (Review Focus 1)', async () => {
  // fake의 question 응답에 표식이 든 값을 넣는다: keyPoints ['비밀-핵심-7731'], assumption.statement '비밀-가정-7732',
  // analyze의 defect note '비밀-메모-7733'
  const bodies = [
    (await request(server).post('/v1/interviews').send({ topic: 'Redis' }).expect(201)).text,
    (await request(server).post(`/v1/interviews/${id}/answers`).send(answer).expect(200)).text,
    (await request(server).get(`/v1/interviews/${id}`).expect(200)).text,
    (await request(server).get('/v1/interviews').expect(200)).text,
  ];
  for (const body of bodies) for (const mark of ['7731', '7732', '7733', '집요형', '조력형', '흔드는형']) {
    expect(body).not.toContain(mark);
  }
});
it('모델이 깨진 JSON을 주면 502이고 본문에 응답 글자가 없다 (Review Focus 1)', async () => {
  fake.once('question', rawText('{"answerKey":{"keyPoints":["비밀-핵심-7731"'));
  const res = await request(server).post('/v1/interviews').send({ topic: 'Redis' }).expect(502);
  expect(res.body).toEqual({ error: 'LLM_FAILED', reason: 'BAD_RESPONSE', category: null });
});
it('잘못된 입력은 400이고 모델을 부르지 않는다', async () => {
  await request(server).post('/v1/interviews').send({ topic: '' }).expect(400);
  expect(fake.calls).toHaveLength(0);
});
it('없는 면접은 404, uuid가 아닌 id는 400', async () => { /* 두 경우 */ });
it('같은 답을 두 번 보내면 두 번째는 409 TURN_NOT_OPEN (Review Focus 3)', async () => { /* 본문 error */ });
it('모델 실패는 502 LLM_FAILED API_ERROR이고, advance로 이어 간다 (Review Focus 2)', async () => { /* 502 → POST advance 200 */ });
it('할 일이 없는 advance는 409 NOTHING_TO_RETRY', async () => { /* 답을 기다리는 상태에서 */ });
it('500 응답에 메시지와 스택이 없다', async () => { /* 서비스가 Error('내부-9911')을 던지게 하고 본문이 { error: 'INTERNAL' }뿐인지 */ });
```

- [ ] **Step 2~4:** 실패 확인(`npm.cmd run test:e2e`) → 구현 → `npm.cmd test`, `test:e2e`, `typecheck`, `lint`.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 면접 HTTP API"`

### Task 9: 화면 — 시작과 면접

**Files:**
- Modify: `package.json`(프런트 의존성과 scripts), `eslint.config.mjs`(프런트 블록), `.gitignore`, `src/configure-app.ts`(정적 파일)
- Create: `frontend/index.html`, `frontend/vite.config.ts`, `frontend/test.mjs`, `frontend/tsconfig.json`, `frontend/tsconfig.test.json`, `frontend/web/tsconfig.json`
- Create: `frontend/web/main.tsx`, `frontend/web/api.ts`, `frontend/web/styles/globals.css`
- Create: `frontend/web/components/app.tsx`, `start-screen.tsx`, `interview-screen.tsx`
- Create: `frontend/web/lib/decode.ts`, `frontend/web/lib/first-input-timer.ts`, `frontend/web/lib/api-error.ts`
- Create: `scripts/run-fake-app.ts`
- Test: `frontend/web/lib/decode.test.ts`, `frontend/web/lib/first-input-timer.test.ts`, `frontend/web/lib/api-error.test.ts`

**Interfaces:**
- Consumes: Task 8의 경로와 `InterviewView` 모양
- Produces
  - npm scripts(BlueGang과 같은 이름): `frontend:typecheck`(`tsc --noEmit -p frontend/tsconfig.json && tsc --noEmit -p frontend/web/tsconfig.json`. npm이 자기 shell로 돌리므로 scripts 안의 `&&`는 된다), `frontend:lint`, `frontend:test`(`node frontend/test.mjs`), `frontend:build`(`vite build --config frontend/vite.config.ts --logLevel warn`), `frontend:verify`(넷을 차례로), `start:app`(프런트 빌드 뒤 `nest start`), `start:fake`(프런트 빌드 뒤 `ts-node scripts/run-fake-app.ts`)
  - `frontend/vite.config.ts`: BlueGang과 같은 모양이다(`root: frontend`, `plugins: [tailwindcss()]`, 별칭 `@` → `frontend/web`, `build.outDir: frontend/dist`). dev 서버와 proxy는 두지 않는다.
  - 테스트 설정은 BlueGang의 세 파일을 옮긴다. `frontend/tsconfig.json`은 DOM 없이 순수 로직을 보는 설정이고 `include`를 `["web/lib/**/*.ts"]`로 둔다(BlueGang은 `src/**/*.ts`). `frontend/tsconfig.test.json`은 그것을 `extends`해 `frontend/.test`에 CommonJS로 컴파일한다. `frontend/test.mjs`는 그 컴파일 뒤 `node --test`로 `web/lib`의 `*.test.js`를 돌린다(BlueGang의 `test`, `src` 폴더 항목은 뺀다). `web/lib`의 파일은 DOM을 쓰지 않고, 서로를 BlueGang의 lib 파일과 같은 방식(확장자 표기)으로 import한다.
  - `src/configure-app.ts`: `app.useStaticAssets(join(process.cwd(), 'frontend', 'dist'))`를 더한다. API 경로는 `/v1` 아래라 정적 파일과 겹치지 않는다.
  - `frontend/web/lib/decode.ts`: `decodeInterviewView(v: unknown): InterviewView`, `decodeInterviewList(v: unknown): InterviewListItem[]`. 모양이 다르면 던진다. 타입은 이 파일에 둔다(서버의 `interview.view.ts`와 같은 모양을 손으로 맞춘다. `// shortcut: 서버 타입을 손으로 옮겼다, 필드가 자주 바뀌면 공유 타입 폴더로`).
  - `frontend/web/lib/first-input-timer.ts`
    ```ts
    export function createFirstInputTimer(now: () => number): {
      shown(): void;            // 새 질문이 화면에 나온 시점. 측정을 새로 시작한다
      input(): void;            // 입력 이벤트. 첫 번째만 기록한다
      value(): number | null;   // shown부터 첫 input까지의 ms. 입력이 없었으면 null
    };
    ```
  - `frontend/web/lib/api-error.ts`: `class ApiError extends Error { status: number; code: string }`, `describeApiError(e: unknown): { text: string; reload: boolean }`. `text`는 사용자에게 보일 문장, `reload`는 뷰를 다시 읽어야 하는지다.

    | code | text | reload |
    |---|---|---|
    | `LLM_FAILED` | 면접관의 응답을 받지 못했습니다. 다시 시도해 주세요. | false |
    | `TURN_NOT_OPEN` | 이미 답한 질문입니다. 화면을 새로 고칩니다. | true |
    | `NOTHING_TO_RETRY` | 이미 진행됐습니다. 화면을 새로 고칩니다. | true |
    | `INTERVIEW_FINISHED` | 끝난 면접입니다. | true |
    | `INVALID_INPUT` | 입력을 확인해 주세요. | false |
    | `NOT_FOUND` | 면접을 찾을 수 없습니다. | false |
    | 그 밖 | 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요. | false |
  - `frontend/web/api.ts`: `startInterview(topic, questionLimit?)`, `getInterview(id)`, `listInterviews()`, `sendAnswer(id, turnId, text, answerStartMs)`, `advance(id)`, `finish(id)`. 상대 경로 `/v1/...`로 `fetch`하고(`cache: 'no-store'`), `!ok`면 본문의 `error`를 읽어 `ApiError`를 던진다. 자동 재시도는 하지 않는다. 다시 보내면 과금이 한 번 더 일어날 수 있어서 사용자가 버튼으로 정한다.
  - `scripts/run-fake-app.ts`: 과금 없이 화면을 띄운다. 순서가 중요하다.
    1. `compose.e2e.yaml`로 임시 DB를 띄우고 포트를 읽는다(`run-e2e.ts`와 같은 방식).
    2. `process.env`에 `NODE_ENV=test`, `DB_*`(e2e 값), `PORT=3199`, `ANTHROPIC_BASE_URL=http://127.0.0.1:9`, `ANTHROPIC_API_KEY=e2e-not-a-key`를 건다. `DB_DATABASE`가 `interview_e2e`가 아니면 시작하지 않는다.
    3. 마이그레이션을 돌린다.
    4. **그다음에** `await import('../test/support/test-app')`로 앱 코드를 불러온다. `AppModule`은 import되는 순간 환경을 읽어 굳히므로, 파일 위쪽에서 정적으로 import하면 개발 DB에 붙는다.
    5. `createTestApp(createFakeAnthropic())`으로 만든 앱을 `127.0.0.1:3199`에 연다. 가짜 질문 문장은 호출마다 번호를 붙여 달라 보이게 한다.
    6. Ctrl+C로 끝내면 DB를 지운다.

**화면이 하는 일**
- `app.tsx`: 화면 상태는 `{ screen: 'start' } | { screen: 'interview'; id } | { screen: 'review'; id }`다. 라우터를 쓰지 않는다. 면접 중인 id는 `location.hash`에도 적어 새로고침해도 돌아온다.
- 시작 화면: 주제 입력(자유 입력, 예시는 placeholder로), 질문 수 선택(`기본값`, 4, 6, 8, 10. `기본값`을 고르면 `questionLimit`을 보내지 않아 서버 설정값이 쓰인다), "면접 시작" 버튼(요청이 도는 동안은 누를 수 없다. 두 번 누르면 과금도 두 번이다), 최근 면접 목록(주제, 날짜, 상태. 진행 중이면 "이어 하기", 끝났으면 "복기 보기"). 시작을 기다리는 동안 "면접관을 모으고 첫 질문을 준비하고 있습니다. 1분쯤 걸릴 수 있습니다."를 보여 준다.
- 면접 화면
  - 위에 패널 세 명의 직무 이름. 성향은 보이지 않는다.
  - 대화: 질문마다 누가 물었는지, 덧붙이는 질문이면 "덧붙이는 질문" 표시, 되묻기 주고받은 말, 내 답.
  - 입력: textarea와 "보내기". 입력 위에 안내 한 줄 "답 첫머리에 질문의 의도를 한 줄로 짚어 보세요. 조건이 궁금하면 되물어도 됩니다."(설계 6.2-2)
  - 보내는 동안: 입력과 버튼을 잠그고 "면접관이 답을 듣고 있습니다…"를 보여 준다. 가짜 진행률은 만들지 않는다.
  - 실패: `describeApiError`의 문장과 "다시 시도" 버튼(`advance`). `reload`가 참이면 뷰를 다시 읽는다. `pending === 'retry'`로 돌아온 화면에도 같은 버튼을 보여 준다.
  - 답 시작 시간: 질문이 새로 나올 때 `shown()`, textarea의 `input` 이벤트에서 `input()`, 보낼 때 `value()`를 함께 보낸다.
  - "여기서 끝내기" 버튼(확인 한 번).
  - 끝나면 마무리 문장과 "복기 보기" 버튼. B부 전에는 이 버튼을 누르면 "복기는 아직 준비 중입니다"를 보여 준다(동작하는 것처럼 보이게 하지 않는다).
- 스타일: `globals.css`는 `@import "tailwindcss";`와 색 변수 몇 개만 둔다. 글꼴은 시스템 글꼴 스택이다. 버튼과 입력은 최소 높이 44px, 입력 글자 16px. 좁은 화면(760px 이하)에서도 한 열로 읽힌다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// first-input-timer.test.ts — node:test
void test('첫 입력까지의 시간만 잰다', () => {
  let t = 1000; const timer = createFirstInputTimer(() => t);
  timer.shown(); t = 1850; timer.input(); t = 5000; timer.input();
  assert.equal(timer.value(), 850);
});
void test('입력이 없었으면 null', () => { /* shown만 */ });
void test('새 질문이 나오면 다시 잰다', () => { /* shown → input → shown → value() === null */ });
void test('shown 전에 온 입력은 세지 않는다', () => { /* value() === null */ });

// decode.test.ts
void test('면접 뷰를 그대로 통과시킨다', () => { /* 정상 모양 */ });
void test('turns가 배열이 아니면 던진다', () => { /* assert.throws */ });
void test('모르는 status면 던진다', () => { /* assert.throws */ });

// api-error.test.ts
void test('LLM_FAILED는 다시 시도 안내이고 reload는 false', () => { /* describeApiError */ });
void test('TURN_NOT_OPEN과 NOTHING_TO_RETRY는 reload true', () => { /* 둘 */ });
void test('ApiError가 아닌 오류는 일반 문장', () => { /* new Error('x') */ });
```

- [ ] **Step 2: 실패를 확인한다.** 실행: `npm.cmd run frontend:test`. 기대: 모듈이 없어 FAIL.
- [ ] **Step 3: 프런트 의존성과 설정을 넣는다.** `react`, `react-dom`, `@types/react`, `@types/react-dom`, `vite`, `tailwindcss`, `@tailwindcss/vite`를 devDependencies에 넣는다. `eslint.config.mjs`의 프런트 블록과 `frontend:lint`의 글롭은 BlueGang의 것을 옮기되 `frontend/src`, `frontend/test` 항목은 뺀다.
- [ ] **Step 4: lib, api, 화면을 만든다.**
- [ ] **Step 5: 과금 없이 화면을 확인한다.** 실행: `npm.cmd run start:fake`(백그라운드). 브라우저에서 `http://127.0.0.1:3199`를 열어 확인한다: 주제 입력 → 시작 → 질문이 보임 → 답 → 다음 질문 → 상한에서 마무리 문장. 새로고침해도 같은 면접으로 돌아온다. 화면 폭 375px에서 가로 스크롤이 없다. 브라우저 콘솔에 오류가 없다. 확인 뒤 프로세스를 끝내고 `docker ps -a --filter name=pressure-interview-e2e`가 비어 있는지 본다.
- [ ] **Step 6: 전체 확인.** 실행: `npm.cmd run frontend:verify`, `npm.cmd test`, `npm.cmd run test:e2e`, `npm.cmd run typecheck`, `npm.cmd run lint`.
- [ ] **Step 7: 커밋.** `git commit -m "feat: 시작 화면과 면접 화면"`

## 체크포인트 A: 실제로 한 판 (구현 아님, 사용자 승인 필요)

- [ ] 사용자에게 알린다: 실제 API로 한 판을 하면 과금된다. 참고로 R1 확인 실행(질문 5개 준비, 답 4개 분석, 지원자 답 생성 4회)이 약 $1.52였다(리포트 토큰에 가격표를 곱한 계산값). 질문 수 6의 한 판은 그보다 많을 수 있고, 써 보기 전에는 알 수 없다.
- [ ] 승인을 받으면 `docker compose up -d --wait db`, `npm.cmd run migration:run`, `npm.cmd run start:app`으로 띄우고 주소(`http://127.0.0.1:3110`)를 준다. 면접은 사용자가 직접 한다.
- [ ] 끝난 뒤 `llm_usage`를 합쳐 호출 수와 토큰을 알린다(`UsageService.summarize`).
- [ ] 사용자의 판단을 `docs/a-review.md`에 [결정]으로 적는다. 볼 것:
  - 면접관이 내가 말하지 않은 대안 기술이나 그 특징을 흘리지 않았나(F2, D9. 리포트가 없어졌으므로 여기서 사람이 본다)
  - 모른다고 했을 때 면접관이 그 기술의 이름을 다시 말하지 않고 넘어가는가(`docs/r1-review.md` 9장의 미확인 항목)
  - 질문 수 6이 맞는가, 대기 시간이 견딜 만한가
  - 덧붙이기의 "번갈아" 방식이 자연스러운가, 되묻기 응답이 범위와 조건만 말하는가
  - 안내 문구
- [ ] 고칠 것이 있으면 B부 전에 고친다. 프롬프트나 규칙을 바꿨으면 그 테스트도 함께 바꾼다.

---

## 체크포인트 A 뒤의 변경 (2026-11-17)

체크포인트 A의 기록과 사용자 [결정]은 [`docs/a-review.md`](../a-review.md)에 있다. 그 결정으로 A부의 구현이 아래처럼 바뀌었다. 이 절은 Task 4·5·7의 해당 설명보다 우선하고, B부의 태스크는 이 절의 인터페이스를 쓴다.

### Task A1: 한 질문에서 묻는 수 (`9e1c6cc`, `1b7e2d2`)

- **[결정]** 질문은 한 번에 최대 두 가지를 묻는다. 웬만하면 하나만 묻는다.
- `REQUIRED_RULES`의 "질문은 한 번에 하나만 한다. 질문 의도는 말하지 않는다." 줄을 둘로 나누고, 앞 줄을 "한 질문에서 묻는 것은 하나다. 꼭 이어서 물어야 할 때만 둘까지 묻고, 셋 이상은 묻지 않는다."로 바꿨다. 이유 문단을 질문 프롬프트에 더했다.
- [제안] 물음 수는 프롬프트 규칙으로만 지키고 코드로 세지 않는다. 물음표나 어미로 세면 부정확하고, 다시 만들면 대기가 더 늘기 때문이다.

### Task A2: 정답지를 질문 뒤에서 만든다 (`5e1f28b`, `45bf313`)

- **[결정]** `docs/a-review.md` 6장의 A(정답지를 질문 뒤로 미루기)와 B(검증이 고친 부분만 내기)를 B부보다 먼저 한다. effort는 medium으로 내린다.
- [제안] effort의 범위는 질문 생성(`question`)과 검증(`verify`) 두 역할로 읽었다. 분석(medium)과 흘림 검사(low)는 그대로이고, Task 10의 복기 역할(`review`)은 P10대로 high다.

**바뀐 흐름**

1. 질문 호출은 질문 문장, 질문 의도, 바뀐 가정만 쓴다. 정답지는 쓰지 않는다.
2. 흘림 검사와 이름 검사는 그대로다. 가정을 바꾼 질문은 보여 주기 전에 전제만 짧게 검사한다(`checkPremise`). 전제가 틀리면 다시 만든다. 설계 6.2-6을 지키는 곳이 여기다.
3. 질문을 저장하고 화면에 낸다. 턴의 `question.answerKey`는 null이다.
4. 뒤에서 정답지를 쓰고(`writeAnswerKey`) 검증한다(`verifyAnswerKey`). 가정이 있든 없든 모든 질문에 한다. 검증은 문제 목록과 고친 필드만 출력하고, 코드가 원래 정답지에 반영한다(`applyCorrections`). 화면에 나간 뒤의 검증에서 전제가 틀렸다고 나와도 질문은 다시 만들지 않고 `verification`에 남긴다.
5. 답이 오면 분석 전에 정답지를 맞춘다. 뒤 작업이 돌고 있으면 기다리고, 실패했거나 서버가 다시 떴으면 그때 만든다. 이때 실패하면 답은 저장된 채 `UpstreamError`가 나가고 `advance`가 정답지 만들기부터 이어 간다.

**인터페이스 (Task 4·7의 것을 대체)**

```ts
// src/interview/types.ts
export interface QuestionDraft { text: string; questionIntent: QuestionIntentId; assumption: { axis: AxisId | 'none'; statement: string } }
export interface Question extends QuestionDraft { answerKey: AnswerKey }
export type StoredQuestion = QuestionDraft & { answerKey: AnswerKey | null };   // 턴의 question 컬럼
export interface PremiseCheck { premiseOk: boolean; problems: { field: 'text' | 'statement'; problem: string }[] }
export interface PreparedDraft {
  draft: QuestionDraft; premise: PremiseCheck | null;
  flags: { leak: boolean; premise: boolean };            // premise는 보여 주기 전 전제 검사의 결과만 뜻한다
  attempts: { draft: QuestionDraft; naming: NamingResult; premise: PremiseCheck | null; techs: TechMention[] }[];
  usage: TokenUsage[];
}
export interface AnswerKeyInput { topic; interviewer; reactionIntent; defect; addOn?; history; draft: QuestionDraft }
export interface CompletedQuestion { question: Question; verification: Verification; answerKeyCorrected: boolean; usage: TokenUsage[] }
// ClarifyInput.question은 QuestionDraft다. AnswerInput.question은 Question 그대로다.

// src/interview/turn.service.ts
prepareDraft(input: QuestionInput): Promise<PreparedDraft>;
completeQuestion(input: AnswerKeyInput): Promise<CompletedQuestion>;

// src/interview/calls
writeAnswerKey(llm, input: AnswerKeyInput)                    // answer-key.call.ts, 역할 'question'
checkPremise(llm, { topic, draft })                           // premise.call.ts, 역할 'verify'
verifyAnswerKey(llm, { topic, question }): Promise<{ data: Verification; corrected: boolean; usage: TokenUsage }>
applyCorrections(key: AnswerKey, corrections: Corrections): AnswerKey
```

- 없어진 것: `TurnService.prepareQuestion`, `TurnService.verifyLate`, `PreparedQuestion`, 세션의 사후 검증 시작과 반영(`startLateVerification`, `applyLateVerification`). R1 실행기는 `prepareDraft` → 저장 → `completeQuestion`을 직접 부른다.
- `REQUIRED_RULES`는 11줄이다. "숨은 정답지는 정확해야 한다…" 줄은 정답지 프롬프트로 옮겼다. 질문 호출과 되묻기 호출이 정답지를 쓰지 않기 때문이다.
- 기본 effort: `question`과 `verify`가 medium이다(`src/config/engine.config.ts`, `.env.example`).
- 가짜 Anthropic 클라이언트의 호출 종류에 `answerKey`와 `premise`가 더해졌다.

**B부가 맞춰야 할 것**

- 턴의 `question`은 `StoredQuestion`이다. 복기 대상 턴(답이 있고 분석이 `answer`인 턴)은 분석 전에 정답지를 맞추므로 정답지가 있다. `ReviewInput.question`과 `ReviewTurnView.answerKey`를 만들 때 타입을 좁히고, null이면 오류를 던진다(면접 서비스의 분석과 같은 처리).
- `verification`은 뒤 작업이 끝난 모든 질문에 있다. Task 12의 `premiseFlag` 규칙(`prepared.flags.premise`이거나 `verification.premiseOk`가 false)은 그대로 쓴다.
- `prepared.attempts`의 항목은 `{ draft, naming, premise, techs }`다. 2026-11-17 이전에 끝난 면접의 행은 예전 모양(`question`, `verification`)으로 남아 있다. 복기는 `attempts`를 읽지 않는다.
- 복기 e2e는 면접을 끝낸 뒤 `InterviewService.settle()`로 뒤 작업을 끝내고 시작한다. 답하지 않은 마지막 턴의 정답지 작성이 아직 돌고 있을 수 있기 때문이다.
- Task 11이 질문 프롬프트에서 빼는 "저장 매체 가정" 문장은 그대로 질문 프롬프트에 있다.

**확인한 범위**: 단위 테스트 196개, e2e 64개(임시 PostgreSQL, 가짜 모델 응답), typecheck, lint, 가짜 응답 앱으로 화면 한 판. 실제 모델로는 돌리지 않았다. 대기가 얼마나 줄었는지와 medium에서의 질문·정답지 품질은 다음 유료 실행에서 잰다.

---

# B부: 복기, 기억, 추이

### Task 10: 복기 재검사 호출

**Files:**
- Create: `src/interview/calls/review.call.ts`
- Modify: `src/interview/types.ts`, `src/interview/turn.service.ts`, `src/config/engine.config.ts`, `.env.example`, `src/session/interview-turn.entity.ts`(`review: TurnReview | null`), `src/memory/assumption-record.entity.ts`(`AssumptionResult` 사용), `test/support/fake-anthropic.ts`(review 기본 응답의 모양 확인)
- Test: `src/interview/calls/review.call.spec.ts`, `src/interview/turn.service.spec.ts`(추가), `src/config/engine.config.spec.ts`(수정)

**Interfaces:**
- Produces
  ```ts
  // engine.config.ts
  export type CallRole = 'analyze' | 'question' | 'verify' | 'leak' | 'review'; // CALL_ROLES도 다섯. 기본 effort는 review: 'high'
  // .env.example: ENGINE_MODEL_REVIEW=, ENGINE_EFFORT_REVIEW=
  // turn.service.ts
  reviewTurn(input: ReviewInput): Promise<{ review: TurnReview; usage: TokenUsage }>;
  // src/interview/types.ts에 추가 (엔진의 호출이 쓰는 타입이라 엔진 쪽에 둔다)
  export type AssumptionResult = 'well' | 'wobbly' | 'wrong';
  export interface TurnReview {
    intent: { aimed: boolean; note: string };                         // 답이 질문 의도를 향했는가
    defects: { index: number; verdict: 'valid' | 'misjudged'; note: string }[]; // 면접 중 분석의 결함 하나하나
    reactions: { index: number; verdict: 'valid_point' | 'misjudgment' | 'intended_test'; note: string }[]; // 이 답에서 나온 질문 하나하나
    assumption: { result: AssumptionResult | 'none'; note: string; sameAs: string | null; userResult?: AssumptionResult };
    keyProblems: string[];                                            // 복기가 정답지에서 찾은 오류
  }
  export interface ReviewInput {
    topic: string;
    interviewer: PanelMember;
    cause: { reactionIntent: ReactionIntentId | null; defect: Defect | null }; // 이 질문이 나온 까닭
    question: Question;                                               // 고친 정답지가 반영된 것
    clarifications: { ask: string; reply: string }[];
    answer: string;
    analysis: Analysis;                                               // 면접 중 판정
    followUps: { interviewerId: string; addOn: boolean; reactionIntent: ReactionIntentId; defect: Defect; text: string }[]; // 이 답에서 나온 질문들(0~2개)
    knownAssumptions: { key: string; statement: string }[];           // 같은 축의 가정들. key는 기억의 id 또는 'turn:<턴 id>'
  }
  // calls/review.call.ts
  export const REVIEW_SCHEMA: Record<string, unknown>; // required: ['intent','defects','reactions','assumption','keyProblems']
  export function buildReviewPrompt(input: ReviewInput): { system: string; user: string };
  export function reviewTurn(llm: JsonLlm, input: ReviewInput): Promise<{ data: TurnReview; usage: TokenUsage }>;
  ```
- `TurnService.reviewTurn`은 호출 결과를 다듬어 돌려준다. `assumption.sameAs`가 그 호출에 준 `knownAssumptions`의 `key`가 아니면 null로 바꾼다. `defects`의 `index`가 분석의 결함 범위 밖이거나 `reactions`의 `index`가 `followUps` 범위 밖인 항목은 버린다. 모델이 없는 것을 가리켜도 뒤 단계가 흔들리지 않게 한다.
- 프롬프트가 담을 것(설계 7, 8)
  - 이 호출은 면접이 끝난 뒤의 재검사다. 면접 중 판정은 틀릴 수 있고, 여기서 바로잡는다. 틀린 복기는 잘못된 지식을 가르치므로(F4) 확신이 없는 것은 확신이 없다고 적는다.
  - `defects`: 면접 중 분석의 결함마다, 답을 다시 읽고 맞는 지적(`valid`)인지 오판(`misjudged`)인지 가른다. `index`는 분석의 결함 순서(0부터)다. 결함이 없었으면 빈 배열이다.
  - `reactions`: `followUps`의 질문마다 하나씩 가른다(`index`는 0부터). 반응 의도가 확신 시험(B8)이고 답이 맞았는데도 의심을 던진 것이면 `intended_test`(일부러 흔든 것). 답의 실제 결함을 짚은 반응이면 `valid_point`. 답이 맞았는데 틀렸다고 보고 반응한 것이면 `misjudgment`. `followUps`가 없으면 빈 배열이다.
  - `assumption.result`: 가정을 바꾼 질문일 때만 매긴다(아니면 `none`). 답의 내용만으로 가른다. 힌트를 받았는지는 보지 않는다. `well`은 사라지는 차이와 남는 차이의 핵심을 맞게 답함, `wobbly`는 일부만 맞음(핵심 차이 일부 누락), `wrong`은 핵심이 틀림.
  - `assumption.sameAs`: `knownAssumptions` 가운데 이 질문의 가정과 같은 가정이 있으면 그 `key`, 없으면 null. 기술이 달라도 바뀐 것이 같으면 같은 가정이다.
  - `keyProblems`: 정답지에 틀린 내용이 보이면 적는다. 없으면 빈 배열이다.
  - 축과 의도는 `id 이름`으로 싣는다. 이 호출은 숨길 것이 없으므로 기술 이름 규칙을 싣지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// engine.config.spec.ts — 계획 1의 "호출 역할 넷" 단언을 다섯으로 고친다
it('review 역할의 기본값은 claude-opus-5-5, high', () => {
  const c = readEngineConfig({});
  expect(c.models.review).toBe('claude-opus-5-5');
  expect(c.effort.review).toBe('high');
});
// review.call.spec.ts
it('스키마의 verdict와 result 값이 타입과 같다', () => { /* enum 대조 */ });
it('정답지, 답, 면접 중 판정, 이 답에서 나온 질문들을 모두 싣는다', () => { /* user에 keyPoints[0], answer, 결함 note, followUps[0].text, followUps[1].text */ });
it('덧붙이는 질문은 덧붙이기라고 표시해 싣는다', () => { /* addOn true */ });
it('가정 없는 질문이면 result를 none으로 두라고 알린다', () => { /* system */ });
it('같은 축의 가정을 key와 함께 싣는다', () => { /* user에 'turn:t1' */ });
it('이 답에서 나온 질문이 없으면 그 절이 없다', () => { /* followUps [] */ });
// turn.service.spec.ts
it('reviewTurn은 준 적 없는 sameAs를 null로 바꾼다', async () => { /* 'turn:없음' → null */ });
it('reviewTurn은 범위 밖 index의 defects와 reactions를 버린다', async () => { /* index 5 */ });
```

- [ ] **Step 2~4:** 실패 확인 → 구현 → `npm.cmd test`, `typecheck`, `lint`. R1 리포트의 모델 표(`scripts/r1/report.ts`)는 `CALL_ROLES`를 돌며 만들어지므로 review 줄이 하나 늘어난다. 그 테스트가 깨지면 기대값에 줄을 더한다. `npm.cmd run test:e2e`도 돌려 Task 1의 가짜 review 기본 응답이 `REVIEW_SCHEMA`와 같은 모양인지 본다.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 복기 재검사 호출"`

### Task 11: 기억

**Files:**
- Create: `src/memory/memory-rules.ts`, `src/memory/memory.service.ts`, `src/memory/memory.module.ts`
- Modify: `src/session/session.module.ts`(`MEMORY_SOURCE`를 `MemoryService`로), `src/interview/calls/question.call.ts`(저장 매체 문장 삭제)
- Test: `src/memory/memory-rules.spec.ts`, `src/interview/calls/question.call.spec.ts`(추가), `test/memory.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 `AssumptionRecord`, Task 7 `MEMORY_SOURCE`, Task 10 `TurnReview`, `AssumptionResult`
- Produces
  ```ts
  // memory-rules.ts (순수 함수). 여기서 Pick은 TS의 유틸리티 타입이다. 엔진의 Pick 인터페이스를 이 파일에 import하지 않는다
  export interface FoldedAssumption { recordId: string | null; axis: AxisId; statement: string;
    result: AssumptionResult; surprise: 'expected' | 'unexpected' | null; turnIds: string[]; at: string }
  export function foldAssumptions(turns: Pick<InterviewTurn, 'id' | 'seq' | 'question' | 'review' | 'surprise' | 'answeredAt'>[], recordIds: string[]): FoldedAssumption[];
  export function selectMemory(records: AssumptionRecord[], now: Date, reissueAfterHours: number): QuestionMemory;
  export function pendingTopics(records: AssumptionRecord[], now: Date, reissueAfterHours: number): string[];
  // memory.service.ts
  @Injectable() export class MemoryService implements MemorySource {
    snapshot(now: Date): Promise<QuestionMemory>;
    knownForAxis(axis: AxisId): Promise<{ key: string; statement: string }[]>;
    syncSession(sessionId: string): Promise<void>;
    pendingTopics(now: Date): Promise<string[]>;
    all(): Promise<AssumptionRecord[]>;
  }
  ```
- `foldAssumptions(turns, recordIds)`: 가정을 바꾼 질문이고 `review.assumption.result`가 `none`이 아닌 턴만 본다. 턴을 `seq` 순으로 보며 묶는다.
  - `sameAs`가 `turn:<id>`이고 그 턴이 **이미 본**(seq가 더 작은) 묶음에 들어 있으면 그 묶음에 들어간다.
  - `sameAs`가 `recordIds`에 있는 기억 id면 그 id의 묶음에 들어간다.
  - 그 밖(null, 뒤 턴을 가리킴, 없는 id)에는 새 묶음을 만든다.
  - 묶음마다 하나를 돌려준다. `recordId`는 묶음이 가리키는 기억 id(없으면 null), `statement`는 묶음 첫 턴의 가정 문장, `turnIds`는 묶음의 턴 전부, `result`는 **마지막 턴**의 결과(`userResult`가 있으면 그것), `surprise`와 `at`도 마지막 턴의 것이다(`at`은 그 턴의 `answeredAt`을 ISO 문자열로). 설계 8의 "최종적으로 맞게 답했으면 잘 답함"을 이렇게 구현한다.
- `selectMemory`: `retired`는 `status === 'well'`인 기록(최근에 본 순서로 30개까지). `reissue`는 `wobbly`나 `wrong`이고 `lastSeenAt`이 `now`에서 `reissueAfterHours` 이상 지난 기록(마지막 만남이 `unexpected`였던 것을 앞에, 5개까지). `expected`는 마지막 만남의 `surprise`가 `expected`이고 `retired`에도 `reissue`에도 들지 않은 기록(10개까지). 상한은 P16이고 코드에 `// shortcut:` 주석으로 적는다.
- `pendingTopics`: `reissue` 조건을 채우는 기록들의 마지막 만남 `topic`을 중복 없이.
- `syncSession(sessionId)`: 한 트랜잭션에서 한다. **한 번에 하나만 돈다.** `MemoryService` 안의 잠금 하나로 모든 세션의 `syncSession`을 줄 세운다(`// shortcut: 프로세스 하나를 전제한다, 서버를 여러 개 띄우게 되면 pg_advisory_xact_lock으로`). 서로 다른 두 세션이 같은 기록의 `encounters`를 동시에 통째로 바꿔 쓰면 한쪽의 만남이 사라지기 때문이다.
  1. 모든 기록을 읽고, 이 세션의 만남에서 `턴 id → 그 만남이 든 기록 id` 표를 만든다.
  2. 그 세션의 턴으로 `foldAssumptions(turns, 기록 id 전부)`를 한다.
  3. 모든 기록의 `encounters`에서 이 세션의 항목을 뺀다.
  4. 접은 결과마다 들어갈 기록을 정한다: `recordId`가 있으면 그 기록. 없으면 묶음의 `turnIds` 가운데 1의 표에 있는 턴의 기록(앞서 맞췄을 때 들어갔던 기록). 그것도 없으면 새 기록을 만든다. 그 기록에 만남 `{ sessionId, turnId: 마지막 턴, topic, result, surprise, at }`을 더한다.
  5. 만남이 하나도 남지 않은 기록은 지운다.
  6. 남은 기록마다 `encounters`를 `at` 오름차순(같으면 `turnId` 순)으로 정렬해 저장하고, `at`이 가장 늦은 만남을 골라 `status`를 그 `result`로, `lastSeenAt`을 그 `at`으로 맞춘다.
  - 이렇게 하면 같은 세션을 여러 번 맞춰도 기록의 id와 내용(만남의 순서 포함)이 같다. 두 세션이 합류한 기록에서도 같다. 결과를 고쳐 다시 맞춰도 `lastSeenAt`이 밀리지 않는다(P8의 24시간이 다시 시작되지 않는다).
- 시스템 프롬프트의 "저장 매체를 바꾸는 가정은 내지 않고 다른 원인을 고른다" 문장을 지운다(D8). 이 태스크부터 기억 목록이 그 자리를 맡는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// memory-rules.spec.ts
it('같은 가정을 다시 물은 턴은 한 묶음이고 마지막 결과를 쓴다', () => {
  const out = foldAssumptions([turn('t1', 1, 'wobbly', null), turn('t2', 2, 'well', 'turn:t1')], []);
  expect(out).toEqual([expect.objectContaining({ recordId: null, result: 'well', turnIds: ['t1', 't2'],
    statement: stmt('t1'), at: answeredAt('t2') })]);
});
it('사용자가 고친 결과가 있으면 그것을 쓴다', () => { /* userResult: 'wrong' */ });
it('기억의 id를 가리키면 그 기록의 묶음이다', () => { /* recordIds ['r1'], sameAs 'r1' → recordId 'r1' */ });
it('없는 기록 id를 가리키면 새 묶음이다', () => { /* recordIds [], sameAs 'r9' → recordId null */ });
it('자기보다 뒤 턴을 가리키면 새 묶음이다', () => { /* t1.sameAs 'turn:t2' → 묶음 둘 */ });
it('가정 없는 질문과 복기가 없는 턴은 뺀다', () => { /* [] */ });
it('잘 답한 가정은 retired, 하루 지난 흔들린 가정은 reissue', () => {
  const m = selectMemory([rec('well', hoursAgo(1)), rec('wobbly', hoursAgo(25)), rec('wrong', hoursAgo(3))], now, 24);
  expect(m.retired).toHaveLength(1);
  expect(m.reissue).toHaveLength(1);
});
it('reissue는 예상 밖이었던 것이 앞에 온다', () => { /* 순서 */ });
it('예상했던 가정은 expected에 들고, reissue에 든 것은 빠진다', () => { /* 두 경우 */ });
it('상한: retired 30, reissue 5, expected 10', () => { /* 31개 → 30개, 가장 오래된 것이 빠짐 */ });
it('다시 낼 가정이 있는 주제만 돌려준다', () => { /* pendingTopics */ });
// question.call.spec.ts
it('저장 매체 문장이 시스템 프롬프트에 없다', () => {
  expect(buildQuestionPrompt(base).system).not.toContain('저장 매체를 바꾸는 가정은 내지 않');
});
```

```ts
// test/memory.e2e-spec.ts — strip은 createdAt만 뗀다. id는 비교에 넣는다
it('syncSession은 여러 번 불러도 기록의 id와 내용이 같다 (Review Focus 5)', async () => {
  await memory.syncSession(id); const a = await memory.all();
  await memory.syncSession(id); const b = await memory.all();
  expect(b.map(strip)).toEqual(a.map(strip));
});
it('결과를 고친 뒤 다시 맞추면 status는 바뀌고 lastSeenAt은 그대로다', async () => { /* userResult → status */ });
it('두 세션이 같은 가정에 합류한 뒤 첫 세션을 다시 맞춰도 기록이 하나다 (Review Focus 5)', async () => {
  // s1의 가정 → 기록 R. s2의 턴이 sameAs: R.id로 합류. s1의 결과를 고치고 syncSession(s1)
  const all = await memory.all();
  expect(all).toHaveLength(1);
  expect(all[0].encounters.map((e) => e.sessionId).sort()).toEqual([s1, s2].sort());
});
it('두 세션이 합류한 기록에서도 다시 맞춘 뒤 만남의 순서가 그대로다 (Review Focus 5)', async () => { /* syncSession(s1) 전후 encounters 순서 동일 */ });
it('서로 다른 두 세션을 동시에 맞춰도 합류한 기록의 만남이 둘 다 남는다 (Review Focus 5)', async () => {
  await Promise.all([memory.syncSession(s1), memory.syncSession(s2)]);
  expect((await memory.all())[0].encounters).toHaveLength(2);
});
it('다른 세션의 만남은 건드리지 않는다', async () => { /* 세션 둘 */ });
it('면접을 시작하면 그때의 기억이 세션에 저장된다', async () => { /* sessions.memory.retired 길이 1 */ });
```

- [ ] **Step 2~4:** 실패 확인 → 구현 → `npm.cmd test`, `test:e2e`, `typecheck`, `lint`.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 가정 기억"`

### Task 12: 복기 서비스와 API, 추이

**Files:**
- Create: `src/review/review.service.ts`, `src/review/review.view.ts`, `src/review/review.controller.ts`, `src/review/insights.controller.ts`(`/memory/topics`, `/stats`), `src/review/review-input.ts`, `src/review/stats.ts`, `src/review/review.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/review/stats.spec.ts`, `src/review/review-input.spec.ts`, `test/review.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 3 `UsageService`, Task 7 오류 클래스와 `ConflictCode`, Task 8 `InputError`와 `parseId`, Task 10 `TurnService.reviewTurn`과 `TurnReview`, Task 11 `MemoryService`와 `foldAssumptions`
- Produces
  ```ts
  // review.view.ts
  export interface ReviewTurnView {
    id: string; seq: number; addOn: boolean;
    interviewer: { id: string; roleName: string; temperamentName: string };
    text: string; clarifications: { ask: string; reply: string; leak: boolean }[]; answer: string; answerStartMs: number | null;
    questionIntent: { id: string; name: string; group: string };
    cause: { reactionIntent: { id: string; name: string; group: string } | null; defect: { typeName: string; axisName: string; note: string } | null };
    assumption: { axisName: string; statement: string } | null;
    answerKey: AnswerKey; answerKeyCorrected: boolean; leakFlag: boolean; premiseFlag: boolean;
    analysis: { typeName: string; axisName: string; note: string }[];
    followUps: { seq: number; addOn: boolean; roleName: string; reactionIntent: { id: string; name: string; group: string } }[];
    review: TurnReview | null; surprise: 'expected' | 'unexpected' | null;
  }
  export interface ReviewView {
    id: string; topic: string; createdAt: string;
    status: 'none' | 'pending' | 'ready'; progress: { done: number; total: number };
    error: UpstreamReason | 'MEMORY_SYNC_FAILED' | null;
    turns: ReviewTurnView[];                                   // 복기 대상 턴만
    skippedAnswers: number;                                    // 답은 있는데 분석이 없거나 되묻기로 남아 빠진 턴의 수(P18)
    assumptions: { axisName: string; statement: string; result: AssumptionResult; turnSeq: number }[]; // 가정별 결과
    usage: { role: string; model: string; inputTokens: number; outputTokens: number; calls: number; fallbacks: number }[];
  }
  // review.service.ts
  @Injectable() export class ReviewService {
    start(sessionId: string): Promise<void>;          // 백그라운드로 시작. 이미 돌고 있으면 아무것도 안 함
    whenIdle(sessionId: string): Promise<void>;       // 테스트용: 진행 중인 작업이 끝날 때까지 기다림
    getView(sessionId: string): Promise<ReviewView>;
    updateTurn(sessionId: string, turnId: string, patch: { surprise?: 'expected' | 'unexpected'; assumptionResult?: AssumptionResult }): Promise<ReviewView>;
  }
  // review-input.ts
  export function parseTurnPatch(body: unknown): { surprise?: 'expected' | 'unexpected'; assumptionResult?: AssumptionResult }; // 둘 다 없으면 REQUIRED, 목록 밖 값은 NOT_ALLOWED
  // stats.ts (순수 함수)
  export interface Stats { improved: number; sessions: { id: string; topic: string; date: string; medianAnswerStartMs: number | null; unexpectedRatio: number | null }[] }
  export function computeStats(sessions: InterviewSession[], turns: InterviewTurn[], records: AssumptionRecord[]): Stats;
  ```
- 경로

  | 메서드와 경로 | 본문 | 성공 |
  |---|---|---|
  | `POST /interviews/:id/review` | | 202 `{ status }` |
  | `GET /interviews/:id/review` | | 200 `ReviewView` |
  | `PATCH /interviews/:id/turns/:turnId` | `{ surprise?, assumptionResult? }`(둘 중 하나 이상) | 200 `ReviewView` |
  | `GET /memory/topics` | | 200 `{ topics: string[] }` |
  | `GET /stats` | | 200 `Stats` |

- 규칙
  - 복기는 끝난 면접에만 만든다. 진행 중이면 `ConflictError('INTERVIEW_NOT_FINISHED')`로 409를 준다. `GET …/review`와 `PATCH …/turns/:turnId`도 같다. 숨긴 정보가 면접 중에 나가는 길이 되면 안 되기 때문이다.
  - **복기 대상 턴**은 `answer`가 있고 `analysis.kind === 'answer'`인 턴이다. 뷰의 `turns`, 생성 대상, `progress.total`이 모두 이 정의를 쓴다. 답은 있는데 분석이 없는 턴, 그리고 분석이 되묻기(`clarify`)인 턴(되묻기에 응답하기 전에 끝난 턴. 그 `answer`는 답이 아니라 되묻는 말이다)은 `skippedAnswers`로 수만 센다.
  - **이 답에서 나온 질문**(`followUps`)은 `causeTurnId`가 이 턴인 턴들이다(`seq` 순, 0~2개). 순서상 다음 턴을 쓰지 않는다. 덧붙이는 질문은 바로 앞 턴이 아니라 그 앞 턴의 답에서 나오기 때문이다.
  - 세션별 잠금: `start`의 작업과 `updateTurn`은 세션별로 줄 세운다(Task 7과 같은 방식의 Map). 둘이 겹쳐 기억을 두 번 맞추거나 한쪽 변경을 잃지 않게 한다.
  - `start`의 작업(백그라운드, `recorder.run(sessionId, …)` 안에서)
    1. 대상 턴 가운데 `review`가 없는 것을 `seq` 순으로 3개씩 묶어 동시에 `reviewTurn`을 부른다. 턴 하나가 끝날 때마다 그 턴의 `review` 컬럼만 `update`한다. 입력의 `knownAssumptions`는 `memory.knownForAxis(축)`에, 이 세션에서 `seq`가 더 작은 가정 변경 턴(같은 축)을 `{ key: 'turn:<id>', statement }`로 더한 것이다. 가정 없는 질문이면 빈 배열이다.
    2. 턴 하나가 실패해도 나머지는 계속한다. 실패 사유는 `UpstreamReason` 코드로만 메모리에 두었다가 뷰의 `error`로 보여 준다.
    3. 대상 턴 모두에 `review`가 있고 `reviewedAt`이 없으면 `memory.syncSession`을 부르고 `reviewedAt`을 적는다. **1에서 만들 것이 없어도 이 단계는 한다.** 기억 반영만 실패한 세션이 다시 `start`로 들어왔을 때 이어 가기 위해서다. `syncSession`이 던지면 `error`를 `'MEMORY_SYNC_FAILED'`로 둔다.
  - `status`: 작업이 돌고 있으면 `pending`. `reviewedAt`이 있으면 `ready`. 그 밖에는 `none`.
  - `updateTurn`: `surprise`는 턴에 저장한다. `assumptionResult`는 그 턴의 `review.assumption.userResult`에 저장한다(가정을 바꾼 질문이 아니거나 `review`가 없으면 `ConflictError('NOT_REVIEWABLE')`). 저장한 뒤 `reviewedAt`이 있으면 `memory.syncSession`을 다시 부른다. 이 `syncSession`이 던지면 `reviewedAt`을 null로 되돌리고 `error`를 `'MEMORY_SYNC_FAILED'`로 둔다. 그러면 `status`가 `none`이 되고, 다시 `start`하면 3번이 기억을 맞춘다. 턴에 저장한 값은 그대로 둔다.
  - 뷰의 `leakFlag`는 `prepared.flags.leak`, `premiseFlag`는 `prepared.flags.premise`이거나 `verification`의 `premiseOk`가 false일 때 참이다. 이미 나간 질문의 전제가 사후 검증에서 틀린 것으로 드러난 경우를 복기에 표시한다(설계 6.2-6).
  - `questionIntent.group`과 `reactionIntent.group`은 `INTENT_GROUPS`에서 찾는다. `temperamentName`은 `TEMPERAMENTS`, `typeName`은 `DEFECT_NAMES`, `axisName`은 `axisName()`이다.
  - `assumptions`: `foldAssumptions`의 결과를 보여 준다(`turnSeq`는 묶음 마지막 턴의 `seq`).
  - `computeStats`: `improved`는 `status`가 `well`이고, 가장 늦은 만남보다 `at`이 이른 만남 가운데 `wobbly`나 `wrong`이 있는 기록의 수. `sessions`는 끝난 면접 최근 10개. `medianAnswerStartMs`는 값이 있는 턴들의 중앙값(없으면 null), `unexpectedRatio`는 표시한 턴 가운데 `unexpected`의 비율(표시가 없으면 null).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// stats.spec.ts
it('흔들렸다가 잘 답한 가정만 improved로 센다', () => { /* 2개 중 1개 */ });
it('답 시작 시간의 중앙값을 낸다. 값이 없으면 null', () => { /* [800, 1200, 5000] → 1200, 짝수 개는 가운데 둘의 평균 */ });
it('예상 밖 비율은 표시한 턴만으로 낸다', () => { /* expected 1, unexpected 1, 표시 없음 2 → 0.5 */ });

// test/review.e2e-spec.ts
it('진행 중인 면접의 복기는 409이고 숨긴 값을 주지 않는다 (Review Focus 1)', async () => {
  for (const req of [request(server).get(`/v1/interviews/${id}/review`), request(server).post(`/v1/interviews/${id}/review`),
    request(server).patch(`/v1/interviews/${id}/turns/${turnId}`).send({ surprise: 'expected' })]) {
    const res = await req.expect(409);
    expect(res.body).toEqual({ error: 'INTERVIEW_NOT_FINISHED' });
  }
});
it('끝난 면접의 복기를 만들면 턴마다 재검사가 한 번씩 돈다', async () => {
  await request(server).post(`/v1/interviews/${id}/review`).expect(202);
  await review.whenIdle(id);
  expect(fake.calls.filter((c) => c.kind === 'review')).toHaveLength(answeredTurns);
  const v = (await request(server).get(`/v1/interviews/${id}/review`).expect(200)).body;
  expect(v.status).toBe('ready');
  expect(v.turns[0].answerKey.keyPoints).toEqual(['k1']);
  expect(['집요형', '조력형', '흔드는형']).toContain(v.turns[0].interviewer.temperamentName);
});
it('복기를 두 번 눌러도 재검사는 턴마다 한 번이다 (Review Focus 5)', async () => { /* POST 두 번(연속, 동시) → review 호출 수 그대로 */ });
it('일부 턴이 실패하면 그 턴만 다시 만든다 (Review Focus 5)', async () => {
  fake.once('review', new Error('boom'));
  await review.start(id); await review.whenIdle(id);
  const failed = await review.getView(id);
  expect(failed.status).toBe('none');
  expect(failed.error).toBe('API_ERROR');
  await review.start(id); await review.whenIdle(id);
  expect(fake.calls.filter((c) => c.kind === 'review')).toHaveLength(answeredTurns + 1);
  expect((await review.getView(id)).status).toBe('ready');
});
it('기억 반영이 한 번 실패해도 다시 시작하면 반영된다 (Review Focus 5)', async () => {
  // memory.syncSession이 첫 번째만 던지게 한다(spy)
  await review.start(id); await review.whenIdle(id);
  expect((await review.getView(id)).status).toBe('none');
  await review.start(id); await review.whenIdle(id);
  expect((await review.getView(id)).status).toBe('ready');
  expect(fake.calls.filter((c) => c.kind === 'review')).toHaveLength(answeredTurns); // 재검사는 다시 하지 않는다
  expect(await memory.all()).not.toHaveLength(0);
});
it('덧붙이기가 낀 면접에서 이 답에서 나온 질문을 원인 턴으로 짝짓는다', async () => {
  // seq 1의 답 → seq 2(primary), seq 3(addOn, 원인 seq 1). seq 2의 답 → 나온 질문 없음
  const calls = fake.calls.filter((c) => c.kind === 'review');
  expect(userOf(calls[0])).toContain(textOf(seq2));
  expect(userOf(calls[0])).toContain(textOf(seq3));
  expect(userOf(calls[1])).not.toContain(textOf(seq3));
  const v = await review.getView(id);
  expect(v.turns[0].followUps.map((f) => [f.seq, f.addOn])).toEqual([[2, false], [3, true]]);
  expect(v.turns[1].followUps).toEqual([]);
});
it('분석 없이 남은 답은 복기에서 빠지고 수로만 보인다', async () => { /* finish 전에 analyze 실패 → skippedAnswers 1, turns 길이, status ready */ });
it('되묻기 응답이 실패한 채 끝낸 턴은 복기 대상이 아니고 재검사 호출이 나가지 않는다', async () => {
  // analyze → clarify, clarify 호출 Error, finish. 그 턴에는 answer와 analysis(kind clarify)가 남아 있다
  await review.start(id); await review.whenIdle(id);
  expect(fake.calls.filter((c) => c.kind === 'review')).toHaveLength(0);
  expect((await review.getView(id)).skippedAnswers).toBe(1);
});
it('결과를 고친 뒤 기억 반영이 실패하면 status가 none이 되고, 다시 시작하면 반영된다 (Review Focus 5)', async () => {
  // memory.syncSession이 한 번 던지게 한 뒤 PATCH assumptionResult
  const v = await review.getView(id);
  expect([v.status, v.error]).toEqual(['none', 'MEMORY_SYNC_FAILED']);
  await review.start(id); await review.whenIdle(id);
  expect((await review.getView(id)).status).toBe('ready');
});
it('같은 축의 앞선 가정을 knownAssumptions로 준다', async () => { /* 둘째 가정 변경 턴의 review params.user에 'turn:<첫 턴 id>' */ });
it('복기가 끝나면 가정이 기억에 들어간다', async () => { /* memory.all() 길이, status */ });
it('가정 결과를 고치면 기억이 따라 바뀐다', async () => { /* PATCH assumptionResult → record.status */ });
it('가정을 바꾼 질문이 아닌 턴의 결과를 고치려 하면 409 NOT_REVIEWABLE', async () => { /* 본문 error */ });
it('예상 표시를 저장한다', async () => { /* PATCH surprise → view.turns[i].surprise */ });
it('되묻기 응답의 흘림 표시가 복기에 보인다', async () => { /* clarifications[0].leak true */ });
it('사후 검증에서 전제가 틀린 것으로 드러난 질문은 premiseFlag가 참이다', async () => { /* verify premiseOk false */ });
it('사용량에 복기 호출이 든다', async () => { /* usage에 role review */ });
it('본문이 비거나 값이 목록 밖이면 400', async () => { /* {} , { surprise: 'maybe' } */ });
```

- [ ] **Step 2~4:** 실패 확인 → 구현 → `npm.cmd test`, `test:e2e`, `typecheck`, `lint`.
- [ ] **Step 5: 커밋.** `git commit -m "feat: 복기 서비스와 API, 추이"`

### Task 13: 화면 — 복기와 추이

**Files:**
- Create: `frontend/web/components/review-screen.tsx`, `frontend/web/components/stats-panel.tsx`, `frontend/web/lib/review-decode.ts`, `frontend/web/lib/poll.ts`
- Modify: `frontend/web/api.ts`, `frontend/web/lib/api-error.ts`(`INTERVIEW_NOT_FINISHED`, `NOT_REVIEWABLE` 문장), `frontend/web/components/app.tsx`, `start-screen.tsx`, `interview-screen.tsx`, `scripts/run-fake-app.ts`(가짜 review 응답에 가정 결과를 섞는다)
- Test: `frontend/web/lib/review-decode.test.ts`, `frontend/web/lib/poll.test.ts`, `frontend/web/lib/api-error.test.ts`(추가)

**Interfaces:**
- Consumes: Task 12의 경로와 `ReviewView`, `Stats`
- Produces
  - `frontend/web/lib/poll.ts`: `pollUntil<T>(fetchOnce: () => Promise<T>, done: (v: T) => boolean, opts: { intervalMs: number; sleep: (ms: number) => Promise<void>; signal?: AbortSignal }): Promise<T>`. `done`이 참이 될 때까지 되풀이한다. `signal`이 끊기면 멈춘다. 화면을 떠난 뒤에도 요청이 이어지지 않게 한다.
  - `frontend/web/lib/review-decode.ts`: `decodeReviewView`, `decodeStats`
  - `api.ts`에 추가: `startReview(id)`, `getReview(id)`, `patchTurn(id, turnId, patch)`, `getPendingTopics()`, `getStats()`

**화면이 하는 일**
- 복기 화면
  - 들어오면 `getReview`로 상태를 본다. `none`이면 "복기를 만들면 질문마다 재검사 호출이 나갑니다(과금)." 안내와 "복기 만들기" 버튼을 보여 준다. 누르면 `startReview` → 3초 간격으로 `getReview`를 `status`가 `pending`이 아닐 때까지 묻는다. 그동안 "복기를 만들고 있습니다 (3/6)"처럼 `progress`를 보여 준다. `none`으로 끝나면 `error`에 맞는 문장과 "다시 만들기" 버튼을 보여 준다. `MEMORY_SYNC_FAILED`면 "복기는 만들었지만 기억에 반영하지 못했습니다. 다시 만들기를 누르면 반영만 다시 합니다(추가 과금 없음).", 그 밖의 값이면 "일부 질문의 복기를 만들지 못했습니다. 다시 만들기를 누르면 빠진 질문만 다시 만듭니다."
  - 위쪽: 가정별 결과 목록(잘 답함 / 흔들림 / 틀림을 글자로), 사용량 표(역할, 모델, 호출 수, 입력·출력 토큰, 폴백 수). `skippedAnswers`가 있으면 "분석되지 않아 복기에서 빠진 답 N개"를 적는다. 맨 아래에 추이(`stats-panel`).
  - 질문마다 카드 하나(설계 7의 "질문마다 보여 줄 것"을 이 순서로)
    1. 질문과 누가 물었는지(직무와 성향), 덧붙이는 질문 표시
    2. 내 답, 되묻기 주고받은 말(되묻기 응답에 흘림 표시가 있으면 "이 응답에서 해답 기술이 나왔을 수 있음"), 답 시작까지 걸린 시간
    3. 질문 의도(묶음과 세부)와, 이 질문이 나온 까닭(반응 의도의 묶음과 세부, 맡은 결함)
    4. 내 답이 그 의도를 향했는지(`review.intent`)
    5. 면접관 판정의 재검사: 결함마다 "맞는 지적 / 오판", 이 답에서 나온 질문마다 "맞는 지적 / 오판 / 의도된 확신 시험"
    6. 바뀐 가정, 사라진 차이, 남은 차이
    7. 숨은 정답지(대안 기술과 특징, 기대하는 답의 핵심). "정답지 수정됨", 흘림 플래그, 전제 오류 플래그가 있으면 글자로 표시. `keyProblems`가 있으면 "복기가 정답지에서 찾은 문제"로 따로 보여 준다
    8. "예상했음 / 예상 밖" 버튼 둘(한 번 클릭, 다시 누르면 바뀜)
    9. 가정을 바꾼 질문이면 결과 고치기(잘 답함 / 흔들림 / 틀림). 고친 값은 "직접 고침"으로 표시
- 시작 화면에 더하는 것: "다시 연습할 가정이 남은 주제"(`getPendingTopics`. 누르면 주제 입력에 채움), 추이(`stats-panel`: 흔들림에서 잘 답함으로 바뀐 가정 수, 면접별 답 시작 시간 중앙값과 예상 밖 비율을 표로. 목표치는 보여 주지 않는다).
- 면접 화면의 "복기 보기" 버튼이 복기 화면으로 간다(Task 9의 임시 문구를 지운다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// poll.test.ts
void test('done이 참이 되면 그 값을 돌려준다', async () => { /* pending, pending, ready → 호출 3번 */ });
void test('signal이 끊기면 더 묻지 않는다', async () => { /* abort 뒤 호출 수 고정, reject */ });
void test('fetchOnce가 던지면 그대로 던진다', async () => { /* reject */ });
// review-decode.test.ts
void test('복기 뷰를 통과시킨다', () => { /* 정상 모양 */ });
void test('verdict가 목록 밖이면 던진다', () => { /* assert.throws */ });
void test('review가 null인 턴도 받는다', () => { /* pending 중 */ });
```

- [ ] **Step 2~3:** 실패 확인(`npm.cmd run frontend:test`) → 구현.
- [ ] **Step 4: 과금 없이 화면을 확인한다.** `npm.cmd run start:fake`로 한 판을 끝내고 복기까지 본다: "복기 만들기"를 누르면 진행 표시가 바뀌다가 카드가 나온다, 예상 표시와 결과 고치기가 저장된다(새로고침 뒤에도 남는다), 시작 화면에 추이가 보인다, 375px 폭에서 가로 스크롤이 없다, 콘솔 오류가 없다. 면접 중에는 주소의 hash를 바꿔 복기 화면으로 가도 정답지가 보이지 않는다.
- [ ] **Step 5: 전체 확인.** `npm.cmd run frontend:verify`, `npm.cmd test`, `npm.cmd run test:e2e`, `npm.cmd run typecheck`, `npm.cmd run lint`.
- [ ] **Step 6: 커밋.** `git commit -m "feat: 복기 화면과 추이"`

## 체크포인트 B: 복기까지 한 판 (구현 아님, 사용자 승인 필요)

- [ ] 사용자 승인을 받고 실제 API로 한 판을 하고 복기를 본다. 끝난 뒤 사용량(면접과 복기를 나눠)을 알린다.
- [ ] 사용자의 판단을 `docs/b-review.md`에 [결정]으로 적는다. 볼 것: 재검사가 맞는가(오판을 오판이라고 하는가), 가정별 결과가 납득되는가, 정답지와 복기에 틀린 내용이 없는가(F3, F4), 다음 면접에서 잘 답한 가정이 다시 나오지 않는가(두 번째 판이 필요하다).
- [ ] `README.md`를 쓴다: 필요한 것(Node, Docker, `.env`의 키), 띄우는 순서, 과금 안내, 테스트 명령.
- [ ] 사용자가 정하면 설계 문서에 반영한다(`docs/r1-review.md` 8장). 정하지 않으면 그대로 둔다.
  - 6.2에 "모른다고 하면 넘어간다"와 `결함 없음` 표기
  - 6.3에 넓힌 전제 정의
  - 5.1 직무 표에 아키텍트의 `time_org` 축
  - 8의 "구체 가정" 문장: 프롬프트는 이미 기술 이름 없이 쓰게 한다. 계획 1의 테스트 예시만 다르다.

## 이 계획 뒤에 남는 것

- 끼어들기 흉내(P5), 조기 종료 조건("볼 만큼 봤다")의 자동 판단.
- 한글 표기와 별칭("레디스"/"Redis")을 같은 기술로 보기.
- 이름 없이 특징만 흘린 질문의 검사(D9에 따라 사람이 본다. 체크포인트 A).
- 모름 경로의 연속 질문 상한. 지금은 같은 면접관이 이어 묻고, 그 턴도 기록에 들어가 다음 선택에서 상한에 걸린다.
- SDK의 기본 재시도(2회)가 대기 시간에 주는 영향. 사용량은 호출마다 남으므로 써 본 뒤에 본다.
- 면접을 시작하다 실패한 호출의 사용량은 `llm_usage`에 남지만 화면에는 보이지 않는다(세션이 없다).
- 같은 되묻기를 연달아 두 번 보내면 둘 다 처리된다(Task 7의 알려진 한계).

# 압박 면접 R1 핵심 엔진 구현 계획 (계획 1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계 11장의 R1을 실제 모델로 시험할 수 있는 핵심 엔진과 한 턴짜리 실행기를 NestJS 프로젝트 안에 만든다. R1이 확인하는 것은 가정 변경 질문 품질, 정답지 정확도, 해답 흘림이다.

**Architecture:** 설계 4장의 방식 1을 구현한다.
- 분석 호출이 답변의 결함을 찾고, 순수 함수 `pickNext`가 다음 질문자와 반응 의도를 정한다.
- 뽑힌 면접관 한 명이 질문과 숨은 정답지를 쓰고, 흘림 검사와 정답지 검증이 따른다.
- 순수 로직(카탈로그, 규칙, 이름 검사, 호출별 스키마·프롬프트)은 프레임워크와 무관한 TS 모듈로 둔다. Claude 호출과 턴 조립은 NestJS provider(`LlmService`, `TurnService`)로 `EngineModule`에 묶는다.
- R1 실행기는 `NestFactory.createApplicationContext`로 이 모듈을 띄우는 스크립트다.
- HTTP API, TypeORM·PostgreSQL, React 화면, 복기, 기억은 계획 2에서 다룬다. 계획 2는 R1 결과를 사용자와 본 뒤에 쓴다.

**Tech Stack:** TypeScript 5.9, NestJS 11(`@nestjs/common`, `@nestjs/core`, `@nestjs/config`), `@anthropic-ai/sdk`, Jest 30 + ts-jest, ESLint 10 + typescript-eslint 8, Prettier 3, ts-node. 설계 3장 기술 스택 결정의 일부이고, 나머지(TypeORM, PostgreSQL, React + Vite + Tailwind)는 계획 2에서 들인다.

**Spec:** [`docs/specs/2026-11-16-pressure-interview-design.md`](../specs/2026-11-16-pressure-interview-design.md). 의도 목록은 [`research/2026-11-16-followup-intents.md`](../../research/2026-11-16-followup-intents.md)를 따른다.

**Status:** 사용자 승인 (2026-11-16). 같은 날 순수 JS판을 사용자의 스택 결정(BlueGang 스택)에 맞춰 TS/NestJS판으로 다시 썼고, 다시 쓴 이 판을 승인받았다. 실행 방식은 아직 정하지 않았다(추천: subagent-driven).

## Global Constraints

**환경과 스택**
- 확인한 환경(2026-11-16 이번 실행): Node v24.22.1, npm 11.19.1, git 2.52.0. npm은 `npm.cmd`로 실행한다. PowerShell 5.1이라 `&&`가 없으니 명령은 하나씩 실행한다.
- 스택과 도구 설정은 BlueGang main(1ea20e8, 2026-10-16)을 그대로 따른다. 파일은 직접 만들고, `nest new`는 쓰지 않는다. `nest new`는 git과 예제 파일을 만들기 때문이다.
  - 그대로 복사하는 파일: `tsconfig.json`(CommonJS, ES2023, strict, decorators, `exclude`에 `frontend` 포함), `tsconfig.build.json`, `nest-cli.json`, `.prettierrc`(singleQuote, trailingComma all, printWidth 100), `.prettierignore`
  - `eslint.config.mjs`: 공통 블록만 복사한다(`recommendedTypeChecked`, `no-floating-promises`, `no-misused-promises`). frontend 블록은 계획 2에서 넣는다.
  - `.nvmrc`: `24.21.0`
  - `package.json`의 `jest` 블록(roots `src`, `scripts`, `.spec.ts`, ts-jest)도 BlueGang과 같게 둔다.
- 의존성 버전 범위는 BlueGang `package.json`과 같다.
  - 런타임: `@nestjs/common` ^11.2.7, `@nestjs/core` ^11.2.7, `@nestjs/config` ^4.0.4, `reflect-metadata` ^0.2.2, `rxjs` ^7.8.2, 그리고 설치 시점의 최신 `@anthropic-ai/sdk`
  - 개발: `@nestjs/cli` ^11.0.24, `@nestjs/schematics` ^11.1.0, `@nestjs/testing` ^11.2.7, `@eslint/js` ^10.0.1, `eslint` ^10.8.0, `eslint-config-prettier` ^10.1.8, `globals` ^17.9.0, `typescript-eslint` ^8.66.0, `prettier` ^3.9.6, `jest` ^30.4.2, `ts-jest` ^29.4.12, `@types/jest` ^30.0.0, `@types/node` ^20.19.43, `ts-node` ^10.9.2, `typescript` ~5.9.3
  - 계획 1에서는 TypeORM, `pg`, `@nestjs/platform-express`, 프런트엔드 패키지를 설치하지 않는다.
- 태스크마다 끝에서 `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`가 모두 통과해야 한다.

**git과 커밋**
- 작업 폴더 `C:\Users\dosac\projects\interview`는 git 저장소가 아니다. `git init`과 첫 커밋 범위는 Task 1에서 사용자 승인을 받는다. 승인받지 못하면 모든 Commit 단계를 건너뛴다.
- 커밋 메시지와 PR 설명에 Claude 표시(`Co-Authored-By: Claude …`, "Generated with Claude Code")를 넣지 않는다. **[사용자 결정]**
- 전역 `core.autocrlf=true`이므로 `.gitattributes`에 `* text=auto eol=lf`를 둔다.

**Claude 호출과 비용**
- API 키를 명령, 출력, 커밋에 넣지 않는다.
  - 클라이언트는 `new Anthropic()`로 만들어 SDK가 환경 변수나 `ant` 프로필에서 자격 증명을 찾게 한다.
  - `.env`는 gitignore에 넣는다. `.env.example`에는 `ENGINE_*` 키와 빈 `ANTHROPIC_API_KEY=` 줄만 둔다.
- 모델 기본값은 모든 호출에 `claude-opus-5-5`다. 낮출지는 사용자가 `.env`의 `ENGINE_MODEL_*`로 정한다.
- 모든 호출은 `client.beta.messages.create`로 보낸다.
  - 요청에 싣는 것: `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`, `output_config: { effort, format: { type: 'json_schema', schema } }`, `max_tokens: 16000`
  - `thinking`은 생략한다(Opus 5.5는 항상 adaptive).
- 실제 API를 부르는 실행(Task 8의 R1 실행)은 비용이 든다. 실행할 때마다 사용자 승인을 받는다.

**프롬프트**
- 프롬프트와 출력은 한국어다.
- 설계 6.3의 기술 이름 규칙과 O/X 예시 네 개는 질문 호출 시스템 프롬프트에 문장 그대로 들어간다(Task 5의 `REQUIRED_RULES`).

## Review Focus

1. 분석 호출이 결함을 하나도 돌려주지 않는다. 이때는 "결함 없음"으로 보고, 축은 질문의 축(소유 가능한 축이 아니면 질문자의 첫 축)을 쓴다. 테스트: Task 7.
2. 결함의 축을 맡은 면접관이 패널에 없다. 이때는 가장 오래전에 질문한 면접관이 맡는다. 직전 질문자라는 이유만으로 이어받지 않는다. 테스트: Task 2.
3. 지원자의 입력이 답이 아니라 되묻기다(예: "~관점에서 여쭤보시는 건가요?"). 이때는 질문자를 바꾸지 않는다(`pick: null`). 테스트: Task 7.
4. 기술 이름의 대소문자나 공백이 다르다("kafka" / "Kafka "). 같은 기술로 본다. 한글 표기("카프카")와 별칭("Postgres")은 잡지 못하므로 shortcut 주석을 단다. 테스트: Task 3.
5. 시나리오 하나가 거절(`refusal`)이나 오류로 실패한다. 나머지 시나리오는 계속 돌고, 리포트에 오류를 표시한다. 테스트: Task 8.

---

### Task 1: 프로젝트 준비, 설정, 카탈로그, 타입

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.nvmrc`, `.gitignore`, `.gitattributes`, `.env.example`
- Create: `src/config/engine.config.ts`, `src/interview/catalog.ts`, `src/interview/types.ts`
- Test: `src/config/engine.config.spec.ts`, `src/interview/catalog.spec.ts`

**Interfaces:**
- Produces (`src/interview/catalog.ts`, `as const`로 정의하고 타입을 뽑아냄)
  - 데이터: `AXES: readonly { id: AxisId; name: string }[]`, `SHARED_AXES`, `OWNABLE_AXES: OwnableAxisId[]`
  - 데이터: `QUESTION_INTENTS: Record<QuestionIntentId, string>`(A1–A15), `REACTION_INTENTS: Record<ReactionIntentId, string>`(B1–B11), `INTENT_GROUPS: { question: Record<string, QuestionIntentId[]>; reaction: Record<string, ReactionIntentId[]> }`
  - 데이터: `DEFECT_TYPES: DefectType[]`, `DEFECT_PRIORITY: Record<DefectType, number>`
  - 데이터: `ROLES: Record<RoleId, { type: 'job' | 'textbook' | 'scenario'; name: string; axes: OwnableAxisId[]; intents: QuestionIntentId[] }>`
  - 데이터: `TEMPERAMENTS: Record<TemperamentId, string>`, `REACTION_TABLE: Record<DefectType, Record<TemperamentId, ReactionIntentId>>`
  - 타입: `AxisId`, `OwnableAxisId`, `QuestionIntentId`, `ReactionIntentId`, `DefectType`, `RoleId`, `TemperamentId`
- Produces (`src/interview/types.ts`)

```ts
export interface PanelMember { id: string; role: RoleId; temperament: TemperamentId }
export interface Defect { type: DefectType; axis: OwnableAxisId; note: string }
export interface PickChoice { interviewerId: string; defect: Defect; reactionIntent: ReactionIntentId }
export interface Pick extends PickChoice { secondary: PickChoice | null }
export interface AnswerKey { vanishing: string[]; remaining: string[]; alternatives: { name: string; traits: string }[]; keyPoints: string[] }
export interface Question { text: string; questionIntent: QuestionIntentId; assumption: { axis: AxisId | 'none'; statement: string }; answerKey: AnswerKey }
export interface Analysis { kind: 'answer' | 'clarify'; defects: Defect[]; mentionedTechs: string[] }
export interface Verification { premiseOk: boolean; problems: { field: string; problem: string }[]; answerKey: AnswerKey }
export interface TechMention { name: string; role: 'premise' | 'solution' | 'user' }
export interface NamingResult { ok: boolean; violations: string[] }
export interface TokenUsage { input_tokens: number; output_tokens: number }
export interface QuestionInput {
  topic: string; interviewer: PanelMember; reactionIntent: ReactionIntentId | null; defect: Defect | null;
  targetAxis: AxisId | null; history: { interviewerId: string; text: string; answer: string }[];
  userMentioned: string[]; feedback: string[];
}
export interface PreparedQuestion {
  question: Question; verification: Verification | null; answerKeyCorrected: boolean;
  flags: { leak: boolean; premise: boolean };
  attempts: { question: Question; naming: NamingResult; verification: Verification | null }[];
  usage: TokenUsage[];
}
export interface AnswerInput {
  topic: string; panel: PanelMember[]; history: string[]; askedBy: string;
  question: Question; answer: string; userMentioned: string[];
}
export interface AnswerResult { analysis: Analysis; pick: Pick | null; userMentioned: string[]; usage: TokenUsage[] }
```

- Produces (`src/config/engine.config.ts`)
  - `type CallRole = 'analyze' | 'question' | 'verify' | 'leak'`
  - `type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
  - `interface EngineConfig { models: Record<CallRole, string>; effort: Record<CallRole, Effort>; maxConsecutive: number; maxRegenerations: number }`
  - `readEngineConfig(env: NodeJS.ProcessEnv): EngineConfig`(순수 함수)
  - `engineConfig = registerAs('engine', () => readEngineConfig(process.env))`
- 설정 규칙
  - 환경 변수: `ENGINE_MODEL_<ROLE>`, `ENGINE_EFFORT_<ROLE>`(ROLE은 대문자 호출 이름), `ENGINE_MAX_CONSECUTIVE`, `ENGINE_MAX_REGENERATIONS`
  - 기본값: 모델은 모두 `claude-opus-5-5`, 노력은 analyze `medium` / question `high` / verify `high` / leak `low`, `maxConsecutive` 2, `maxRegenerations` 1
  - effort가 다섯 값이 아니거나 숫자가 양의 정수가 아니면, 키 이름을 담은 `Error`를 던진다(시작할 때 실패).

**카탈로그 값** (설계 5.1–5.3과 6.2, 조사 노트 표를 옮긴 것)

| AXES id | name | 비고 |
|---|---|---|
| `scale` | 규모 | |
| `resource_limit` | 자원 한도 | |
| `cs_premise` | CS 원리의 전제 | 설계 5.1 교과형 행 |
| `distribution` | 데이터 분포 | |
| `failure` | 장애 양상 | |
| `attack` | 공격 | 설계 5.1 보안 행. 5.3 어휘에는 빠져 있어 여기서 추가 |
| `consistency` | 일관성 완화 | |
| `durability` | 영속성·전달 보장 | |
| `requirement_change` | 요구·규제 변경 | |
| `tech_swap` | 기술 대체 | |
| `cost` | 비용 | |
| `latency_budget` | 지연 예산 | |
| `time_org` | 시간·조직 | |
| `identity_swap` | 기술의 핵심 속성 바꾸기(정체성 비교) | `SHARED_AXES`: 모든 면접관이 질문에 쓰고, 결함 담당은 없음 |

| ROLES id | type | name | axes | intents |
|---|---|---|---|---|
| `dba` | job | DBA | durability, consistency, distribution | A1, A4 |
| `security` | job | 보안 | attack, failure | A10 |
| `architect` | job | 아키텍트 | tech_swap, cost, requirement_change, time_org | A2, A3, A12 |
| `textbook` | textbook | 교과형 | resource_limit, cs_premise | A1, A14 |
| `scenario` | scenario | 시나리오형 | scale, distribution, latency_budget | A8, A9 |

- `TEMPERAMENTS`: `persistent` 집요형, `helper` 조력형, `shaker` 흔드는형.
- `DEFECT_PRIORITY`: `wrong` 4, `missing_axis` 3, `no_why` 2, `no_tradeoff` 2, `vague` 1, `no_evidence` 1, `none` 0.
- `INTENT_GROUPS`: 설계 5.2 묶음 표를 그대로 옮긴다(깊이/판단/증명/적응/미지 대응, 올림/좁힘/힌트/반박/전환).
- `QUESTION_INTENTS`, `REACTION_INTENTS`의 이름은 조사 노트 (a)·(b) 표의 "이름" 열이다.

| REACTION_TABLE | persistent | helper | shaker |
|---|---|---|---|
| `none` | B1 | B1 | B8 |
| `wrong` | B6 | B7 | B9 |
| `missing_axis` | B6 | B4 | B9 |
| `no_why` | B3 | B5 | B8 |
| `no_tradeoff` | B4 | B4 | B9 |
| `vague` | B2 | B7 | B2 |
| `no_evidence` | B3 | B3 | B8 |

- [ ] **Step 1: git 사용 승인 받기.** 사용자에게 `git init`을 할지, 첫 커밋에 기존 `docs/`와 `research/`를 넣을지 묻는다. 승인받으면 `git init`을 실행한다.
- [ ] **Step 2: 설정 파일 만들기.** Global Constraints대로 BlueGang 설정 파일을 복사하고, `.gitattributes`(`* text=auto eol=lf`)와 `.gitignore`(`node_modules/`, `dist/`, `coverage/`, `.env`, `r1-results/`)를 만든다. `package.json`의 scripts는 다음과 같다.

```json
{
  "typecheck": "tsc --noEmit",
  "lint": "eslint \"{src,scripts}/**/*.ts\"",
  "format": "prettier --write \"src/**/*.ts\" \"scripts/**/*.ts\"",
  "test": "jest",
  "r1": "ts-node scripts/r1.ts"
}
```

- [ ] **Step 3: 의존성 설치.** 실행: `npm.cmd install`. 확인: `package-lock.json`이 생기고, 계획 1 목록 밖의 패키지가 `dependencies`/`devDependencies`에 없다.
- [ ] **Step 4: 실패하는 테스트 작성**

`src/config/engine.config.spec.ts`:

```ts
import { readEngineConfig } from './engine.config';

describe('readEngineConfig', () => {
  it('기본값은 모든 호출 claude-opus-5-5와 설계 노력 수준', () => {
    const c = readEngineConfig({});
    expect(Object.values(c.models)).toEqual(Array(4).fill('claude-opus-5-5'));
    expect(c.effort).toEqual({ analyze: 'medium', question: 'high', verify: 'high', leak: 'low' });
    expect([c.maxConsecutive, c.maxRegenerations]).toEqual([2, 1]);
  });
  it('환경 변수로 호출별 값을 바꾼다', () => {
    const c = readEngineConfig({ ENGINE_MODEL_LEAK: 'claude-haiku-5-5', ENGINE_EFFORT_QUESTION: 'xhigh' });
    expect(c.models.leak).toBe('claude-haiku-5-5');
    expect(c.effort.question).toBe('xhigh');
  });
  it('잘못된 값은 키 이름과 함께 실패한다', () => {
    expect(() => readEngineConfig({ ENGINE_EFFORT_VERIFY: 'huge' })).toThrow('ENGINE_EFFORT_VERIFY');
    expect(() => readEngineConfig({ ENGINE_MAX_CONSECUTIVE: '0' })).toThrow('ENGINE_MAX_CONSECUTIVE');
  });
});
```

`src/interview/catalog.spec.ts`(결함 × 성향을 다 덮는지는 `REACTION_TABLE`의 `Record` 타입이 typecheck에서 보장하므로 테스트하지 않는다):

```ts
import { AXES, SHARED_AXES, OWNABLE_AXES, ROLES, DEFECT_PRIORITY, QUESTION_INTENTS, REACTION_INTENTS, INTENT_GROUPS } from './catalog';

describe('catalog', () => {
  it('역할의 축은 모두 소유 가능한 축이다', () => {
    for (const role of Object.values(ROLES)) for (const axis of role.axes) expect(OWNABLE_AXES).toContain(axis);
    expect(SHARED_AXES).toEqual(['identity_swap']);
    expect(OWNABLE_AXES).toHaveLength(AXES.length - 1);
  });
  it('결함 우선순위는 설계 6.2 순서', () => {
    const p = DEFECT_PRIORITY;
    expect(p.wrong).toBeGreaterThan(p.missing_axis);
    expect(p.missing_axis).toBeGreaterThan(p.no_why);
    expect(p.no_why).toBe(p.no_tradeoff);
    expect(p.no_tradeoff).toBeGreaterThan(p.vague);
    expect(p.vague).toBe(p.no_evidence);
    expect(p.no_evidence).toBeGreaterThan(p.none);
  });
  it('의도 묶음은 A1–A15, B1–B11을 한 번씩 덮는다', () => {
    expect(Object.values(INTENT_GROUPS.question).flat().sort()).toEqual(Object.keys(QUESTION_INTENTS).sort());
    expect(Object.values(INTENT_GROUPS.reaction).flat().sort()).toEqual(Object.keys(REACTION_INTENTS).sort());
    expect(Object.keys(QUESTION_INTENTS)).toHaveLength(15);
    expect(Object.keys(REACTION_INTENTS)).toHaveLength(11);
  });
});
```

- [ ] **Step 5: 실패 확인.** 실행: `npm.cmd test`. 기대: `Cannot find module './engine.config'`, `'./catalog'`로 FAIL.
- [ ] **Step 6: 구현.** 위 값으로 `catalog.ts`, `types.ts`, `engine.config.ts`를 만든다.
- [ ] **Step 7: 통과 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`. 기대: 모두 통과.
- [ ] **Step 8: Commit** (Step 1에서 승인받은 경우). 설정 파일, `package-lock.json`, `src/`를 add하고 `git commit -m "feat: 프로젝트 준비와 카탈로그"`를 실행한다.

### Task 2: 다음 질문자 규칙

**Files:**
- Create: `src/interview/rules.ts`
- Test: `src/interview/rules.spec.ts`

**Interfaces:**
- Consumes: `ROLES`, `DEFECT_PRIORITY`, `REACTION_TABLE`, `PanelMember`, `Defect`, `Pick` (Task 1)
- Produces: `pickNext(input: { defects: Defect[]; panel: PanelMember[]; history: string[]; maxConsecutive: number }): Pick`
  - `history`는 질문한 면접관 id를 순서대로 담고, 마지막이 가장 최근이다.

규칙(설계 6.2의 4단계)
1. 결함을 우선순위 내림차순으로 정렬한다(같은 우선순위는 원래 순서를 유지).
2. 후보는 `ROLES[role].axes`에 `defect.axis`가 들어 있는 패널 구성원이다. 없으면 패널 전원이 후보다.
3. `history`의 마지막 `maxConsecutive`개가 모두 같은 사람이면 그 사람을 후보에서 뺀다. 그래서 후보가 비면 패널 전원에서 그 사람만 뺀다.
4. 후보가 여럿이면 가장 오래전에 질문한 사람을 고른다. 질문한 적 없는 사람이 먼저이고, 그다음은 패널 순서다.
5. `reactionIntent = REACTION_TABLE[defect.type][member.temperament]`.
6. `secondary`: 첫 결함과 다른 결함 하나가 모두 우선순위 3 이상이고, 그 결함을 1~4 규칙으로 고른 담당(첫 질문자 제외)이 있으면 그 사람이다. 아니면 `null`이다.
- 직전 질문자가 자동으로 이어받는 규칙은 넣지 않는다(설계 13장, 제외됨).

- [ ] **Step 1: 실패하는 테스트 작성** (`src/interview/rules.spec.ts`)

```ts
import { pickNext } from './rules';
import { Defect, PanelMember } from './types';

const panel: PanelMember[] = [
  { id: 'p1', role: 'dba', temperament: 'shaker' },
  { id: 'p2', role: 'textbook', temperament: 'persistent' },
  { id: 'p3', role: 'scenario', temperament: 'helper' },
];
const d = (type: Defect['type'], axis: Defect['axis']): Defect => ({ type, axis, note: '' });
const run = (defects: Defect[], history: string[] = []) => pickNext({ defects, panel, history, maxConsecutive: 2 });

describe('pickNext', () => {
  it('우선순위가 가장 높은 결함의 담당이 질문한다', () => {
    const r = run([d('vague', 'scale'), d('wrong', 'durability')]);
    expect([r.interviewerId, r.defect.type, r.reactionIntent]).toEqual(['p1', 'wrong', 'B9']);
  });
  it('결함 없음이면 성향대로 상향 심화나 확신 시험', () => {
    expect(run([d('none', 'resource_limit')]).reactionIntent).toBe('B1');
    expect(run([d('none', 'durability')]).reactionIntent).toBe('B8');
  });
  it('연속 상한에 걸린 면접관은 건너뛴다', () => {
    expect(run([d('wrong', 'durability')], ['p1', 'p1']).interviewerId).not.toBe('p1');
  });
  it('담당이 없는 축이면 가장 오래전에 질문한 면접관', () => {
    expect(run([d('vague', 'cost')], ['p2', 'p3', 'p1']).interviewerId).toBe('p2');
  });
  it('직전 질문자라는 이유로 이어받지 않는다', () => {
    expect(run([d('vague', 'scale')], ['p1']).interviewerId).toBe('p3');
  });
  it('공동 담당 축은 오래전에 질문한 쪽', () => {
    expect(run([d('vague', 'distribution')], ['p3']).interviewerId).toBe('p1');
  });
  it('높은 결함 두 개의 담당이 다르면 덧붙이기, 아니면 null', () => {
    expect(run([d('wrong', 'durability'), d('missing_axis', 'scale')]).secondary?.interviewerId).toBe('p3');
    expect(run([d('wrong', 'durability'), d('vague', 'scale')]).secondary).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인.** 실행: `npm.cmd test -- src/interview/rules.spec.ts`. 기대: `Cannot find module './rules'`로 FAIL.
- [ ] **Step 3: 구현.** 위 규칙대로 `pickNext`를 만든다.
- [ ] **Step 4: 통과 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`. 기대: 모두 통과.
- [ ] **Step 5: Commit.** `git add src/interview/rules.ts src/interview/rules.spec.ts` 후 `git commit -m "feat: 다음 질문자 규칙"`.

### Task 3: 기술 이름 검사

**Files:**
- Create: `src/interview/naming.ts`
- Test: `src/interview/naming.spec.ts`

**Interfaces:**
- Consumes: `TechMention`, `NamingResult` (Task 1)
- Produces: `checkNaming(input: { techs: TechMention[]; userMentioned: string[] }): NamingResult`
- 규칙(설계 6.3)
  - `role`이 `premise`면 언제나 허용한다.
  - 그 밖의 역할은 정규화한 이름이 `userMentioned`에 있을 때만 허용한다. 정규화는 앞뒤 공백 제거와 소문자화다.
  - 위반 목록에는 원래 이름을 trim해서 넣는다.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/interview/naming.spec.ts`)

```ts
import { checkNaming } from './naming';

describe('checkNaming', () => {
  it('언급하지 않은 해답 기술은 위반', () => {
    expect(checkNaming({ techs: [{ name: 'Kafka', role: 'solution' }], userMentioned: ['Redis'] })).toEqual({ ok: false, violations: ['Kafka'] });
  });
  it('내가 말한 기술은 대소문자·공백이 달라도 허용', () => {
    expect(checkNaming({ techs: [{ name: ' kafka', role: 'solution' }], userMentioned: ['Kafka '] }).ok).toBe(true);
  });
  it('가정 변경의 전제는 안 써 본 기술이어도 허용', () => {
    expect(checkNaming({ techs: [{ name: 'PostgreSQL', role: 'premise' }], userMentioned: [] }).ok).toBe(true);
  });
  it('user로 표시됐지만 실제로 언급하지 않은 기술은 위반', () => {
    expect(checkNaming({ techs: [{ name: 'RabbitMQ', role: 'user' }], userMentioned: ['Redis'] }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인.** 실행: `npm.cmd test -- src/interview/naming.spec.ts`. 기대: FAIL.
- [ ] **Step 3: 구현.** `checkNaming`을 만들고, 정규화 함수 위에 주석을 단다: `// shortcut: 대소문자·공백만 맞춘다. 한글 표기("카프카")·별칭("Postgres")은 못 잡음, R1에서 놓친 사례가 나오면 별칭 표 추가`.
- [ ] **Step 4: 통과 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`. 기대: 모두 통과.
- [ ] **Step 5: Commit.** `git add src/interview/naming.ts src/interview/naming.spec.ts` 후 `git commit -m "feat: 기술 이름 검사"`.

### Task 4: Claude 호출 서비스

**Files:**
- Create: `src/interview/llm/anthropic.provider.ts`, `src/interview/llm/llm.service.ts`
- Test: `src/interview/llm/llm.service.spec.ts`

**Interfaces:**
- Consumes: `engineConfig`, `CallRole` (Task 1), `TokenUsage` (Task 1)
- Produces:
  - `ANTHROPIC_CLIENT`(provider 토큰), `anthropicProvider = { provide: ANTHROPIC_CLIENT, useFactory: () => new Anthropic() }`
  - `class RefusalError extends Error { readonly category: string | null }`
  - `interface JsonRequest { role: CallRole; system: string; user: string; schema: Record<string, unknown> }`
  - `interface JsonLlm { callJson<T>(req: JsonRequest): Promise<{ data: T; usage: TokenUsage; model: string }> }`
  - `@Injectable() class LlmService implements JsonLlm`
    - 생성자: `@Inject(ANTHROPIC_CLIENT) client: Anthropic`, `@Inject(engineConfig.KEY) config: ConfigType<typeof engineConfig>`
- 요청 모양은 Global Constraints대로다. `messages`는 `[{ role: 'user', content: user }]` 하나다.
- 응답 처리
  - `stop_reason === 'refusal'`이면 `RefusalError(stop_details?.category ?? null)`를 던진다.
  - `stop_reason === 'max_tokens'`이면 `Error('max_tokens')`를 던진다.
  - 그 밖에는 첫 `text` 블록을 `JSON.parse`하고(결과는 `unknown`으로 받는다), `usage`에서 `input_tokens`와 `output_tokens`만 돌려준다.
  - SDK의 API 오류(`Anthropic.APIError` 계열)는 잡지 않고 그대로 올린다.
- SDK 타입이 `fallbacks: 'default'`를 받지 않으면, 캐스팅으로 넘기지 말고 설치된 SDK 버전을 확인해 사용자에게 알린다.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/interview/llm/llm.service.spec.ts`)

```ts
import { Test } from '@nestjs/testing';
import { engineConfig, readEngineConfig } from '../../config/engine.config';
import { ANTHROPIC_CLIENT } from './anthropic.provider';
import { LlmService, RefusalError } from './llm.service';

const ok = {
  stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }],
};
async function make(response: object) {
  const create = jest.fn().mockResolvedValue(response);
  const mod = await Test.createTestingModule({
    providers: [
      LlmService,
      { provide: ANTHROPIC_CLIENT, useValue: { beta: { messages: { create } } } },
      { provide: engineConfig.KEY, useValue: readEngineConfig({}) },
    ],
  }).compile();
  return { llm: mod.get(LlmService), create };
}
const call = (llm: LlmService) => llm.callJson({ role: 'question', system: 'S', user: 'U', schema: { type: 'object' } });

describe('LlmService', () => {
  it('호출별 모델·노력, 폴백, 스키마를 요청에 싣고 사용량만 돌려준다', async () => {
    const { llm, create } = await make(ok);
    const out = await call(llm);
    expect(out).toEqual({ data: { a: 1 }, usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-opus-5-5' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-opus-5-5', max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      system: 'S', messages: [{ role: 'user', content: 'U' }],
      output_config: { effort: 'high', format: { type: 'json_schema', schema: { type: 'object' } } },
    }));
    expect(create.mock.calls[0][0]).not.toHaveProperty('thinking');
  });
  it('거절은 RefusalError', async () => {
    const { llm } = await make({ ...ok, stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] });
    await expect(call(llm)).rejects.toBeInstanceOf(RefusalError);
  });
  it('max_tokens로 잘리면 오류', async () => {
    const { llm } = await make({ ...ok, stop_reason: 'max_tokens' });
    await expect(call(llm)).rejects.toThrow('max_tokens');
  });
});
```

- [ ] **Step 2: 실패 확인.** 실행: `npm.cmd test -- src/interview/llm`. 기대: FAIL.
- [ ] **Step 3: 구현.** `anthropic.provider.ts`와 `llm.service.ts`를 만든다.
- [ ] **Step 4: 통과 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`. 기대: 모두 통과.
- [ ] **Step 5: Commit.** `git add src/interview/llm` 후 `git commit -m "feat: Claude 호출 서비스"`.

### Task 5: 질문 호출 (질문 + 숨은 정답지)

**Files:**
- Create: `src/interview/calls/question.call.ts`
- Test: `src/interview/calls/question.call.spec.ts`

**Interfaces:**
- Consumes: `AXES`, `ROLES`, `TEMPERAMENTS`, `QUESTION_INTENTS`, `REACTION_INTENTS`, `QuestionInput`, `Question`, `TokenUsage` (Task 1), `JsonLlm` (Task 4)
- Produces:
  - `REQUIRED_RULES: string`(아래 문장 그대로)
  - `ANSWER_KEY_SCHEMA`, `QUESTION_SCHEMA`(JSON Schema 객체). 모든 필드는 required이고, 모든 객체에 `additionalProperties: false`, null은 없다.
    - enum은 카탈로그에서 만든다. `questionIntent`는 `QUESTION_INTENTS` 키, `assumption.axis`는 AXES id 뒤에 `'none'`.
  - `buildQuestionPrompt(input: QuestionInput): { system: string; user: string }`
  - `generateQuestion(llm: JsonLlm, input: QuestionInput): Promise<{ data: Question; usage: TokenUsage }>`(`role: 'question'`)

`REQUIRED_RULES` (시스템 프롬프트에 그대로 넣는 문장. 출처: 설계 5.1, 5.3, 6.3, 6.4)

```
- 질문은 한 번에 하나만 한다. 질문 의도는 말하지 않는다.
- 면접 중에는 피드백하거나 가르치지 않는다.
- 1단계에는 서류가 없다. 지원자의 답변 속 주장을 서류 대신 쓴다. 코드는 읽지 않는다.
- 먼저 꺼내도 되는 기술: 지원자가 먼저 말한 기술, 가정 변경의 전제로 쓰는 기술(지원자가 써 보지 않은 기술이어도 된다).
- 금지: 지원자의 문제에 대한 해답 후보인데 지원자가 언급한 적 없는 기술, 그리고 그 기술이 문제를 푸는 특징.
- X: "이러한 기술은 왜 고려하지 않으셨나요?"
- X: "이러한 기술도 이런 특징으로 해결할 수 있는데 알고 계셨나요?"
- O: "사용하신 기술 말고 다른 대안은 없었을까요?"
- O: "대안이 있었다는 걸 아셨는데 왜 그 기술을 사용했나요?"
- 가정 변경 질문은 장단점을 만드는 원인 하나를 바꿔, 무엇이 사라지고 무엇이 남는지 묻게 만든다.
- 숨은 정답지는 정확해야 한다. 확실하지 않은 사실은 정답지에 넣지 않는다.
```

시스템 프롬프트의 나머지(페르소나 서술: "기술 지식은 시니어 수준으로 완벽", 교과형은 "학부 전 과목 시험 항상 100점")는 구현자가 쓴다. user 프롬프트에는 다음을 사람이 읽을 수 있게 넣는다.
- `topic`
- 면접관의 직무 이름과 성향 이름
- `reactionIntent`가 있으면 `id 이름`(예: `B9 수용성 시험`)과 `defect.note`
- `targetAxis`가 있으면 그 축의 이름과 "이 축으로 가정 변경 질문을 한다"
- 대화 기록, `userMentioned`
- `feedback`이 있으면 각 줄

- [ ] **Step 1: 실패하는 테스트 작성** (`src/interview/calls/question.call.spec.ts`)

```ts
import { AXES, QUESTION_INTENTS } from '../catalog';
import { QuestionInput } from '../types';
import { REQUIRED_RULES, QUESTION_SCHEMA, buildQuestionPrompt, generateQuestion } from './question.call';

const input: QuestionInput = {
  topic: 'Redis', interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' }, reactionIntent: 'B9',
  defect: { type: 'wrong', axis: 'durability', note: 'AOF 설명 오류' }, targetAxis: 'identity_swap',
  history: [{ interviewerId: 'p2', text: 'Q', answer: 'A' }], userMentioned: ['Redis'], feedback: ['Kafka를 꺼내지 마라'],
};
type Props = { questionIntent: { enum: string[] }; assumption: { properties: { axis: { enum: string[] } } } };

describe('question.call', () => {
  it('스키마 enum은 카탈로그와 같다', () => {
    const p = QUESTION_SCHEMA.properties as unknown as Props;
    expect(p.questionIntent.enum).toEqual(Object.keys(QUESTION_INTENTS));
    expect(p.assumption.properties.axis.enum).toEqual([...AXES.map((a) => a.id), 'none']);
    expect(QUESTION_SCHEMA.additionalProperties).toBe(false);
  });
  it('시스템 프롬프트에 규칙 문장이 그대로 있다', () => {
    expect(buildQuestionPrompt(input).system).toContain(REQUIRED_RULES);
    expect(REQUIRED_RULES).toContain('O: "사용하신 기술 말고 다른 대안은 없었을까요?"');
  });
  it('user 프롬프트에 입력이 들어간다', () => {
    const { user } = buildQuestionPrompt(input);
    for (const s of ['Redis', 'DBA', '흔드는형', 'B9', 'AOF 설명 오류', '정체성 비교', 'Kafka를 꺼내지 마라']) expect(user).toContain(s);
  });
  it('question 역할과 스키마로 호출한다', async () => {
    const callJson = jest.fn().mockResolvedValue({ data: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: 'm' });
    await generateQuestion({ callJson }, input);
    expect(callJson).toHaveBeenCalledWith(expect.objectContaining({ role: 'question', schema: QUESTION_SCHEMA }));
  });
});
```

- [ ] **Step 2: 실패 확인.** 실행: `npm.cmd test -- src/interview/calls/question`. 기대: FAIL.
- [ ] **Step 3: 구현.** `question.call.ts`를 만든다.
- [ ] **Step 4: 통과 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`. 기대: 모두 통과.
- [ ] **Step 5: Commit.** `git add src/interview/calls/question.call.ts src/interview/calls/question.call.spec.ts` 후 `git commit -m "feat: 질문 호출"`.

### Task 6: 분석, 정답지 검증, 흘림 검사 호출

**Files:**
- Create: `src/interview/calls/analyze.call.ts`, `src/interview/calls/verify.call.ts`, `src/interview/calls/leak.call.ts`
- Test: `src/interview/calls/calls.spec.ts`

**Interfaces:**
- Consumes: `DEFECT_TYPES`, `OWNABLE_AXES`, `Analysis`, `Verification`, `TechMention`, `Question`, `TokenUsage` (Task 1), `ANSWER_KEY_SCHEMA`, `REQUIRED_RULES` (Task 5), `JsonLlm` (Task 4)
- Produces:
  - `ANALYZE_SCHEMA`, `analyzeAnswer(llm: JsonLlm, input: { topic: string; question: Question; answer: string }): Promise<{ data: Analysis; usage: TokenUsage }>`(`role: 'analyze'`)
    - enum: `kind`는 `['answer', 'clarify']`, `defects[].type`는 `DEFECT_TYPES`, `defects[].axis`는 `OWNABLE_AXES`
  - `VERIFY_SCHEMA`, `verifyAnswerKey(llm: JsonLlm, input: { topic: string; question: Question }): Promise<{ data: Verification; usage: TokenUsage }>`(`role: 'verify'`)
  - `LEAK_SCHEMA`, `detectTechs(llm: JsonLlm, input: { questionText: string; userMentioned: string[] }): Promise<{ data: { techs: TechMention[] }; usage: TokenUsage }>`(`role: 'leak'`)
    - enum: `techs[].role`은 `['premise', 'solution', 'user']`

프롬프트가 꼭 담을 것(문장은 구현자가 쓴다)
- **analyze**
  - 결함 유형 정의: `wrong` 오답 의심, `missing_axis` 축 누락, `no_why` why 없음, `no_tradeoff` 트레이드오프 누락, `vague` 모호함, `no_evidence` 근거 없음, `none` 결함 없음.
  - 결함마다 가장 가까운 축 하나를 고른다.
  - 입력이 질문을 되묻는 것이면 `kind: 'clarify'`로 둔다.
  - 답변에서 지원자가 말한 기술 이름을 모두 `mentionedTechs`에 넣는다.
  - 판정의 기준은 질문의 숨은 정답지(`question.answerKey`)다.
- **verify**
  - 질문 문장의 전제(`assumption.statement`와 `text`)와 정답지의 사실을 검사한다.
  - 틀린 곳은 `problems`에 적고, 고친 정답지를 돌려준다. 문제가 없으면 받은 정답지를 그대로 돌려준다.
- **leak**
  - 질문 문장에 나온 기술 이름을 모두 나열하고 역할을 붙인다.
    - `premise`: 가정 변경의 비교 전제로 쓰였다.
    - `user`: `userMentioned`에 있다.
    - `solution`: 지원자의 문제에 대한 대안으로 제시됐다.
  - 판단 기준으로 `REQUIRED_RULES`의 O/X 예시를 넣는다.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/interview/calls/calls.spec.ts`)

```ts
import { DEFECT_TYPES, OWNABLE_AXES } from '../catalog';
import { Question } from '../types';
import { ANALYZE_SCHEMA, analyzeAnswer } from './analyze.call';
import { VERIFY_SCHEMA, verifyAnswerKey } from './verify.call';
import { LEAK_SCHEMA, detectTechs } from './leak.call';

const question: Question = {
  text: '인메모리 PostgreSQL이라면 Redis와 뭐가 다를까요?', questionIntent: 'A1',
  assumption: { axis: 'identity_swap', statement: 'PostgreSQL이 디스크 없이 동작' },
  answerKey: { vanishing: ['디스크 I/O'], remaining: ['데이터 모델'], alternatives: [], keyPoints: ['MVCC'] },
};
const enumAt = (schema: object, path: string[]): unknown =>
  path.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, schema as Record<string, unknown>).enum;

describe('analyze / verify / leak 호출', () => {
  it('스키마 enum은 카탈로그와 같다', () => {
    expect(enumAt(ANALYZE_SCHEMA, ['properties', 'defects', 'items', 'properties', 'type'])).toEqual(DEFECT_TYPES);
    expect(enumAt(ANALYZE_SCHEMA, ['properties', 'defects', 'items', 'properties', 'axis'])).toEqual(OWNABLE_AXES);
    expect(enumAt(ANALYZE_SCHEMA, ['properties', 'kind'])).toEqual(['answer', 'clarify']);
    expect(enumAt(LEAK_SCHEMA, ['properties', 'techs', 'items', 'properties', 'role'])).toEqual(['premise', 'solution', 'user']);
  });
  it('세 호출은 각자 역할·스키마로 부르고 입력을 프롬프트에 싣는다', async () => {
    const callJson = jest.fn().mockResolvedValue({ data: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: 'm' });
    await analyzeAnswer({ callJson }, { topic: 'Redis', question, answer: 'MVCC 때문에...' });
    await verifyAnswerKey({ callJson }, { topic: 'Redis', question });
    await detectTechs({ callJson }, { questionText: question.text, userMentioned: ['Redis'] });
    const reqs = callJson.mock.calls.map(([req]) => req as { role: string; schema: object; user: string });
    expect(reqs.map((r) => r.role)).toEqual(['analyze', 'verify', 'leak']);
    expect(reqs.map((r) => r.schema)).toEqual([ANALYZE_SCHEMA, VERIFY_SCHEMA, LEAK_SCHEMA]);
    expect(reqs[0].user).toContain('MVCC 때문에');
    expect(reqs[1].user).toContain('PostgreSQL이 디스크 없이 동작');
    expect(reqs[2].user).toContain('Redis');
  });
});
```

- [ ] **Step 2: 실패 확인.** 실행: `npm.cmd test -- src/interview/calls/calls`. 기대: FAIL.
- [ ] **Step 3: 구현.** 세 파일을 만든다. 파일마다 스키마, 프롬프트 빌더, 실행 함수를 둔다.
- [ ] **Step 4: 통과 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`. 기대: 모두 통과.
- [ ] **Step 5: Commit.** `git add src/interview/calls` 후 `git commit -m "feat: 분석·검증·흘림 검사 호출"`.

### Task 7: 턴 조립 서비스와 엔진 모듈

**Files:**
- Create: `src/interview/turn.service.ts`, `src/interview/engine.module.ts`
- Test: `src/interview/turn.service.spec.ts`

**Interfaces:**
- Consumes: `generateQuestion` (Task 5), `analyzeAnswer`, `verifyAnswerKey`, `detectTechs` (Task 6), `checkNaming` (Task 3), `pickNext` (Task 2), `LlmService`, `anthropicProvider` (Task 4), `engineConfig`, `ROLES`, `OWNABLE_AXES`, 타입들 (Task 1)
- Produces:
  - `@Injectable() class TurnService`
    - 생성자: `LlmService`, `@Inject(engineConfig.KEY) config`
    - `prepareQuestion(input: QuestionInput): Promise<PreparedQuestion>`
    - `handleAnswer(input: AnswerInput): Promise<AnswerResult>`
  - `@Module({ imports: [ConfigModule.forFeature(engineConfig)], providers: [anthropicProvider, LlmService, TurnService], exports: [LlmService, TurnService] }) class EngineModule`

`prepareQuestion` 규칙(설계 6.2의 5·6단계)
1. 시도는 최대 `1 + config.maxRegenerations`번이다. 매 시도마다 다음을 한다.
   - `generateQuestion`을 부른다.
   - `detectTechs`를 부른 뒤 `checkNaming`으로 판정한다.
   - 이름 규칙을 통과했고 `assumption.axis !== 'none'`이면, 보여 주기 전에 `verifyAnswerKey`를 부른다.
2. 이름 위반이면 다음 시도의 `feedback`에 `해답으로 꺼내면 안 되는 기술: <이름들>`을 넣는다. 전제 오류(`premiseOk: false`)이면 `problems`의 문장들을 넣는다.
3. 통과하면 멈춘다. 끝까지 통과하지 못하면 마지막 시도를 돌려주고 `flags`에 표시한다.
4. 검증이 정답지를 고쳤으면(`problems.length > 0`) `question.answerKey`를 고친 것으로 바꾸고 `answerKeyCorrected: true`로 둔다.
5. 가정이 `'none'`인 질문은 `verification: null`이다. 그 정답지 검증은 호출하는 쪽이 따로 돌린다.

`handleAnswer` 규칙
1. `userMentioned`에 `analysis.mentionedTechs`를 합쳐 순서를 지키며 중복을 없앤다.
2. `kind === 'clarify'`이면 `pick: null`이다.
3. 결함이 비어 있으면 `[{ type: 'none', axis, note: '' }]`로 본다. `axis`는 `question.assumption.axis`가 `OWNABLE_AXES`에 있으면 그 축이고, 아니면 `askedBy` 면접관 역할의 첫 축이다.
4. `pickNext`를 `config.maxConsecutive`로 부른다.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/interview/turn.service.spec.ts`)

```ts
import { Test } from '@nestjs/testing';
import { engineConfig, readEngineConfig } from '../config/engine.config';
import { LlmService } from './llm/llm.service';
import { TurnService } from './turn.service';
import { AnswerKey, PanelMember, Question, QuestionInput } from './types';

// 호출 역할별 응답 큐를 차례로 돌려주는 가짜 LlmService
function fakeLlm(queues: Record<string, unknown[]>) {
  const calls: { role: string; user: string }[] = [];
  const callJson = (req: { role: string; user: string }) => {
    calls.push(req);
    return Promise.resolve({ data: queues[req.role].shift(), usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' });
  };
  return { calls, llm: { callJson } };
}
async function service(queues: Record<string, unknown[]>) {
  const fake = fakeLlm(queues);
  const mod = await Test.createTestingModule({
    providers: [TurnService, { provide: LlmService, useValue: fake.llm }, { provide: engineConfig.KEY, useValue: readEngineConfig({}) }],
  }).compile();
  return { turn: mod.get(TurnService), calls: fake.calls };
}
const key = (keyPoints: string[] = ['k']): AnswerKey => ({ vanishing: [], remaining: [], alternatives: [], keyPoints });
const q = (axis: Question['assumption']['axis'], text = 'Q'): Question => ({ text, questionIntent: 'A1', assumption: { axis, statement: 's' }, answerKey: key() });
const base: QuestionInput = {
  topic: 'Redis', interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' }, reactionIntent: null,
  defect: null, targetAxis: null, history: [], userMentioned: ['Redis'], feedback: [],
};
const panel: PanelMember[] = [{ id: 'p1', role: 'dba', temperament: 'shaker' }, { id: 'p2', role: 'textbook', temperament: 'persistent' }];

describe('TurnService.prepareQuestion', () => {
  it('이름 위반이면 피드백을 붙여 한 번 다시 만든다', async () => {
    const { turn, calls } = await service({
      question: [q('none', 'Kafka는요?'), q('none', '다른 대안은요?')],
      leak: [{ techs: [{ name: 'Kafka', role: 'solution' }] }, { techs: [] }],
    });
    const r = await turn.prepareQuestion(base);
    expect(r.question.text).toBe('다른 대안은요?');
    expect(calls[2].user).toContain('Kafka');
    expect(r.flags.leak).toBe(false);
  });
  it('가정 변경 질문은 보여 주기 전에 검증하고, 고친 정답지를 쓴다', async () => {
    const fixed = key(['고침']);
    const { turn, calls } = await service({
      question: [q('identity_swap')], leak: [{ techs: [] }],
      verify: [{ premiseOk: true, problems: [{ field: 'keyPoints', problem: '틀림' }], answerKey: fixed }],
    });
    const r = await turn.prepareQuestion(base);
    expect(calls.map((c) => c.role)).toEqual(['question', 'leak', 'verify']);
    expect(r.question.answerKey).toEqual(fixed);
    expect(r.answerKeyCorrected).toBe(true);
  });
  it('가정 없는 질문은 미리 검증하지 않는다', async () => {
    const { turn } = await service({ question: [q('none')], leak: [{ techs: [] }] });
    expect((await turn.prepareQuestion(base)).verification).toBeNull();
  });
  it('전제가 틀리면 다시 만들고, 끝까지 틀리면 flags.premise', async () => {
    const bad = { premiseOk: false, problems: [{ field: 'text', problem: '전제 오류' }], answerKey: key() };
    const { turn, calls } = await service({
      question: [q('identity_swap'), q('identity_swap')], leak: [{ techs: [] }, { techs: [] }], verify: [bad, bad],
    });
    const r = await turn.prepareQuestion(base);
    expect(calls[3].user).toContain('전제 오류');
    expect(r.flags.premise).toBe(true);
  });
});

describe('TurnService.handleAnswer', () => {
  it('되묻기면 질문자를 바꾸지 않고 언급 기술은 합친다', async () => {
    const { turn } = await service({ analyze: [{ kind: 'clarify', defects: [], mentionedTechs: ['Redis', 'Lua'] }] });
    const r = await turn.handleAnswer({
      topic: 'Redis', panel, history: ['p1'], askedBy: 'p1', question: q('durability'),
      answer: '영속성 관점에서 여쭤보시는 건가요?', userMentioned: ['Redis'],
    });
    expect(r.pick).toBeNull();
    expect(r.userMentioned).toEqual(['Redis', 'Lua']);
  });
  it('결함이 비면 질문 축(공유 축이면 질문자의 첫 축)의 결함 없음으로 본다', async () => {
    const { turn } = await service({ analyze: [{ kind: 'answer', defects: [], mentionedTechs: [] }] });
    const r = await turn.handleAnswer({
      topic: 'Redis', panel, history: ['p2'], askedBy: 'p2', question: q('identity_swap'), answer: '...', userMentioned: [],
    });
    expect(r.pick?.defect).toEqual({ type: 'none', axis: 'resource_limit', note: '' });
  });
});
```

- [ ] **Step 2: 실패 확인.** 실행: `npm.cmd test -- src/interview/turn`. 기대: FAIL.
- [ ] **Step 3: 구현.** 위 규칙대로 `turn.service.ts`와 `engine.module.ts`를 만든다.
- [ ] **Step 4: 통과 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`. 기대: 모두 통과.
- [ ] **Step 5: Commit.** `git add src/interview/turn.service.ts src/interview/turn.service.spec.ts src/interview/engine.module.ts` 후 `git commit -m "feat: 턴 조립 서비스와 엔진 모듈"`.

### Task 8: R1 실행기, 시나리오, 리포트

**Files:**
- Create: `scripts/r1/report.ts`, `scripts/r1/r1.module.ts`, `scripts/r1/scenarios.json`, `scripts/r1.ts`
- Test: `scripts/r1/report.spec.ts`

**Interfaces:**
- Consumes: `TurnService`, `EngineModule` (Task 7), `LlmService`, `RefusalError` (Task 4), `verifyAnswerKey` (Task 6), `engineConfig` (Task 1), 카탈로그 이름 표와 타입들 (Task 1)
- Produces (`scripts/r1/report.ts`)
  - `interface R1Step { prepared: PreparedQuestion; lateVerification: Verification | null }`
  - `interface R1FollowUp { answerKind: string; answer: string; analysis: Analysis; pick: Pick | null; next: R1Step | null }`
  - `interface R1Result { scenarioId: string; topic: string; panel: PanelMember[]; first: R1Step | null; followUps: R1FollowUp[]; usage: TokenUsage[]; error: string | null }`
    - `error`가 있으면 `first`는 `null`일 수 있고 `followUps`는 비어 있을 수 있다. 리포트는 이 경우에도 깨지지 않는다.
  - `sumUsage(usages: TokenUsage[]): TokenUsage`
  - `renderReport(run: { startedAt: string; results: R1Result[] }): string`(마크다운)
  - `lateVerification`은 가정이 없는 질문을 나중에 검증한 결과다. 없으면 `null`이다.
- `scripts/r1/r1.module.ts`: `@Module({ imports: [ConfigModule.forRoot({ load: [engineConfig] }), EngineModule] }) class R1Module`. `.env`는 `ConfigModule.forRoot`가 읽는다.
- 시나리오 파일 형식
  - `{ id, topic, panel: PanelMember[], first: { interviewerId, targetAxis }, answers: { kind, text }[] }[]`
  - `answers`는 첫 질문에 대한 지원자 답이다. 답마다 후속 질문을 하나씩 만든다.

**시나리오** (`scripts/r1/scenarios.json`. 답 문장은 구현자가 한국어로 쓰고, 핵심 주장은 아래를 지킨다)

| id | topic | panel | first | answers (kind: 핵심 주장) |
|---|---|---|---|---|
| `redis-identity` | Redis | dba/shaker, textbook/persistent, scenario/helper | dba, `identity_swap` | good: 디스크 I/O 차이는 줄지만 데이터 모델·명령 처리 방식·트랜잭션 보장 차이는 남음 / vague: "둘 다 메모리라 비슷하고 PostgreSQL이 기능이 더 많음" / wrong: "Redis는 명령을 여러 스레드가 동시에 실행해서 더 빠름" |
| `redis-queue` | Redis | architect/persistent, dba/helper, scenario/shaker | architect, `tech_swap` | good: List + BRPOP으로 대기열을 만들고 유실 위험과 재처리 한계를 짚음(Redis 말고 다른 기술은 언급 안 함) / vague: "Redis로 큐 만들면 빠르고 편함" |
| `node-premise` | NodeJS | textbook/shaker, scenario/persistent, security/helper | textbook, `cs_premise` | good: 메모리 접근 비용이 커지면 이벤트 루프의 장점 일부가 사라지는 이유를 설명 / wrong: "이벤트 루프는 요청마다 스레드를 새로 만든다" |

`redis-queue`는 흘림 규칙을 시험하는 시나리오다. 후속 질문이 Kafka나 RabbitMQ 같은 이름을 먼저 꺼내지 않아야 한다.

**리포트**에는 다음을 담는다.
- 시나리오별: 패널(직무·성향 이름), 첫 질문과 후속 질문마다 다음 항목
  - 질문 문장, 숨은 질문 의도(`A1 원리 이해` 형식), 바뀐 가정(축 이름과 문장), 숨은 정답지 전체
  - 검증 결과. 고쳤으면 `정답지 수정됨`
  - 흘림 검사: 첫 시도의 위반 이름과 재생성 횟수
  - `flags`
- 후속마다: 분석 결과(결함 유형·축·메모), 고른 면접관과 반응 의도(`B9 수용성 시험`), `secondary`
- 질문마다 사용자 검토 체크리스트
  - `- [ ] 예상 밖인가`
  - `- [ ] 정답지가 정확한가`
  - `- [ ] 해답을 흘리지 않았나`
  - `- [ ] 의도가 질문에 드러나지 않았나`
- 시나리오별과 전체 사용량(`input_tokens`, `output_tokens`). 오류가 있으면 `오류: <메시지>`.

- [ ] **Step 1: 실패하는 테스트 작성** (`scripts/r1/report.spec.ts`)

```ts
import { PreparedQuestion } from '../../src/interview/types';
import { R1Result, renderReport, sumUsage } from './report';

const prepared: PreparedQuestion = {
  question: {
    text: '인메모리 PostgreSQL이라면?', questionIntent: 'A1', assumption: { axis: 'identity_swap', statement: '디스크 없음' },
    answerKey: { vanishing: ['디스크 I/O'], remaining: ['데이터 모델'], alternatives: [{ name: 'Memcached', traits: '단순 KV' }], keyPoints: [] },
  },
  verification: { premiseOk: true, problems: [{ field: 'x', problem: 'y' }], answerKey: { vanishing: [], remaining: [], alternatives: [], keyPoints: [] } },
  answerKeyCorrected: true, flags: { leak: false, premise: false }, usage: [],
  attempts: [],
};
prepared.attempts = [
  { question: prepared.question, naming: { ok: false, violations: ['Kafka'] }, verification: null },
  { question: prepared.question, naming: { ok: true, violations: [] }, verification: prepared.verification },
];
const results: R1Result[] = [
  {
    scenarioId: 'redis-identity', topic: 'Redis', panel: [{ id: 'p1', role: 'dba', temperament: 'shaker' }],
    first: { prepared, lateVerification: null },
    followUps: [{
      answerKind: 'wrong', answer: '...', analysis: { kind: 'answer', defects: [{ type: 'wrong', axis: 'durability', note: 'n' }], mentionedTechs: [] },
      pick: { interviewerId: 'p1', defect: { type: 'wrong', axis: 'durability', note: 'n' }, reactionIntent: 'B9', secondary: null },
      next: { prepared, lateVerification: null },
    }],
    usage: [{ input_tokens: 3, output_tokens: 4 }, { input_tokens: 5, output_tokens: 6 }], error: null,
  },
  { scenarioId: 'node-premise', topic: 'NodeJS', panel: [], first: null, followUps: [], usage: [], error: 'refusal: cyber' },
];

describe('R1 report', () => {
  it('사용량을 합친다', () => {
    expect(sumUsage(results[0].usage)).toEqual({ input_tokens: 8, output_tokens: 10 });
  });
  it('검토할 항목이 모두 들어간다', () => {
    const md = renderReport({ startedAt: '2026-11-16T00:00:00Z', results });
    for (const s of ['인메모리 PostgreSQL이라면?', 'A1 원리 이해', '디스크 없음', 'Memcached', '정답지 수정됨', 'Kafka',
      'B9 수용성 시험', 'DBA', '흔드는형', '- [ ] 예상 밖인가', '- [ ] 해답을 흘리지 않았나', '오류: refusal: cyber']) {
      expect(md).toContain(s);
    }
  });
});
```

- [ ] **Step 2: 실패 확인.** 실행: `npm.cmd test -- scripts/r1`. 기대: FAIL.
- [ ] **Step 3: 구현.** `scripts/r1/report.ts`에 `sumUsage`와 `renderReport`를 만든다.
- [ ] **Step 4: 통과 확인.** 실행: `npm.cmd test -- scripts/r1`. 기대: PASS.
- [ ] **Step 5: 시나리오 파일 작성.** 위 표대로 `scripts/r1/scenarios.json`을 만든다.
- [ ] **Step 6: `r1.module.ts`와 `scripts/r1.ts` 구현.**
  - 사용법: `npm.cmd run r1 -- [시나리오id]`(없으면 전부 실행).
  - `NestFactory.createApplicationContext(R1Module, { logger: ['error', 'warn'] })`로 띄우고 `TurnService`와 `LlmService`를 꺼낸다. 끝나면 `app.close()`를 부른다.
  - 시나리오마다 다음을 한다.
    - 첫 질문을 `prepareQuestion`으로 만든다. 입력은 `targetAxis`, `reactionIntent: null`, `userMentioned: [topic]`이다.
    - 가정이 없는 질문이면 `verifyAnswerKey(llmService, …)`로 `lateVerification`을 채운다.
    - 각 답마다 `handleAnswer`를 부른다. `pick`이 있으면 그 면접관으로 후속 질문을 `prepareQuestion`으로 만든다(`reactionIntent`, `defect`, `history`, 합쳐진 `userMentioned` 포함).
  - 시나리오 하나는 `try/catch`로 감싼다. 실패하면 `error`에 `RefusalError`면 `refusal: <category>`, 아니면 `error.message`를 넣고 다음 시나리오로 간다. 스택은 넣지 않는다.
  - 결과는 `r1-results/<startedAt에서 :를 -로 바꾼 것>.md`에 쓰고 경로를 출력한다.
- [ ] **Step 7: 전체 확인.** 실행: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`. 기대: 모두 통과.
- [ ] **Step 8: Commit.** `git add scripts` 후 `git commit -m "feat: R1 실행기"`.
- [ ] **Step 9: 시나리오 하나로 시험 실행 (사용자 승인 후).** 실제 API를 부르므로 실행 전에 승인받는다. 실행: `npm.cmd run r1 -- redis-identity`. 기대: `r1-results/...md` 경로가 출력되고 종료 코드 0. 리포트에 `오류:` 줄이 없다.
  - `fallbacks`와 `output_config.format`을 함께 보낸 요청이 400이면, 오류 메시지를 사용자에게 보여 준다. 그다음 `fallbacks`를 뺄지 묻는다.
  - `max_tokens` 오류가 나면 생각 토큰까지 16000 안에 들어가지 않는다는 뜻이다. 사용자에게 알리고, 그 호출의 effort를 낮출지 스트리밍으로 바꿔 상한을 올릴지 묻는다.
- [ ] **Step 10: 전체 실행 (사용자 승인 후).** 실행: `npm.cmd run r1`. 기대: 리포트 하나에 세 시나리오가 모두 있다. 사용량 합계를 사용자에게 알린다.

## 체크포인트: R1 검토 (구현 아님)

- [ ] 리포트 경로를 사용자에게 주고, 질문마다 체크리스트를 채워 달라고 한다.
- [ ] 사용자의 판단을 `docs/r1-review.md`에 [결정]으로 적는다. 그 결과로 바꿀 프롬프트, 카탈로그 값, 규칙도 함께 적는다.
- [ ] 다음은 R1이 통과했을 때만 한다. 계획 2(아래 범위)를 superpowers:writing-plans로 쓴다. 통과하지 못하면 고칠 점을 사용자와 정하고, R1을 다시 돈다.

## 계획 2 범위 (R1 이후 작성, 이 계획에서는 구현하지 않음)

설계에서 이 계획이 다루지 않는 부분이다. 스택은 설계 3장의 결정을 따른다.
- **NestJS HTTP API**(`@nestjs/platform-express`): 면접 시작, 답 제출, 복기 조회
- **TypeORM + PostgreSQL 18**
  - 대상: 세션, 턴, 가정별 기록, 사용량
  - 마이그레이션은 BlueGang처럼 `data-source.ts`로 관리한다.
  - 이 프로젝트 전용 compose, 포트, 볼륨을 쓴다.
- **React 19 + Vite 8 + Tailwind 4 화면**(`frontend/web`, BlueGang 구성을 따름): 시작, 면접, 복기
- **면접 진행 규칙**
  - 패널 구성: 직무형 1 + 교과형 1 + 시나리오형 1, 성향은 무작위 배정
  - 되묻기 응답: 같은 면접관이 범위와 조건만 답한다.
  - 덧붙이기(`secondary`) 표시, 끼어들기 흉내
  - 한 판에 가정 변경 질문 최소 1개 보장, 질문 수 상한으로 종료
  - 가정 없는 질문의 정답지는 사용자가 답을 쓰는 동안 검증한다.
  - 답 시작까지 걸린 시간을 측정한다.
- **복기**: 판정 재검사, 의도 묶음 공개, 바뀐 가정·사라진 차이·남은 차이, "예상 밖" 표시, 판정 수정
- **기억**: 가정 단위 은퇴와 재출제, 주제 연결 조건
- **사용량 표시**: 면접마다 보여 준다.

# 압박 면접 스킬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱의 압박 면접 한 판(시작, 질문, 답, 복기, 기억)을 서버 없이 Claude Code 스킬 `/pressure-interview`로 돌린다.

**Architecture:** 주 세션(진행자)은 Node 엔진 명령 하나를 돌리고 엔진이 준 문장만 보여 준다. 엔진은 앱에서 코드였던 규칙을 그대로 돌리고, 모델이 필요한 곳에서만 `claude -p`를 따로 띄운다. 앱의 규칙·프롬프트 소스와 그 테스트는 손으로 옮겨 적지 않고 도구로 옮긴다.

**Tech Stack:** Node 24(내장 모듈만, 의존성 없음), `node:test`, Claude Code 명령줄 `claude -p`.

**Spec:** [`docs/specs/2026-11-18-pressure-interview-skill-design.md`](../specs/2026-11-18-pressure-interview-skill-design.md) (사용자 승인 2026-11-18). 실행하는 쪽은 이 계획과 함께 읽는다.

표기: **[제안]** 은 이 계획에서 Claude가 정한 것이다. 설계 14장이 만드는 쪽에 맡긴 것과, 설계와 다르게 한 곳에 붙였다. 이 계획은 검토자 둘의 지적 30건을 반영한 판이다.

## Global Constraints

- 작업 위치는 worktree `C:\Users\dosac\projects\interview-skill`, 브랜치 `feat/pressure-interview-skill`이다. 주 checkout(`C:\Users\dosac\projects\interview`), 포트 3110의 프로세스, Docker 컨테이너를 건드리지 않는다.
- 새 파일은 `plugin/`과 `tools/` 아래에만 만든다. `src/`, `frontend/`, `test/`, 저장소 뿌리의 설정 파일은 고치지 않는다(Task 8의 README 한 단락은 예외).
- 의존성을 더하지 않는다. `node:` 내장 모듈만 쓴다. 파일 확장자는 `.mjs`다.
- 옮기는 기준 커밋은 `aeae0dd`다. 앱 소스는 `git show aeae0dd:<경로>`로 읽는다. 이 브랜치의 `src/`는 그보다 옛것이다.
- `plugin/skills/pressure-interview/scripts/lib/app/`과 `plugin/test/app/` 아래는 도구가 만든 파일이다. 손으로 고치지 않는다. 바꿀 일이 있으면 `tools/port-app-src.mjs`를 고쳐 다시 만든다.
- 프롬프트의 글자를 바꾸지 않는다. 바꿔야 할 곳이 나오면 멈추고 올린다.
- 테스트와 태스크의 어느 단계도 실제 모델을 부르지 않는다. `claude -p`를 직접 돌리지 않는다. 모델 호출이 필요한 테스트는 가짜 실행기(Task 3)를 쓴다.
- 테스트는 실제 홈(`~/.pressure-interview`, `~/.claude`)을 건드리지 않는다. `PRESSURE_INTERVIEW_HOME`과 임시 폴더만 쓴다. 임시 폴더의 이름에는 공백과 한글을 넣는다(`fs.mkdtempSync(path.join(os.tmpdir(), '면접 기록 '))`).
- 엔진 명령은 표준 출력에 JSON 하나만 내고 표준 오류에는 아무것도 쓰지 않는다. 숨길 내용(질문 의도, 가정 문장, 정답지, 결함 판정과 메모, 반응 의도, 성향, 모델의 원래 응답, 원래 오류 문장)은 어떤 명령의 출력에도 넣지 않는다.
- 엔진은 실패한 모델 호출을 스스로 다시 부르지 않는다. 다시 하는 것은 사용자가 정한다.
- 전체 테스트 명령: `node --test "plugin/test/**/*.test.mjs"` (저장소 뿌리에서).
- 줄바꿈은 LF다. 커밋 메시지는 한국어이고 `feat:`·`test:`·`docs:` 접두를 쓴다. 커밋 메시지에 `Co-Authored-By`나 `Generated with` 줄을 넣지 않는다.
- 사용자에게 보이는 문장은 한국어다.

## Review Focus

테스트가 없으면 실제로 쓰는 사람을 물 가능성이 큰 다섯 가지다. 각각의 테스트는 표시한 태스크에 있다.

1. **답의 글자가 그대로 저장되는가.** 빈 답, BOM, CRLF, 2만 자, "끝"처럼 명령으로 보이는 답 → 빈 답만 거절하고 나머지는 글자 그대로(줄바꿈만 LF로) 저장한다. 답 파일은 답이 저장된 뒤에만 지운다. (Task 2, Task 5, Task 7)
2. **실패할 때 숨길 내용이 새지 않는가.** 가짜 실행기가 깨진 JSON이나 비정상 종료를 내도 출력에는 코드만 있다. (Task 7)
3. **명령이 중간에 죽은 뒤 다시 돌려도 되는가.** 도구의 시간 제한에 걸리거나 호출이 실패한 뒤 다시 돌려도 답과 턴이 늘지 않고, 말한 기술·모른다고 한 기술·기다리는 덧붙임이 어긋나지 않는다. 반쯤 쓴 임시 파일은 읽지 않는다. (Task 2, Task 5, Task 7)
4. **폴더 이름과 경로.** 주제가 `C++ / "move"?`이거나 200자이거나 같은 분에 두 번 시작해도 폴더가 안전하게 만들어지고 원래 주제는 세션에 그대로 남는다. 면접 폴더의 경로에 공백과 한글이 있어도 돈다. 설정한 뒤 면접 폴더가 없어지면 폴더를 다시 묻는다. (Task 2, Task 5, Task 7)
5. **정답지 뒤 작업이 돌고 있거나, 방금 끝났거나, 죽었거나, 잠금만 남았을 때 답이 오는 경우.** 정답지 호출이 겹치지 않고, 이미 쓰인 정답지를 덮어쓰지 않고, 죽은 잠금은 치우고 그 자리에서 만든다. (Task 2, Task 5)

## 파일 구조

```
plugin/
  README.md                                쓰는 법, 호출 횟수와 한도, 숨긴 폴더, 권한 창
  skills/pressure-interview/
    SKILL.md                               진행자의 규칙과 명령표
    scripts/
      cli.mjs                              진입점: 명령 해석, 예외 잡기, JSON 출력, 뒤 작업 띄우기
      lib/
        app/                               앱 소스에서 도구로 만든 것 (16개, 손대지 않음)
          interview/{catalog,naming,rules}.mjs
          interview/calls/*.call.mjs       (아홉 개)
          session/session-rules.mjs
          memory/memory-rules.mjs
          review/{stats,review.view}.mjs
        errors.mjs                         EngineError
        config.mjs                         설정 파일과 기본값
        store.mjs                          면접 폴더의 파일, 잠금, 답 파일, 기억 파일
        llm.mjs                            `claude -p` 실행기, 실패 분류, 로그인 확인
        turn.service.mjs                   앱의 TurnService를 손으로 옮긴 것
        interview.mjs                      앱의 InterviewService를 손으로 옮긴 것
        review.mjs                         앱의 ReviewService와 기억 맞추기
        render.mjs                         화면 문장, review.md, stats.md
  test/
    jest-shim.mjs                          앱의 Jest 테스트를 node:test로 돌리는 대용품
    fake-claude.mjs                        가짜 `claude`
    helpers.mjs                            임시 폴더, 가짜 응답 넣기, 명령 돌리기
    app/                                   앱 테스트에서 도구로 만든 것 (14개, 손대지 않음)
    *.test.mjs                             손으로 쓴 테스트
tools/
  port-app-src.mjs                         앱의 소스와 테스트를 옮기는 도구
  import-app-memory.mjs                    앱의 기억을 옮기는 한 번짜리 도구
```

손으로 옮기는 세 파일(`turn.service.mjs`, `interview.mjs`, `review.mjs`)은 앱의 같은 이름 서비스와 메서드 이름·순서를 맞춘다. 앱 쪽 코드와 나란히 놓고 읽을 수 있어야 한다.

저장되는 값의 모양은 앱의 엔티티(`aeae0dd:src/session/interview-session.entity.ts`, `interview-turn.entity.ts`, `src/memory/assumption-record.entity.ts`)와 같게 둔다. 도구로 옮긴 `memory-rules.mjs`, `review.view.mjs`, `stats.mjs`가 그 모양을 받기 때문이다. `answerStartMs`는 늘 `null`이다. 다른 곳은 하나다: "기다리는 덧붙임"(`pendingSecondary`)은 세션 파일이 아니라 그 값을 만든 턴의 `question.json`에 둔다(Task 5).

---

### Task 1: 앱의 소스와 테스트를 옮기는 도구

앱의 순수 모듈 16개와 그 테스트 13개를 타입만 걷어 내 `.mjs`로 만든다. 이 방식은 2026-11-18에 실험으로 확인했다(테스트 118개 통과). 실험 파일이 첨부 폴더에 있고 이 계획과 함께 커밋돼 있다.

**설계 10장의 "프롬프트 동일성"은 이 태스크가 지킨다. [제안]** 설계는 앱에서 뽑은 고정 자료와 견주는 방식을 적었다. 이 계획은 프롬프트를 옮겨 적지 않는다. 도구는 타입 문법을 빈칸으로 바꾸고 import 문만 고치며, 문자열 안의 글자를 건드리는 처리가 없다. `--check`가 생성물이 원본에서 다시 만든 것과 같은지 본다. 손으로 옮기는 코드가 만드는 user 메시지의 조각은 Task 5의 테스트가 지킨다.

**Files:**
- Move: `docs/plans/assets/2026-11-18-pressure-interview-skill/port-app-src.spike.mjs` → `tools/port-app-src.mjs`
- Move: `docs/plans/assets/2026-11-18-pressure-interview-skill/jest-shim.spike.mjs` → `plugin/test/jest-shim.mjs`
- Create (도구가 만든다): `plugin/skills/pressure-interview/scripts/lib/app/**`(16개), `plugin/test/app/**`(13개)
- Test: `plugin/test/port.test.mjs`

**Interfaces:**
- Produces: `node --no-warnings tools/port-app-src.mjs` (저장소 뿌리에서 실행, 생성물을 제자리에 쓴다), `… --check` (쓰지 않고 견준다. 다르면 다른 파일 이름을 표준 출력에 내고 종료 코드 1).
- Produces: `lib/app/` 모듈들. 내보내는 이름은 앱과 같다. 뒤 태스크가 쓰는 것: `interview/catalog.mjs`의 `ROLES`, `OWNABLE_AXES`, `TEMPERAMENTS`, `axisName`; `interview/naming.mjs`의 `checkNaming`, `normalize`; `interview/rules.mjs`의 `pickNext`; `interview/calls/`의 `generateQuestion`, `detectTechs`, `checkPremise`, `writeAnswerKey`, `verifyAnswerKey`, `analyzeAnswer`, `answerClarification`, `pickJobRole`, `reviewTurn` (모두 첫 인자가 `{ callJson({ role, system, user, schema }) → Promise<{ data, usage, model }> }`); `session/session-rules.mjs`의 `composePanel`, `pickOpener`, `chooseTargetAxis`, `nextAsker`, `CLOSING_TEXT`; `memory/memory-rules.mjs`의 `foldAssumptions`, `selectMemory`, `pendingTopics`; `review/stats.mjs`의 `computeStats`; `review/review.view.mjs`의 `isReviewTarget`, `answerKeyOf`, `followUpsOf`, `memberOf`, `toReviewView`.
- Produces: `plugin/test/jest-shim.mjs`의 `describe`, `it`(`it.each` 포함), `expect`, `jest`.
- Produces(Task 4가 채운다): 도구 안의 표 둘. `EXTERNAL`(손으로 옮긴 모듈의 원본 경로 → `{ path, exports }`), `PATCHES`(원본 경로 → `[찾을 문자열, 바꿀 문자열]` 목록. 타입을 걷어 내기 전에 적용하고, 찾을 문자열이 없으면 도구가 오류로 끝난다).

- [ ] **Step 1: 첨부 파일 둘을 제자리로 옮긴다** (`git mv`). 첨부 폴더가 비면 지운다.

- [ ] **Step 2: 실패하는 테스트를 쓴다** — `plugin/test/port.test.mjs`

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const hasRef = spawnSync('git', ['cat-file', '-e', 'aeae0dd^{commit}']).status === 0;

test('생성물이 원본에서 다시 만든 것과 같다', { skip: !hasRef }, () => {
  const r = spawnSync(process.execPath, ['--no-warnings', 'tools/port-app-src.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});
test('생성된 파일의 첫 줄이 원본과 도구를 밝힌다', () => {
  const first = readFileSync('plugin/skills/pressure-interview/scripts/lib/app/interview/rules.mjs', 'utf8').split('\n')[0];
  assert.equal(first, '// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/interview/rules.ts @ aeae0dd, 도구: tools/port-app-src.mjs');
});
test('질문 시스템 프롬프트가 앱과 같은 길이다', async () => {
  const { buildQuestionPrompt } = await import('../skills/pressure-interview/scripts/lib/app/interview/calls/question.call.mjs');
  const { system } = buildQuestionPrompt({ topic: 'Redis', interviewer: { id: 'p1', role: 'dba', temperament: 'persistent' }, reactionIntent: null, defect: null, targetAxis: null, history: [], userMentioned: ['Redis'], feedback: [] });
  assert.equal(system.length, 5721);
});
```

- [ ] **Step 3: 테스트가 실패하는지 본다**

Run: `node --test plugin/test/port.test.mjs`
Expected: FAIL (생성물이 아직 없다)

- [ ] **Step 4: 도구를 고친다** — `tools/port-app-src.mjs`. 실험 파일에서 바꾸는 것:
  1. 인자로 폴더를 받지 않고 현재 폴더(저장소 뿌리)를 기준으로 읽고 쓴다. `--check`를 더한다.
  2. 생성된 파일마다 첫 줄에 `// 생성된 파일이다. 손으로 고치지 않는다. 원본: <원본 경로> @ aeae0dd, 도구: tools/port-app-src.mjs`를 넣는다.
  3. 테스트 파일에서는 상대 경로가 아닌 import 문(`'@nestjs/testing'` 등)을 지운다.
  4. `EXTERNAL`과 `PATCHES` 표를 둔다(지금은 비어 있다). `fixImports`가 대상이 `EXTERNAL`에 있으면 그 `path`로 잇고, 내보내는 이름 거르기도 그 `exports`로 한다.
  5. `SOURCES`와 `SPECS` 목록은 실험 파일 그대로다. 문자열 안의 글자를 바꾸는 처리(공백 정리 등)를 더하지 않는다.

- [ ] **Step 5: 도구를 돌리고 전체 테스트를 본다**

Run: `node --no-warnings tools/port-app-src.mjs` 그다음 `node --test "plugin/test/**/*.test.mjs"`
Expected: 앱에서 온 테스트 118개와 `port.test.mjs` 3개가 모두 PASS, 실패 0

- [ ] **Step 6: 커밋** — `feat: 앱의 규칙과 프롬프트를 도구로 옮긴다`

---

### Task 2: 설정과 파일 저장

**Files:**
- Create: `plugin/skills/pressure-interview/scripts/lib/errors.mjs`, `config.mjs`, `store.mjs`
- Test: `plugin/test/config.test.mjs`, `plugin/test/store.test.mjs`

**Interfaces:**
- Produces: `errors.mjs` — `export class EngineError extends Error { constructor(code: string, detail?: string) }`, 속성 `code`, `detail`. 엔진의 예상된 실패는 모두 이것이다. `detail`은 로그에만 쓴다.
- Produces: `config.mjs`
  - `export const DEFAULTS` = `{ dataDir: null, questionLimit: 6, maxConsecutive: 2, maxRegenerations: 1, reissueAfterHours: 24, reviewConcurrency: 3, callTimeoutMs: 180000, pollMs: 300, claudeCommand: ['claude'], keepEnv: [], calls: { jobRole: { model: 'sonnet', effort: 'medium' }, question: { model: 'opus', effort: 'medium' }, leak: { model: 'sonnet', effort: 'low' }, premise: { model: 'opus', effort: 'medium' }, answerKey: { model: 'opus', effort: 'medium' }, verify: { model: 'opus', effort: 'medium' }, analyze: { model: 'opus', effort: 'medium' }, clarify: { model: 'opus', effort: 'medium' }, review: { model: 'opus', effort: 'high' } } }`
  - `configPath(env = process.env): string` — `<홈>/.pressure-interview/config.json`. 홈은 `env.PRESSURE_INTERVIEW_HOME`이 있으면 그것, 없으면 `os.homedir()`.
  - `loadConfig(env?): object | null` — 파일이 없으면 `null`. 있으면 `DEFAULTS`에 덮어 합친 것(`calls`는 종류별로 합친다). JSON이 깨졌거나 값이 틀리면 `EngineError('bad_config')`. 검사: `questionLimit` 2~30의 정수, `maxConsecutive`·`maxRegenerations`·`reissueAfterHours`·`reviewConcurrency`·`callTimeoutMs`·`pollMs`는 1 이상의 정수, `effort`는 `low|medium|high|xhigh|max`, `model`은 빈 문자열이 아닌 문자열, `claudeCommand`는 비어 있지 않은 문자열 배열, `keepEnv`는 문자열 배열, `dataDir`은 문자열이거나 `null`.
  - `saveConfig(patch: object, env?): object` — 있는 파일에 `patch`를 합쳐 쓰고 `loadConfig(env)`의 결과를 돌려준다.
- Produces: `store.mjs`
  - `slugify(topic: string): string` — 한글·영문·숫자·`_`·`-`만 남기고 나머지는 `-`로, 이어진 `-`는 하나로, 양 끝의 `-`는 떼고, 40자로 자른다. 비면 `'interview'`.
  - `openStore(dataDir: string)` → 아래 메서드를 가진 객체.
  - `createInterview(topic, at: Date): string` — id는 `YYYY-MM-DD-HHmm-<slug>`(그 PC의 시각). 이미 있으면 `-2`, `-3`…을 붙인다. `interviews/<id>/answers`와 `interviews/<id>/hidden/turns`를 만든다.
  - `listInterviews(): { id, topic, status, createdAt: Date, questionCount }[]` — 최신순. `hidden/session.json`이 없는 폴더는 뺀다.
  - `readSession(id)`, `writeSession(id, session)` — 필드는 앱의 `InterviewSession`에서 `pendingSecondary`를 뺀 것: `id`, `topic`(사용자가 친 그대로), `panel`, `questionLimit`, `status`, `userMentioned`, `unknownTechs`, `memory`, `createdAt`, `finishedAt`, `reviewedAt`. 날짜는 파일에서 ISO 문자열이고 읽을 때 `Date`로 바꾼다. 없는 면접은 `EngineError('not_found')`.
  - `readTurns(id): Turn[]` — 순번 순. 턴 폴더의 파일들을 앱의 `InterviewTurn` 모양 하나로 합친다: `id`(두 자리 순번 `'03'`), `sessionId`(면접 id), `seq`(숫자), `interviewerId`, `addOn`, `causeTurnId`, `reactionIntent`, `defect`, `targetAxis`, `question`(`{ ...draft, answerKey }`, 정답지가 없으면 `answerKey: null`), `prepared`(`{ flags, attempts, answerKeyCorrected }`, 정답지가 없으면 `answerKeyCorrected: false`), `verification`(없으면 `null`), `clarifications`(없으면 `[]`), `answer`, `answeredAt: Date | null`, `answerStartMs: null`, `analysis`, `pick`, `surprise`, `review`(없으면 `null`), `createdAt: Date`, 그리고 `pendingSecondary`(그 턴의 `question.json`에 적힌 값, 없으면 `null`). `question.json`이 없는 턴 폴더는 턴이 아니다.
  - `writeQuestion(id, seq, { interviewerId, addOn, causeTurnId, reactionIntent, defect, targetAxis, draft, prepared: { flags, attempts }, pendingSecondary, createdAt })`
  - `writeAnswer(id, seq, { answer, answeredAt, clarifications, analysis, pick })`
  - `writeReview(id, seq, { review, surprise })`
  - `readKey(id, seq): { answerKey, verification, answerKeyCorrected } | null`, `writeKey(id, seq, key)`
  - `acquireKeyLock(id, seq, staleMs): (() => void) | null` — `key.lock`을 "없을 때만 만들기"(`wx`)로 만들고 `{ pid, at }`를 적는다. 성공하면 푸는 함수를, 이미 있으면 `null`을 돌려준다. 있는 잠금의 pid가 죽었거나 `at`이 `staleMs`보다 오래됐으면 치우고 한 번 다시 시도한다. 푸는 함수는 잠금 파일의 `pid`와 `at`이 자기가 적은 것일 때만 지운다(남이 다시 잡은 잠금을 지우지 않는다).
  - `answerFile(id, seq, inputNo): string` — `<dataDir>/interviews/<id>/answers/<두 자리 순번>-<inputNo>.txt`, 구분자는 `/`.
  - `readAnswerFile(file): string | null` — 읽어서 맨 앞의 BOM을 떼고 CRLF를 LF로 바꾼다. 지우지 않는다. 파일이 없거나 공백뿐이면 `null`.
  - `removeAnswerFile(file): void` — 있으면 지운다.
  - `appendCall(id, row)`, `readCalls(id): object[]` — `hidden/calls.jsonl`에 한 줄씩 붙인다.
  - `logError(id | null, where: string, error)` — `hidden/errors.log`(id가 없으면 `<dataDir>/errors.log`)에 시각, `where`, 메시지, 스택, `error.detail`을 붙인다.
  - `readMemory(): Record[]`, `writeMemory(records)` — `<dataDir>/memory.json`. 모양은 앱의 `AssumptionRecord`(`lastSeenAt`, `createdAt`은 읽을 때 `Date`). 파일이 없으면 `[]`.
  - `calls.jsonl`과 `errors.log`를 뺀 모든 쓰기는 같은 폴더의 임시 이름(`<이름>.tmp-<pid>`)에 쓴 뒤 이름을 바꾼다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 테스트마다 공백과 한글이 든 임시 폴더를 쓴다(Global Constraints).

`config.test.mjs`:
  - `설정 파일이 없으면 null` — `loadConfig({ PRESSURE_INTERVIEW_HOME: tmp })`가 `null`.
  - `저장한 값에 기본값이 합쳐진다` — `saveConfig({ dataDir: 'D:/x', calls: { leak: { model: 'haiku' } } }, env)`의 반환값과 `loadConfig(env)`가 같고, `dataDir`이 `'D:/x'`, `questionLimit`이 `6`, `calls.leak`이 `{ model: 'haiku', effort: 'low' }`, `calls.review`가 `{ model: 'opus', effort: 'high' }`.
  - `값이 틀리면 bad_config` — 파일에 `questionLimit: 1`, `questionLimit: 31`, `claudeCommand: 'claude'`, `claudeCommand: []`, `calls: { leak: { effort: 'fast' } }`, `dataDir: 3`을 각각 써 넣고 `loadConfig`가 `code === 'bad_config'`인 `EngineError`를 던진다.
  - `깨진 JSON이면 bad_config`.

`store.test.mjs`:
  - `slugify` — `slugify('C++ / "move"?')`가 `'C-move'`, `slugify('레디스 Redis')`가 `'레디스-Redis'`, `slugify('가'.repeat(200)).length`가 `40`, `slugify('???')`가 `'interview'`.
  - `같은 분에 같은 주제로 두 번 만들면 번호가 붙는다` — 둘째 id가 첫째 + `'-2'`.
  - `세션을 쓰고 읽으면 날짜가 Date이고 주제가 그대로다` — `topic: 'C++ / "move"?'`가 그대로, `createdAt instanceof Date`, `finishedAt === null`.
  - `턴을 파일들에서 합친다` — `writeQuestion`만 한 턴은 `seq === 1`, `id === '01'`, `question.answerKey === null`, `prepared.answerKeyCorrected === false`, `answer === null`, `review === null`, `clarifications`가 `[]`, `answerStartMs === null`, `interviewerId`·`addOn`·`causeTurnId`·`reactionIntent`·`defect`·`targetAxis`·`pendingSecondary`가 쓴 값. `writeKey` 뒤에는 `question.answerKey`와 `verification`이 그 값이고 `prepared.answerKeyCorrected`가 `writeKey`의 값이다. `writeAnswer` 뒤에는 `answeredAt instanceof Date`.
  - `쓰다 만 임시 파일은 읽지 않는다` — 턴 폴더에 `question.json.tmp-123`만 있으면 `readTurns`가 그 턴을 내지 않는다.
  - `잠금은 한쪽만 잡는다` — 첫 `acquireKeyLock`은 함수, 둘째는 `null`. 함수를 부른 뒤에는 다시 잡힌다.
  - `죽은 프로세스의 잠금은 치우고 잡는다` — `key.lock`에 `{ pid: 999999, at: 지금 }`을 써 두면 잡힌다.
  - `오래된 잠금은 치우고 잡는다` — `{ pid: process.pid, at: 한 시간 전 }`이고 `staleMs`가 1000이면 잡힌다.
  - `푸는 함수는 남의 잠금을 지우지 않는다` — 잡은 뒤 잠금 파일을 `{ pid: 1, at: 다른 시각 }`으로 바꿔 쓰고 푸는 함수를 부르면 파일이 남아 있다.
  - `답 파일: BOM과 CRLF를 고치고, 지우지 않는다` — `'\uFEFF가\r\n나'`를 쓴 파일에서 `'가\n나'`가 나오고 파일이 그대로 있다. `removeAnswerFile` 뒤에는 없다. 없는 파일에 `removeAnswerFile`을 불러도 던지지 않는다.
  - `답 파일: 없거나 공백뿐이면 null`.
  - `답 파일: 2만 자와 "끝"을 그대로 돌려준다` — `'가'.repeat(20000)`과 `'끝'`.
  - `호출 기록은 붙여 쓴다` — 두 번 `appendCall` 뒤 `readCalls`의 길이가 2.
  - `기억 파일이 없으면 빈 목록, 쓰고 읽으면 lastSeenAt과 createdAt이 Date`.
  - `없는 면접은 not_found`.

- [ ] **Step 2: 실패를 확인한다** — `node --test plugin/test/config.test.mjs plugin/test/store.test.mjs` → FAIL (모듈 없음)
- [ ] **Step 3: `errors.mjs`, `config.mjs`, `store.mjs`를 구현한다.** pid가 살아 있는지는 `process.kill(pid, 0)`으로 본다.
- [ ] **Step 4: 통과를 확인한다** — 같은 명령 → PASS. 전체 테스트도 PASS.
- [ ] **Step 5: 커밋** — `feat: 스킬의 설정과 파일 저장`

---

### Task 3: `claude -p` 실행기와 가짜 실행기

**Files:**
- Create: `plugin/skills/pressure-interview/scripts/lib/llm.mjs`
- Create: `plugin/test/fake-claude.mjs`, `plugin/test/helpers.mjs`
- Test: `plugin/test/llm.test.mjs`

**Interfaces:**
- Consumes: `EngineError`(Task 2), `saveConfig`(Task 2), `lib/app/interview/calls/*`(Task 1).
- Produces: `llm.mjs`
  - `childEnv(env: object, keepEnv: string[] = []): object` — 이름이 `CLAUDE`나 `ANTHROPIC`으로 시작하는 변수를 뺀 사본. `CLAUDE_CONFIG_DIR`과 `keepEnv`의 이름은 남긴다.
  - `buildArgs({ model, effort, system, schema }): string[]` — 정확히 `['-p', '--model', model, '--effort', effort, '--system-prompt', system, '--json-schema', JSON.stringify(schema), '--output-format', 'json', '--tools', '', '--safe-mode', '--no-session-persistence', '--strict-mcp-config']`.
  - `classify({ spawnError, timedOut, exitCode, stdout }): { ok: true, result } | { ok: false, code }` — 위에서부터 먼저 맞는 것: ① `spawnError?.code === 'ENOENT'` → `cli_missing` ② `timedOut` → `timeout` ③ `stdout`이 JSON이 아니다 → `other` ④ `api_error_status === 429` → `usage_limit` ⑤ `stop_reason === 'refusal'` → `refused` ⑥ `is_error === true` 또는 `exitCode !== 0` → `other` ⑦ `structured_output`이 객체가 아니다 → `schema_failed` ⑧ 그 밖 → `ok`. (④⑤⑦의 실제 결과 모양은 본 적이 없다. 설계 11장. 가장 그럴듯한 필드로 정했고 실제 한 판에서 확인한다. [제안])
  - `createLlm({ config, record, env = process.env }): { callJson({ kind, system, user, schema }) → Promise<{ data, usage, model }> }` — `config.calls[kind]`의 모델과 effort로 `config.claudeCommand`를 셸 없이 띄운다(`spawn(cmd[0], [...cmd.slice(1), ...buildArgs()], { env: childEnv(env, config.keepEnv), windowsHide: true })`). `user`를 표준 입력에 쓰고 닫는다. `config.callTimeoutMs`를 넘기면 죽인다. 성공이면 `data`는 `structured_output`, `usage`는 `{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`(없는 값은 0), `model`은 `modelUsage`의 첫 키(없으면 설정의 모델 이름). 실패면 `EngineError(code, 자식의 표준 출력과 표준 오류 원문)`을 던진다. 한 번 부르면 `claude`를 한 번만 띄운다(다시 부르지 않는다). 성공이든 실패든 `record({ at, kind, model, effort, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, duration_ms, wall_ms, ok, code? })`를 한 번 부른다. 자식의 표준 출력과 표준 오류는 버퍼로만 받고 흘려보내지 않는다.
  - `checkClaude(config, env = process.env): Promise<void>` — `claudeCommand` + `['auth', 'status']`를 `childEnv`로 띄운다. 못 띄우면 `EngineError('cli_missing')`. 출력 JSON의 `loggedIn`이 `true`이고 `authMethod`가 `'claude.ai'`인 경우만 통과하고, 아니면 `EngineError('not_logged_in')`.
- Produces: `plugin/test/fake-claude.mjs` — `claudeCommand`를 `[process.execPath, '<이 파일의 절대 경로>']`로 두면 `claude` 대신 돈다. 환경 변수 `PI_FAKE_DIR`의 폴더를 쓴다.
  - 인자에 `auth`가 있으면 `<PI_FAKE_DIR>/auth.json`의 내용(없으면 `{"loggedIn":true,"authMethod":"claude.ai"}`)을 내고, `calls.jsonl`에 `{ kind: 'auth' }`를 붙인다.
  - 아니면 `--json-schema`의 `required`로 종류를 가린다(먼저 맞는 것): `reply`→`clarify`, `role`→`jobRole`, `keyPoints`→`answerKey`, `corrections`→`verify`, `premiseOk`→`premise`, `techs`→`leak`, `keyProblems`→`review`, `questionIntent`→`question`, `mentionedTechs`→`analyze`.
  - `<PI_FAKE_DIR>/<종류>/`에서 이름이 가장 앞선 `*.json`을 `*.used`로 이름을 바꿔 차지한다(동시 호출끼리 겹치지 않게. 이름 바꾸기가 실패하면 다음 파일을 본다). 없으면 표준 오류에 한 줄을 쓰고 종료 코드 3.
  - 차지한 파일의 모양: `{ "data": {...}, "delayMs"?: n }`이면 `delayMs`를 기다린 뒤 `{"type":"result","is_error":false,"stop_reason":"end_turn","structured_output":data,"usage":{"input_tokens":1,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":4},"modelUsage":{"fake-model":{}},"duration_ms":5}`를 낸다. `{ "raw": "글", "exit"?: n, "stderr"?: "글" }`이면 그 글을 그대로 내고 그 코드로 끝난다. `{ "hang": true }`이면 끝나지 않는다.
  - 호출마다 `<PI_FAKE_DIR>/calls.jsonl`에 `{ kind, args, system, user, envNames }`를 붙인다(`envNames`는 자식이 받은 환경 변수 이름 가운데 `CLAUDE`·`ANTHROPIC`으로 시작하는 것).
- Produces: `plugin/test/helpers.mjs`
  - `makeWorld(configPatch = {}): { home, dataDir, fakeDir, env, config }` — 임시 폴더 셋을 만든다(이름에 공백과 한글). `env`는 `{ ...process.env, PRESSURE_INTERVIEW_HOME: home, PI_FAKE_DIR: fakeDir }`에서 `CLAUDE_CONFIG_DIR`을 뺀 것. `config`는 `saveConfig({ dataDir, claudeCommand: [process.execPath, fake-claude의 절대 경로], ...configPatch }, env)`의 결과.
  - `push(fakeDir, kind, response)` — 그 종류의 다음 번호 파일(`001.json`, `002.json`…)로 쓴다.
  - `fakeCalls(fakeDir): object[]` — `calls.jsonl`을 읽는다.
  - `fakeLlm(queues: Record<kind, any[]>): { llm, calls }` — 프로세스를 띄우지 않는 가짜. `llm.callJson(req)`는 `req.kind`가 있으면 그것으로, 없으면 위와 같은 `required` 규칙으로 종류를 가려 `queues[kind].shift()`를 돌려준다(값이 함수면 불러서 기다린 값, `Error`면 던진다). `usage`는 `{ input_tokens: 1, output_tokens: 1 }`, `model`은 `'m'`. `calls`에 `{ ...req, kind }`를 쌓는다. 큐가 비었으면 `Error('no fake response for <kind>')`.
  - 본보기 값: `draft(over?)`, `key(over?)`, `analysis(over?)`, `review(over?)`, `panel()` — 앱의 `QuestionDraft`, `AnswerKey`, `Analysis`, `TurnReview`, 패널 셋의 최소 유효 값.

- [ ] **Step 1: 출력 상한을 줄 수 있는지 확인한다** (설계 8장이 만드는 쪽에 맡긴 것). `claude --help`와 공식 문서의 환경 변수 목록(https://code.claude.com/docs/en/settings 의 환경 변수 절)에서 출력 토큰 상한 변수를 찾는다. 문서에 있으면 `createLlm`이 자식 환경에 그 변수를 `16000`으로 넣고(지운 뒤에 더한다) 그 테스트를 Step 2에 더한다. 없으면 넣지 않는다. 어느 쪽인지와 근거를 보고에 적는다.

- [ ] **Step 2: 실패하는 테스트를 쓴다** — `llm.test.mjs`. `createLlm`과 `checkClaude`에는 `world.env`를 넘긴다.
  - `buildArgs의 꼴` — 위의 배열과 `deepEqual`. `--tools` 다음 원소가 빈 문자열이다.
  - `childEnv` — `{ PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', CLAUDE_CONFIG_DIR: 'c', KEEP_ME: 'y' }`에서 `PATH`, `CLAUDE_CONFIG_DIR`, `KEEP_ME`만 남는다. `keepEnv: ['ANTHROPIC_BASE_URL']`이면 그것도 남는다.
  - `classify` — 한 줄에 하나씩(`exitCode`를 적지 않은 줄은 0이다): `{ spawnError: { code: 'ENOENT' } }`→`cli_missing`; `{ timedOut: true }`→`timeout`; `{ exitCode: 0, stdout: 'not json' }`→`other`; `stdout`이 `{"api_error_status":429,"is_error":true}`→`usage_limit`; `{"stop_reason":"refusal","is_error":false}`→`refused`; `{"is_error":true}`→`other`; `{ exitCode: 1, stdout: '{"is_error":false,"structured_output":{}}' }`→`other`; `{"is_error":false}`→`schema_failed`; `{"is_error":false,"structured_output":{"a":1}}`→`ok`.
  - `가짜 실행기로 한 번 부른다` — `push(fakeDir, 'jobRole', { data: { role: 'dba' } })` 뒤 `callJson({ kind: 'jobRole', system: '시스템 "따옴표" $x `백틱`\n둘째 줄', user: '주제: Redis', schema: JOB_ROLE_SCHEMA })`의 `data`가 `{ role: 'dba' }`, `usage`가 `{ input_tokens: 1, output_tokens: 4, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 }`, `model`이 `'fake-model'`. `fakeCalls`의 첫 항목에서 `system`과 `user`가 보낸 글자와 같고, `args`에 `'sonnet'`과 `'medium'`이 있다.
  - `자식은 세션의 변수와 API 키를 받지 않는다` — `world.env`에 `ANTHROPIC_API_KEY`와 `CLAUDE_CODE_ENTRYPOINT`를 더해 넘기고 부른 뒤 `fakeCalls()[0].envNames`가 `[]`.
  - `record는 성공과 실패에 한 번씩 불린다` — 성공 줄은 `ok: true`, `kind`, `model: 'fake-model'`, `effort`, 토큰 넷, `wall_ms`가 숫자. `{ raw: 'x', exit: 1 }`이면 `EngineError`의 `code`가 `'other'`, `detail`에 `'x'`가 있고, `record`의 줄은 `ok: false, code: 'other'`.
  - `실패해도 한 번만 띄운다` — 위의 실패 뒤 `fakeCalls`의 길이가 1.
  - `시간 상한을 넘기면 timeout이고 자식이 죽는다` — `callTimeoutMs: 300`, `{ hang: true }`.
  - `명령을 못 찾으면 cli_missing` — `claudeCommand: ['pi-no-such-command-xyz']`.
  - `checkClaude` — 기본은 통과. `auth.json`이 `{"loggedIn":false}`이면 `not_logged_in`, `{"loggedIn":true,"authMethod":"apiKey"}`도 `not_logged_in`.
  - `가장 긴 명령줄도 한계 아래다` — 아홉 호출 함수를 `fakeLlm`으로 한 번씩 불러 받은 `{ system, schema }`마다 `buildArgs({ model: 'opus', effort: 'medium', system, schema }).join(' ').length < 30000`.

- [ ] **Step 3: 실패를 확인한다** — `node --test plugin/test/llm.test.mjs` → FAIL
- [ ] **Step 4: `fake-claude.mjs`, `helpers.mjs`, `llm.mjs`를 구현한다.** 설계 5.4와 다른 곳 [제안]: 시스템 프롬프트는 `--system-prompt-file`이 아니라 `--system-prompt` 인자로 넘긴다(임시 파일이 필요 없고, 2026-11-18 실측에서 둘 다 됐다).
- [ ] **Step 5: 통과를 확인한다** — 같은 명령 → PASS. 전체 테스트도 PASS.
- [ ] **Step 6: 커밋** — `feat: claude -p 실행기와 테스트용 가짜 실행기`

---

### Task 4: 턴 서비스 (앱의 `TurnService`)

**Files:**
- Create: `plugin/skills/pressure-interview/scripts/lib/turn.service.mjs`
- Modify: `tools/port-app-src.mjs` (`SPECS`, `EXTERNAL`, `PATCHES`)
- Create (도구가 만든다): `plugin/test/app/interview/turn.service.test.mjs`

**Interfaces:**
- Consumes: `lib/app/interview/calls/*`, `naming.mjs`, `rules.mjs`, `catalog.mjs`(Task 1).
- Produces: `export class TurnService { constructor(llm, config) }` — `config`에서 `maxRegenerations`와 `maxConsecutive`만 쓴다. 메서드는 앱과 같은 이름과 반환 모양이다: `prepareDraft(input)`, `completeQuestion(input)`, `replyToClarification(input)`, `pickJobRole(topic)`, `reviewTurn(input)`, `handleAnswer(input)`.
- 앱과 다른 곳은 하나다. 호출 함수에 `llm`을 넘길 때 종류를 붙인 껍데기로 넘긴다: `{ callJson: (req) => this.llm.callJson({ ...req, kind }) }`. 종류는 `question`, `leak`, `premise`, `answerKey`, `verify`, `analyze`, `clarify`, `jobRole`, `review`다(되묻기 응답 뒤의 흘림 검사도 `leak`).

- [ ] **Step 1: 도구에 테스트를 더한다.** `SPECS`에 `'src/interview/turn.service.spec.ts'`를, `EXTERNAL`에 `'src/interview/turn.service.ts'` → `{ path: 'plugin/skills/pressure-interview/scripts/lib/turn.service.mjs', exports: ['TurnService'] }`를 넣는다. `PATCHES`에 그 테스트의 준비 함수를 바꾸는 한 쌍을 넣는다. 찾을 문자열은 `aeae0dd`의 그 파일에서 `async function service(`로 시작하는 함수 전체(44~54행 근처, `Test.createTestingModule`을 쓰는 곳은 여기 하나다)이고, 바꿀 문자열은 다음이다.

```ts
async function service(queues: Record<string, unknown[]>) {
  const fake = fakeLlm(queues);
  return { turn: new TurnService(fake.llm as never, { maxConsecutive: 2, maxRegenerations: 1 }), calls: fake.calls };
}
```

- [ ] **Step 2: 도구를 돌리고 테스트가 실패하는지 본다**

Run: `node --no-warnings tools/port-app-src.mjs` 그다음 `node --test plugin/test/app/interview/turn.service.test.mjs`
Expected: FAIL (`turn.service.mjs` 없음)

- [ ] **Step 3: `turn.service.mjs`를 구현한다.** `git show aeae0dd:src/interview/turn.service.ts`를 메서드 단위로 그대로 옮긴다. 데코레이터와 타입을 떼고, 생성자를 `(llm, config)`로 바꾸고, 호출마다 위의 껍데기를 쓴다. 문장(`namingFeedback`의 두 문장, 모름 메모, 전제의 고정 문장)은 글자 그대로다.
- [ ] **Step 4: 통과를 확인한다** — 같은 테스트 → 앱의 그 파일에 있는 테스트가 모두 PASS(2026-11-18에 센 `it(`는 43개다. 수가 다르면 도구가 테스트를 빠뜨렸는지 본다). `node --no-warnings tools/port-app-src.mjs --check`가 종료 코드 0. 전체 테스트 PASS.
- [ ] **Step 5: 커밋** — `feat: 턴 서비스를 옮긴다`

---

### Task 5: 면접 한 판 (앱의 `InterviewService`)

**Files:**
- Create: `plugin/skills/pressure-interview/scripts/lib/interview.mjs`
- Test: `plugin/test/interview.test.mjs`

**Interfaces:**
- Consumes: `openStore`(Task 2), `TurnService`(Task 4), `session-rules.mjs`·`memory-rules.mjs`·`catalog.mjs`(Task 1), `EngineError`, `fakeLlm`과 본보기 값(Task 3).
- Produces: `createInterviewService({ store, config, llmFor, rng = Math.random, now = () => new Date(), launchCompletion })`
  - `llmFor(interviewId)` → 그 면접에 호출을 기록하는 `llm`. `launchCompletion(interviewId, seq)` → 정답지 뒤 작업을 띄운다(돌려주는 값 없음).
  - `current(): string | null` — 진행 중인 면접의 id(없으면 `null`).
  - `start({ topic, questionLimit? }): Promise<View>` — 진행 중인 면접이 있으면 `EngineError('interview_open')`.
  - `submitAnswer(id, text, answerFile?): Promise<View>` — 마지막 턴에 답이 없으면 `text`를 저장한다. 이미 있으면 `text`를 버린다. 어느 쪽이든 그 뒤에 `answerFile`이 있으면 `store.removeAnswerFile`로 지운다(답이 저장된 뒤에만 지운다). 그다음 빠진 단계를 한다. 끝난 면접이면 `EngineError('finished')`.
  - `resume(id): Promise<View>` — 빠진 단계가 있으면 한다. 그리고 열린 질문에 `key.json`이 없으면 잠금을 잡아 본다. 잡히면(아무도 쓰고 있지 않다) 바로 풀고 `launchCompletion`을 부른다. 안 잡히면(뒤 작업이 돌고 있다) 부르지 않는다.
  - `finish(id): Promise<View>`
  - `complete(id, seq): Promise<void>` — 정답지를 쓰는 일. 순서: `readKey`가 있으면 끝 → `acquireKeyLock`을 못 잡으면 끝 → **잡은 뒤 `readKey`를 다시 보고 있으면 풀고 끝** → `completeQuestion` → `writeKey` → 푼다. 실패하면 `store.logError`만 하고 푼다(던지지 않는다).
  - `view(id): View`
  - `View` = `{ id, topic, status: 'in_progress' | 'finished', questionLimit, turnCount, open: { seq, roleName, addOn, text, clarifications: { ask, reply }[], inputNo } | null, pending: 'answer' | 'retry' | null, closing: string | null }`. `open`은 답이 없는 마지막 턴이다(끝난 면접이면 `null`). `inputNo`는 그 턴의 되묻기 수 + 1. `pending`은 끝났으면 `null`, 마지막 턴에 답이 없으면 `'answer'`, 있으면 `'retry'`. `closing`은 끝났으면 `CLOSING_TEXT`. 숨길 값은 하나도 넣지 않는다(앱의 `toInterviewView`와 같다).
  - 실패한 모델 호출의 `EngineError`는 그대로 던진다. 그 전에 저장한 것은 남는다.
- 흐름은 `aeae0dd:src/session/interview.service.ts`의 `start`, `submitAnswer`, `proceed`, `analyze`, `replyToClarification`, `nextQuestion`, `finish`, `answerKeyInput`, `historyOf`를 그대로 따른다. 다른 곳:
  - 저장은 `store`. 세션 잠금(`locked`)은 없다(한 세션이 한 번에 명령 하나를 돌린다).
  - **앱이 한 트랜잭션으로 묶던 두 곳의 쓰는 순서.** ① 분석 뒤: 세션(`userMentioned`, `unknownTechs`)을 먼저 쓰고 그다음 `answer.json`(`analysis`, `pick`)을 쓴다. 둘 사이에서 죽으면 다시 분석하고, 두 목록은 합집합이라 결과가 같다. ② 다음 질문: 앱이 세션에 쓰던 `pendingSecondary`(`nextAsker`가 돌려준 `pending`)를 새 턴의 `writeQuestion`에 함께 넣는다. `nextAsker`에 주는 `pending`은 마지막 턴의 `pendingSecondary`다(턴이 하나면 그 턴의 값, 곧 `null`). 파일 하나에 쓰므로 반만 쓰이는 일이 없다.
  - 정답지가 없을 때: `readKey`가 있으면 쓴다 → 없으면 `acquireKeyLock`(`staleMs = 2 * config.callTimeoutMs + 30000`)을 시도한다 → 잡히면 `readKey`를 다시 보고, 있으면 풀고 그것을 쓰고, 없으면 그 자리에서 만들고 푼다 → 못 잡으면 `config.pollMs`를 쉬고 처음부터 다시 본다.
  - 새 질문을 저장한 뒤 `launchCompletion(id, seq)`을 부른다.
  - `submitAnswer`가 끝날 때(성공했을 때) `store.appendCall(id, { type: 'wait', seq, wall_ms })`를 남긴다(`seq`는 답한 턴, `wall_ms`는 이 메서드가 걸린 시간).
  - 시작할 때의 기억은 `selectMemory(store.readMemory(), now(), config.reissueAfterHours)`.
  - 테스트는 `config.pollMs`를 10으로 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `interview.test.mjs`. `fakeLlm`과 임시 `store`를 쓰고, `launchCompletion`은 부른 인자를 쌓기만 하는 함수가 기본이다. 이름과 확인할 것:
  1. `시작하면 직무를 고르고 첫 질문을 만든다` — 호출 종류의 순서가 `['jobRole', 'question', 'leak']`. 세션의 `panel`이 셋이고 역할이 `[고른 직무, 'textbook', 'scenario']`, `userMentioned`가 `[주제]`, `status`가 `'in_progress'`. 턴 1의 `question.answerKey`가 `null`, `pendingSecondary`가 `null`. `view.open`이 `{ seq: 1, inputNo: 1, addOn: false, … }`이고 `pending`이 `'answer'`. `launchCompletion`이 `(id, 1)`로 한 번 불렸다.
  2. `주제의 글자는 세션에 그대로 남는다` — 주제 `'C++ / "move"?'`로 시작. 세션의 `topic`이 그대로이고 id에 `'C-move'`가 있다.
  3. `진행 중인 면접이 있으면 start는 interview_open`.
  4. `시작이 실패하면 면접이 남지 않는다` — `question` 큐에 `Error`. `store.listInterviews()`가 `[]`, `current()`가 `null`.
  5. `답하면 분석하고 다음 질문을 만든다` — 턴이 둘, 턴 2의 `causeTurnId`가 `'01'`, `reactionIntent`와 `defect`가 규칙이 고른 값, `launchCompletion`이 `(id, 2)`로 불렸다.
  6. `둘째 질문의 user 메시지에 기억과 말한 기술이 실린다` — `memory.json`에 `status: 'well'`인 기록 하나를 넣고 시작, 분석의 `mentionedTechs: ['Sentinel']`. 둘째 `question` 호출의 `user`에 `'다시 내지 않는 가정'`과 `'Sentinel'`이 있다.
  7. `되묻기면 같은 턴에 응답을 붙이고 답을 다시 기다린다` — 분석 `kind: 'clarify'`. `view.open.seq`가 그대로, `open.inputNo`가 2, `open.clarifications`가 `[{ ask, reply }]`, 턴의 `answer`가 `null`.
  8. `되묻기 기록은 다음 질문과 정답지의 대화에 앱과 같은 꼴로 실린다` — 되묻기 뒤 답하고 다음 질문을 만든다. 둘째 `question` 호출의 `user`에 `` `${첫 질문 문장}\n(되묻기) 지원자: ${ask} / 면접관: ${reply}` ``가 있다. 둘째 턴의 `complete`가 부른 `answerKey` 호출의 `user`에 첫 질문과 답은 있고, 둘째 턴 자신은 대화 목록에 없다(초안으로만 있다).
  9. `되묻기 응답이 실패한 뒤 resume은 분석을 다시 하지 않는다` — `analyze` 호출이 한 번.
  10. `분석이 실패하면 답은 남고 resume이 이어 간다` — 실패 뒤 `view.pending`이 `'retry'`, 턴의 `answer`가 그 글. `resume` 뒤 턴이 둘.
  11. `질문 생성이 실패한 뒤 resume은 분석을 다시 하지 않고, 말한 기술과 모른다고 한 기술이 한 번만 들어가 있다`.
  12. `secondary가 있는 답 뒤에 질문 생성이 한 번 실패해도, 다시 하면 primary가 먼저 묻는다` — 실패한 뒤에도 마지막 턴의 `pendingSecondary`가 그대로이고, `resume` 뒤 새 턴의 면접관이 primary다.
  13. `답이 저장된 턴에 submitAnswer를 다시 부르면 답을 바꾸지 않고 이어 간다` — 10의 상태에서 `submitAnswer(id, '다른 글')`. 턴 1의 `answer`가 처음 글 그대로이고 턴이 둘.
  14. `답 파일은 답이 저장된 뒤에 지운다` — `submitAnswer(id, text, file)` 뒤 파일이 없다. 답이 이미 저장된 턴에 불러도 파일이 없어진다. `store.writeAnswer`가 던지게 하면 파일이 남아 있다.
  15. `정답지 뒤 작업이 돌고 있으면 기다렸다가 분석한다. 정답지 호출은 한 번이다` — `answerKey` 큐의 값을 손으로 푸는 Promise로 두고, `complete(id, 1)`을 먼저 시작한 뒤 `submitAnswer`를 부르고, 조금 뒤 Promise를 푼다. `answerKey` 호출 1번, `verify` 1번, `analyze`는 그 뒤에 불렸다.
  16. `뒤 작업이 없으면 답이 왔을 때 그 자리에서 정답지를 만든다` — `launchCompletion`이 아무것도 하지 않는다.
  17. `뒤 작업이 실패하면 로그만 남기고, 답이 왔을 때 다시 만든다` — `complete`가 던지지 않고 `errors.log`가 생긴다. 그 뒤 `submitAnswer`가 성공하고 `answerKey` 호출이 모두 두 번이다.
  18. `같은 턴에 complete를 동시에 두 번 불러도 정답지 호출은 한 번이다`.
  19. `잠금을 잡은 사이에 정답지가 쓰였으면 다시 만들지 않는다` — `store.acquireKeyLock`을 감싸, 잡기 직전에 `writeKey`로 정답지를 써 넣게 한다. `complete`와 `submitAnswer` 각각에서 `answerKey` 호출이 0번이고 `key.json`이 처음 쓴 값 그대로다.
  20. `죽은 잠금만 남아 있어도 답이 오면 치우고 정답지를 만든다` — 턴 폴더에 `{ pid: 999999, at: 지금 }`의 `key.lock`을 손으로 둔다.
  21. `resume은 정답지도 잠금도 없으면 뒤 작업을 다시 띄우고, 살아 있는 잠금이 있으면 띄우지 않는다`.
  22. `검증이 정답지를 고치면 분석은 고친 정답지를 받는다` — `verify` 응답의 고친 내용이 `analyze`의 `user`에 있고 `readKey().answerKeyCorrected`가 `true`.
  23. `덧붙이기: secondary가 있으면 다음 질문 뒤에 다른 면접관이 addOn으로 묻는다` — 셋째 턴의 `addOn`이 `true`, `causeTurnId`가 원인 턴의 id, 셋째 턴의 `pendingSecondary`가 `null`.
  24. `덧붙이기가 기다리는데 지원자가 모른다고 하면 덧붙이기를 버리고 같은 면접관이 넘어간다`.
  25. `모른다고 한 기술은 쌓여 이후 질문에 실린다. 스스로 꺼낸 모름도 쌓이고 말한 기술에는 들어가지 않는다` — 세션의 `unknownTechs`와 `userMentioned`, 다음 `question`의 `user`에 `'지원자가 모른다고 한 기술'`.
  26. `절반을 넘도록 가정 변경이 없으면 정체성 비교 축을 지정한다` — `questionLimit: 4`, 가정 없는 질문 둘 뒤 셋째 `question`의 `user`에 `'identity_swap'`.
  27. `질문 수에 닿으면 마지막 답을 분석하고 끝낸다` — `status`가 `'finished'`, `closing`이 `CLOSING_TEXT`, `open`이 `null`.
  28. `끝난 면접에 온 답은 finished 오류`.
  29. `finish는 답이 없는 턴이 있어도 끝낸다`.
  30. `할 일이 없으면 resume은 모델 호출 없이 view를 준다`.
  31. `submitAnswer는 걸린 시간을 남긴다` — `readCalls`에 `{ type: 'wait', seq: 1 }`이 있고 `wall_ms`가 숫자다.
  32. `view에 숨길 값이 없다` — 가정 문장, 결함 메모, 정답지의 글, 성향 이름(`'집요형'`, `'조력형'`, `'흔드는형'`)이 `JSON.stringify(view)`에 없다.

- [ ] **Step 2: 실패를 확인한다** — `node --test plugin/test/interview.test.mjs` → FAIL
- [ ] **Step 3: `interview.mjs`를 구현한다.**
- [ ] **Step 4: 통과를 확인한다** — 32개 PASS. 전체 테스트 PASS.
- [ ] **Step 5: 커밋** — `feat: 면접 한 판의 진행`

---

### Task 6: 복기, 기억, 추이, 문서

**Files:**
- Create: `plugin/skills/pressure-interview/scripts/lib/review.mjs`, `render.mjs`
- Test: `plugin/test/review.test.mjs`, `plugin/test/render.test.mjs`

**Interfaces:**
- Consumes: `store`(Task 2), `TurnService`(Task 4), `memory-rules.mjs`·`review.view.mjs`·`stats.mjs`·`catalog.mjs`(Task 1), 면접 서비스(Task 5).
- Produces: `review.mjs`
  - `syncMemory(store, interviewId, at: Date): void` — `aeae0dd:src/memory/memory.service.ts`의 `sync`를 `memory.json` 위에서 그대로 한다. 새 기록의 id는 `crypto.randomUUID()`, `createdAt`은 `at`(있던 기록의 `createdAt`은 그대로). 만남의 `sessionId`는 면접 id, `turnId`는 턴의 id. 접을 때 넘기는 세션은 `pendingSecondary`가 없어도 된다.
  - `createReviewService({ store, config, llmFor, now = () => new Date() })`
    - `latestFinished(): string | null` — 가장 최근에 끝난 면접.
    - `run(id): Promise<{ done, total, failed, ready }>` — 끝나지 않은 면접이면 `EngineError('not_finished')`. 복기가 없는 대상 턴을 `config.reviewConcurrency`개씩 복기한다(입력은 앱의 `reviewInput`과 같다. `knownAssumptions`는 기억의 같은 축 기록을 `createdAt`, `id` 순으로, 열쇠는 기억의 id. 그 뒤에 앞선 턴의 같은 축 가정, 열쇠는 `turn:<턴 id>`). 턴 하나가 실패하면 `logError`하고 나머지를 계속한다. 대상이 모두 복기됐으면 `syncMemory` → `reviewedAt`을 적는다 → `review.md`와 `stats.md`를 쓴다 → `ready: true`. 기억 맞추기가 실패하면 `reviewedAt`을 적지 않고 `EngineError('memory_sync_failed')`를 던진다. 다시 부르면 복기가 없는 턴만 하고, 모두 있으면 기억부터 맞춘다.
    - `mark(id, seq, { result?, surprise? }): { ready: true }` — 끝나지 않았으면 `not_finished`, `reviewedAt`이 없으면 `not_reviewed`. 복기 대상이 아닌 턴이면 `not_reviewable`. `result`는 가정을 바꾼 질문의 턴에만(`not_reviewable`). `result`는 `review.assumption.userResult`로, `surprise`는 턴의 `surprise`로 저장한다. 그다음 `syncMemory`, `review.md`와 `stats.md`를 다시 쓴다. 기억 맞추기가 실패하면 저장한 값은 그대로 두고 `reviewedAt`을 지운 뒤 `EngineError('memory_sync_failed')`를 던진다(앱과 같다. 다음 `run`이 기억부터 맞춘다).
    - `stats(): { improved, sessions, pendingTopics }` — 최근 끝난 면접 열 개로 `computeStats`, 그리고 `pendingTopics(기억, now(), config.reissueAfterHours)`. `stats.md`도 다시 쓴다.
    - `paths(id): { review: string, stats: string }` — 두 문서의 절대 경로(`<dataDir>/interviews/<id>/review.md`, `<dataDir>/stats.md`).
- Produces: `render.mjs`
  - `sayQuestion(view): string` — `` `**질문 ${seq}/${questionLimit} · ${roleName} 면접관**\n\n${text}` ``
  - `sayClarify(view, reply): string` — `` `**${roleName} 면접관**\n\n${reply}` ``
  - `summarizeCalls(rows): { kind, model, calls, inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens, durationMs }[]` — `type`이 없는 줄을 종류와 모델로 묶는다.
  - `renderReview(reviewView, { usage, waits }): string` — `reviewView`는 `toReviewView`의 결과, `waits`는 `{ seq, wall_ms }[]`.
  - `renderStats({ improved, sessions, pendingTopics }): string`
  - 이름표: 결함 재검사 `valid` "맞는 판정", `misjudged` "오판". 이 답에서 나온 질문 `valid_point` "맞는 지적", `misjudgment` "오판", `intended_test` "의도된 확신 시험", `deepening` "더 깊이 물음". 가정 결과 `well` "잘 답함", `wobbly` "흔들림", `wrong` "틀림", `none` "해당 없음". 예상 표시 `expected` "예상했음", `unexpected` "예상 밖", 없으면 "표시 없음". 답이 의도를 향했는가는 "향했음" / "빗나감".
  - `review.md`의 차례 [제안]: 제목(주제, 날짜) → 가정별 결과 표 → 질문마다 한 절(설계 7.1의 항목을 그 순서로) → 복기에서 빠진 답의 수(0이면 줄을 뺀다) → 호출 기록 표(종류, 모델, 횟수, 토큰 넷, 걸린 시간) → 답 뒤 대기 표(질문 번호, 초). 답 시작 시간은 어디에도 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 면접은 Task 5의 서비스와 `fakeLlm`으로 끝까지 돌려 만든다.

`review.test.mjs`:
  1. `진행 중인 면접의 run은 not_finished`.
  2. `끝난 면접을 run하면 대상 턴마다 복기 호출이 한 번씩 돈다` — `review` 호출 수가 대상 수, `ready`가 `true`, `reviewedAt`이 있고, `review.md`와 `stats.md`가 있다.
  3. `run을 두 번 불러도 복기 호출은 턴마다 한 번이다`.
  4. `일부 턴이 실패하면 문서를 쓰지 않고, 다시 부르면 그 턴만 한다` — 첫 번째는 `{ ready: false, failed: 1 }`이고 `review.md`가 없다. 두 번째의 `review` 호출은 한 번이고 `ready: true`.
  5. `분석 없이 남은 답은 대상이 아니다` — `finish`로 끝낸 면접. `review` 호출 수에 들지 않고 `review.md`에 "복기에서 빠진 답 1개"가 있다.
  6. `같은 축의 앞선 가정을 알려 준다` — 둘째 가정 변경 질문의 복기 `user`에 `'turn:01'`이 있다.
  7. `덧붙이기가 낀 면접에서 이 답에서 나온 질문을 원인 턴으로 짝짓는다` — 원인 턴의 복기 `user`에 질문 둘이 있다.
  8. `복기가 끝나면 가정이 기억에 들어간다` — `memory.json`에 기록 하나, `status`가 복기의 결과, 만남의 `sessionId`가 면접 id, `createdAt`이 `now()`의 값.
  9. `기억 맞추기는 여러 번 해도 같다` — `syncMemory`를 두 번 부른 뒤 기록의 id와 내용이 같다.
  10. `두 면접이 같은 가정에 합류하면 기록은 하나이고 만남은 시각 순이다` — 둘째 면접의 복기가 `sameAs`로 첫 기록의 id를 준다.
  11. `한 면접 안의 같은 가정은 묶이고 마지막 답의 결과를 쓴다` — `sameAs: 'turn:02'`.
  12. `가정 결과를 고치면 기억이 따라 바뀐다` — `mark(id, 2, { result: 'well' })` 뒤 기록의 `status`가 `'well'`이고 `review.md`에 "잘 답함"이 있다.
  13. `복기가 해당 없음으로 준 턴도 고친 결과는 기억에 들어간다`.
  14. `가정을 바꾸지 않은 질문의 결과를 고치려 하면 not_reviewable. 예상 표시는 된다`.
  15. `복기 전의 면접에 mark는 not_reviewed, 끝나지 않은 면접에는 not_finished`.
  16. `기억 맞추기가 실패하면 reviewedAt이 없고, 다시 run하면 맞춘다` — `store.writeMemory`가 한 번 던지게 한다. 첫 `run`은 `memory_sync_failed`, 둘째는 `review` 호출 없이 `ready: true`.
  17. `mark 뒤 기억 맞추기가 실패하면 고친 값은 남고 reviewedAt이 지워진다` — 그 뒤 `run`이 `ready: true`이고 기억이 고친 값을 따른다.
  18. `stats: 흔들림에서 잘 답함으로 바뀐 가정을 세고, 예상 밖 비율과 다시 연습할 주제를 준다`.

`render.test.mjs`:
  1. `sayQuestion과 sayClarify의 꼴` — 위의 문자열과 같다.
  2. `review.md에 설계 7.1의 항목이 있다` — 가정별 결과 표, 질문 문장, 면접관의 직무 이름과 성향 이름, 되묻기의 묻고 답한 글, 내 답, 질문 의도의 이름과 묶음, 반응 의도의 이름, 결함 메모, "향했음" 또는 "빗나감", "맞는 판정"과 "오판", "더 깊이 물음", 가정 문장과 "흔들림", 정답지의 네 항목 글, "정답지 수정됨"(고쳐진 턴), 복기가 찾은 정답지의 문제, 흘림 표시와 전제 표시(해당 턴), "예상 밖", 호출 기록 표의 종류 이름, 답 뒤 대기.
  3. `review.md에 답 시작 시간이 없다` — "답 시작"이 없다.
  4. `summarizeCalls는 종류와 모델로 묶고 wait 줄은 뺀다`.
  5. `stats.md의 꼴` — 바뀐 가정 수, 면접 줄(날짜, 주제, 비율 또는 "표시 없음"), 다시 연습할 주제.

- [ ] **Step 2: 실패를 확인한다** — `node --test plugin/test/review.test.mjs plugin/test/render.test.mjs` → FAIL
- [ ] **Step 3: `render.mjs`와 `review.mjs`를 구현한다.**
- [ ] **Step 4: 통과를 확인한다** — 23개 PASS. 전체 테스트 PASS.
- [ ] **Step 5: 커밋** — `feat: 복기, 기억, 추이와 그 문서`

---

### Task 7: 엔진 명령 (`cli.mjs`)

**Files:**
- Create: `plugin/skills/pressure-interview/scripts/cli.mjs`
- Modify: `plugin/test/helpers.mjs`
- Test: `plugin/test/cli.test.mjs`, `plugin/test/leak.test.mjs`

**Interfaces:**
- Consumes: Task 2~6의 모든 모듈, `makeWorld`·`push`·`fakeCalls`(Task 3).
- Produces: `node cli.mjs <명령> [인자]`. 표준 출력에 JSON 하나, 표준 오류에는 아무것도 없다. `ok`가 `false`이면 종료 코드 1, 아니면 0.

| 명령 | 하는 일 | 성공 출력의 `kind` |
|---|---|---|
| `status` | 진행 중인 면접, 다시 연습할 주제, 최근 면접 다섯(id, 주제, 날짜) | `status` |
| `setup --data-dir <경로>` | 폴더를 만들고 설정에 적는다 | `status` |
| `start --topic <주제>` | `checkClaude` → `start` | `question` |
| `answer` | 진행 중인 면접의 열린 턴에서 `readAnswerFile` → 없으면 `no_answer` → `submitAnswer(id, text, file)`. 답이 저장된 턴이면 파일의 글을 보지 않고 `submitAnswer(id, null, file)` | `question` / `clarify` / `finished` |
| `resume` | `resume`. 진행 중인 면접이 없으면 `no_interview` | `question` / `clarify` / `finished` |
| `finish` | `finish`. 진행 중인 면접이 없으면 `no_interview` | `finished` |
| `review [id]` | 대상 면접(아래)에 `run` | `review_ready` / `review_partial` |
| `mark <번호> <well\|wobbly\|wrong> [id]` | 대상 면접에 `mark` | `marked` |
| `surprise <번호> <expected\|unexpected> [id]` | 대상 면접에 `mark` | `marked` |
| `stats` | `stats` | `stats` |
| `doctor` | 설정, `checkClaude`. `--call`이 있으면 `jobRole` 호출을 주제 `Redis`로 한 번 한다 | `doctor` |
| `complete <id> <seq>` | `complete`. 출력 없음 | (없음) |

- **설정이 없거나 설정의 면접 폴더가 없으면** `setup`과 `doctor`를 뺀 모든 명령이 `{ ok: true, kind: 'setup_needed' }`를 낸다(설계 6.1의 [결정]: 처음 부를 때 폴더를 먼저 묻는다). `complete`는 아무것도 하지 않고 끝난다.
- **대상 면접**(`review`, `mark`, `surprise`): id를 주면 그 면접. 없으면 `latestFinished()`. 그것도 없으면, 진행 중인 면접이 있을 때 `not_finished`, 없을 때 `no_interview`.
- 출력의 필드: `ok`, `kind`, `interview`(있을 때), `say`, `answerFile`(`kind`가 `question`·`clarify`일 때. `store.answerFile(id, open.seq, open.inputNo)`), `paths`(`review_ready`·`marked`·`stats`일 때 문서 경로), `next`.
- `say` [제안]: `question`은 `sayQuestion`, `clarify`는 `sayClarify`. `finished`는 `` `${closing}\n\n면접이 끝났습니다. 복기 문서를 만들까요? 답한 질문마다 호출이 한 번씩 더 나갑니다.` ``. `review_ready`는 가정별 결과를 센 한 줄과 `review.md`의 경로. `review_partial`은 "복기 N개 가운데 M개가 실패했습니다. 다시 하면 실패한 것만 합니다." `setup_needed`는 "면접 기록을 둘 폴더를 정해 주세요. 정답지와 질문 의도도 이 폴더 안의 hidden 폴더에 저장됩니다."
- `next` [제안]:

| `kind` | `next` |
|---|---|
| `question`, `clarify` | 사용자의 다음 메시지를 answerFile에 글자 그대로 쓰고 answer를 실행한다. say에 말을 보태지 않는다. |
| `finished` | 사용자가 복기를 만들겠다고 하면 review를 실행한다. |
| `review_ready`, `marked`, `stats` | say와 문서 경로를 알려 준다. |
| `review_partial` | 사용자가 다시 하겠다고 하면 review를 실행한다. hidden 폴더와 errors.log를 읽지 않는다. |
| `setup_needed` | 사용자에게 면접 폴더 경로를 묻고 setup --data-dir '<경로>'를 실행한 뒤, 처음 받은 명령을 다시 실행한다. |
| `status` | 진행 중인 면접이 있으면 "사용자가 이어서를 치면 resume을 실행한다.", 없으면 "사용자에게 면접 주제를 묻는다." |
| `doctor` | 결과를 알려 준다. |

- 실패 출력: `{ ok: false, kind: 'error', code, say, next }`. `code`는 `EngineError`의 것이고 그 밖의 오류는 `other`다. `say`는 코드별 고정 문장이다(원래 오류 문장을 넣지 않는다). 코드: `bad_config`, `bad_args`, `cli_missing`, `not_logged_in`, `interview_open`, `no_interview`, `no_answer`, `finished`, `not_finished`, `not_reviewed`, `not_reviewable`, `not_found`, `memory_sync_failed`, `usage_limit`, `refused`, `schema_failed`, `timeout`, `other`.
- 실패의 `next`는 모두 "hidden 폴더와 errors.log를 읽지 않는다."로 끝난다. 그 앞 문장: `usage_limit`은 "다시 시도하지 않는다. 한도가 풀린 뒤 사용자가 이어서를 치면 resume을 실행한다.", `no_answer`는 "사용자의 답을 answerFile에 쓴 뒤 answer를 다시 실행한다."(이때 출력에 `answerFile`도 싣는다), `interview_open`은 "사용자가 정하는 대로 resume으로 이어 가거나 finish로 끝낸다.", `memory_sync_failed`는 "사용자가 다시 하겠다고 하면 review를 실행한다.", 모델 호출의 실패(`refused`, `schema_failed`, `timeout`, `other`)는 "사용자가 다시 하겠다고 하면 resume을 실행한다.", `no_interview`는 "사용자가 주제를 주면 start를 실행한다.", 나머지는 "say를 보여 준다."
- **`start`가 실패했을 때는 따로 둔다**(실행 중 판단, 2026-11-18. 실패한 시작은 면접을 남기지 않아 `resume`으로 이어 갈 수 없다): `usage_limit`이면 "다시 시도하지 않는다. 한도가 풀린 뒤 사용자가 같은 주제로 다시 시작하면 start를 실행한다.", 그 밖의 모델 호출 실패면 "사용자가 다시 하겠다고 하면 같은 주제로 start를 다시 실행한다."
- 진입점은 `main`을 `try`로 감싸고 `uncaughtException`과 `unhandledRejection`에도 같은 처리기를 건다. 처리기는 `store.logError`(가능하면)에 원래 오류와 `EngineError.detail`을 쓰고 실패 출력을 낸다. 시작할 때 `process.removeAllListeners('warning')`으로 Node의 경고 출력을 끈다.
- 뒤 작업은 `spawn(process.execPath, [이 파일의 경로, 'complete', id, String(seq)], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`로 띄운다. `complete` 명령은 아무것도 출력하지 않고 실패는 `errors.log`에만 쓴다.
- `llmFor(id)`는 `createLlm({ config, record: (row) => store.appendCall(id, row) })`.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `helpers.mjs`에 `run(world, args): { status, stdout, stderr, json }`(`spawnSync(process.execPath, [cli 경로, ...args], { env: world.env, encoding: 'utf8' })`, `json`은 `JSON.parse(stdout)`)과 `answer(world, out, text)`(`out.answerFile`에 `text`를 쓰고 `run(world, ['answer'])`)를 더한다. 가짜 응답은 `push`로 넣는다. 가짜 실행기의 호출 수를 셀 때는 `kind`가 `'auth'`인 줄을 뺀다.

`cli.test.mjs`:
  1. `설정이 없으면 어느 명령이든 setup_needed` — `status`, `start --topic Redis`, `answer`, `review` 각각. 종료 코드 0, `stderr`가 `''`.
  2. `setup 뒤 status` — `kind`가 `'status'`. 그 뒤 면접 폴더를 지우면 `status`가 다시 `setup_needed`.
  3. `start는 질문을 낸다` — `kind`가 `'question'`, `say`가 `'**질문 1/6 · '`로 시작, `answerFile`이 `'/answers/01-1.txt'`로 끝난다, `stdout`이 JSON 하나다, `stderr`가 `''`.
  4. `떼어 낸 뒤 작업이 정답지를 남긴다` — `start` 뒤 5초 안에 `hidden/turns/01/key.json`이 생긴다(100ms마다 본다).
  5. `답 파일 없이 answer는 no_answer` — 종료 코드 1, 출력에 `answerFile`이 있다.
  6. `답은 글자 그대로 저장된다` — `'끝'`을 답으로 넘기면 `finish`가 아니라 답으로 저장되고 다음 질문이 나온다. `'가\r\n나'`는 `'가\n나'`로 저장된다. 답한 뒤 답 파일이 없다.
  7. `resume은 열린 질문과 같은 answerFile을 다시 준다` — `start` 뒤 `resume`의 `say`와 `answerFile`이 `start`의 것과 같고 모델 호출이 늘지 않는다.
  8. `한 판: 질문 둘, 끝, 복기, 고침, 표시, 추이` — `makeWorld({ questionLimit: 2 })`. `finished`의 `say`에 `'준비한 질문은 여기까지입니다. 수고하셨습니다.'`가 있다. `review`가 `review_ready`이고 `paths.review` 파일이 있다. `mark 2 well`과 `surprise 1 unexpected`가 `marked`. `stats`의 `paths.stats` 파일이 있다. `calls.jsonl`에서 `type`이 없는 줄 수가 가짜 실행기가 받은 호출 수(`auth` 제외)와 같다.
  9. `진행 중인 면접이 있으면 start는 interview_open`. `끝난 면접이 없는데 id 없이 친 review·mark·surprise는 not_finished`. `면접이 하나도 없으면 no_interview`.
  10. `실패 코드` — 표로: `question` 응답이 `{ raw: '{"api_error_status":429,"is_error":true}' }`→`usage_limit`; `{ raw: '{"stop_reason":"refusal","is_error":false}' }`→`refused`; `{ raw: '{"is_error":false}' }`→`schema_failed`; `{ raw: 'not json' }`→`other`; `{ raw: '', exit: 2 }`→`other`; `makeWorld({ callTimeoutMs: 300 })`에 `{ hang: true }`→`timeout`; `claudeCommand: ['pi-no-such-command-xyz']`→`cli_missing`; `auth.json`이 `{"loggedIn":false}`→`not_logged_in`. 모두 종료 코드 1, `stderr`가 `''`, `next`가 `'hidden 폴더와 errors.log를 읽지 않는다.'`로 끝난다. 모델 호출이 실패한 경우마다 가짜 실행기가 받은 `question` 호출이 한 번이다(스스로 다시 부르지 않는다).
  11. `실패한 뒤 resume이 이어 간다` — 분석 호출이 한 번 실패한 뒤 `resume`이 다음 질문을 낸다. 답은 한 번만 저장돼 있다.
  12. `안에서 난 오류도 코드만 낸다` — `hidden/session.json`을 깨진 JSON으로 바꾸고 `answer`. 출력의 `code`가 `'other'`, `stderr`가 `''`, 출력에 `'SyntaxError'`와 스택 문자열(`'    at '`)이 없다. `errors.log`에는 있다.
  13. `doctor` — `kind`가 `'doctor'`. `--call`이 없으면 가짜 실행기가 받은 호출은 `auth`뿐이다.
  14. `잘못된 명령은 bad_args`.

`leak.test.mjs` (설계 10장의 숨김 누출 검사):
  - 표식 `@@HIDDEN@@`을 가짜 응답의 숨길 필드마다 심는다: 질문 초안의 `assumption.statement`, 정답지의 모든 문자열, 검증의 `problems`와 고친 값, 전제 검사의 `problems`, 분석의 결함 `note`, 복기의 모든 `note`와 `keyProblems`. 질문 문장과 되묻기 응답에는 심지 않는다(그것은 화면에 나간다).
  1. `면접이 끝나기 전의 어떤 출력에도 표식이 없다` — `status`, `start`, `answer`(되묻기 한 번 포함), `resume`, `status`, 끝나지 않은 면접에 친 `review`·`mark`·`surprise`, `stats`를 차례로 돌리고, 각 `stdout + stderr`에 `@@HIDDEN@@`, `'집요형'`, `'조력형'`, `'흔드는형'`이 없다.
  2. `실패할 때도 표식이 없다` — `analyze` 응답을 `{ raw: '{"structured_output": "@@HIDDEN@@ 깨진' }`(깨진 JSON), `{ raw: '@@HIDDEN@@', exit: 1, stderr: '@@HIDDEN@@' }`로 각각 두고 `answer`. 출력에 표식이 없다. `errors.log`에는 있다.
  3. `뒤 작업이 실패해도 앞 명령의 출력에 표식이 없다` — `answerKey` 응답을 `{ raw: '@@HIDDEN@@', exit: 1 }`로 둔다.
  4. `끝난 뒤에는 review.md에 표식이 있다` — 숨긴 것이 복기에서 공개되는지 본다.

- [ ] **Step 2: 실패를 확인한다** — `node --test plugin/test/cli.test.mjs plugin/test/leak.test.mjs` → FAIL
- [ ] **Step 3: `cli.mjs`를 구현한다.**
- [ ] **Step 4: 통과를 확인한다** — 18개 PASS. 전체 테스트 PASS. 테스트가 띄운 프로세스가 남지 않았는지 본다(`hang` 경우의 자식).
- [ ] **Step 5: 커밋** — `feat: 엔진 명령과 숨김 누출 검사`

---

### Task 8: `SKILL.md`와 README

**Files:**
- Create: `plugin/skills/pressure-interview/SKILL.md`, `plugin/README.md`
- Modify: `README.md`(저장소 뿌리. 끝에 한 단락)
- Test: `plugin/test/docs.test.mjs`

**Interfaces:**
- Consumes: Task 7의 명령과 출력.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `docs.test.mjs`
  - `SKILL.md의 frontmatter` — 첫 줄이 `---`, `name: pressure-interview`, `disable-model-invocation: true`가 있다.
  - `지킬 것이 앞 3,000자 안에 있다` — `'hidden'`, `'그대로'`, `'answerFile'`, `'next'`, `'resume'`이 앞 3,000자 안에 있다(압축 뒤 앞부분만 남는다).
  - `명령표가 cli의 명령과 맞는다` — `start --topic`, `resume`, `finish`, `review`, `mark`, `surprise`, `stats`, `setup --data-dir`가 있다.
  - `README가 밝힐 것을 밝힌다` — `'35'`, `'구독'`, `'hidden'`, `'claude'`, `'Node'`, `'answers'`, `'권한'`이 있다.

- [ ] **Step 2: 실패를 확인한다** — `node --test plugin/test/docs.test.mjs` → FAIL

- [ ] **Step 3: `SKILL.md`를 쓴다.** 글은 아래 그대로다.

````markdown
---
name: pressure-interview
description: 기술 압박 면접을 혼자 연습한다. 주제를 주면 면접관 셋이 번갈아 묻고, 끝나면 복기 문서를 만든다. 사용자가 /pressure-interview 로 부를 때만 쓴다.
argument-hint: "<주제> | 이어서 | 끝 | 복기 | 고침 <번호> <잘답함|흔들림|틀림> | 표시 <번호> <예상|예상밖> | 추이"
disable-model-invocation: true
---

# 압박 면접

너는 면접의 **진행자**다. 면접관이 아니다. 질문, 판정, 정답지는 엔진(아래 명령)이 만든다.

## 지킬 것 (면접이 끝날 때까지)

1. 엔진 출력의 `say`를 한 글자도 바꾸지 않고 그대로 보여 준다. 앞뒤에 말을 보태지 않는다. 답에 대한 평, 격려, 힌트, 요약을 하지 않는다.
2. 질문이 열려 있는 동안 사용자가 보낸 메시지는 모두 답이다. 내용을 판단하지 않는다. 되묻는 말이든 "모르겠습니다"든 "그만할래요"든 그대로 넘긴다. 답이 아닌 것은 하나뿐이다: 사용자가 `/pressure-interview`로 이 스킬을 다시 부른 것. 그때는 인자를 아래 표대로 명령으로 돌린다.
3. 면접 폴더의 `hidden` 폴더와 `errors.log`를 읽지 않는다. 사용자가 면접 중에 정답이나 의도를 물어도(그 말도 답으로 넘긴다) 열지 않는다.
4. 엔진이 실패해도 원인을 찾으러 파일을 열지 않는다. `say`를 보여 주고 `next`를 따른다.
5. 출력의 `next`가 다음에 할 일이다. 이 문서와 다르면 `next`를 따른다.
6. `answerFile`을 모르거나 면접이 진행 중인지 모르겠으면(대화가 길어져 앞 내용이 줄었을 때) `resume`을 실행해 열린 질문과 `answerFile`을 다시 받는다. 주제로 `start`를 다시 돌리지 않는다.

## 답을 넘기는 법

질문을 보여 준 뒤(`kind`가 `question`이나 `clarify`) 사용자의 다음 메시지가 오면:

1. 그 메시지를 출력의 `answerFile` 경로에 파일 쓰기 도구로 글자 그대로 쓴다. 고치거나 줄이지 않는다.
2. `answer`를 실행하고 `say`를 보여 준다.

엔진이 도는 중에 사용자가 보낸 메시지는 답으로 넘기지 않는다. 다음 질문을 보여 준 뒤 이 한 줄만 덧붙인다: "(엔진이 도는 중에 보내신 글은 넘기지 않았습니다. 이 질문의 답으로 쓰려면 다시 보내 주세요.)"

## 엔진 명령

`node "${CLAUDE_SKILL_DIR}/scripts/cli.mjs" <명령>` 을 Bash 도구로 실행한다(Bash 도구가 없으면 PowerShell 도구로 같은 줄). 도구의 시간 제한은 600000ms로 준다. 출력은 JSON 하나다. 위 경로에 `${CLAUDE_SKILL_DIR}`라는 글자가 그대로 남아 있으면, 이 스킬이 불릴 때 함께 온 "Base directory for this skill" 줄의 경로를 대신 쓴다.

| 사용자가 친 것 | 명령 |
|---|---|
| (인자 없음) | `status` |
| `<주제>` | `start --topic '<주제>'` (작은따옴표로 감싼다. 주제 안의 작은따옴표는 뺀다) |
| `이어서` | `resume` |
| `끝` | `finish` |
| `복기 [면접 id]` | `review [면접 id]` |
| `고침 <번호> <잘답함/흔들림/틀림> [면접 id]` | `mark <번호> <well/wobbly/wrong> [면접 id]` |
| `표시 <번호> <예상/예상밖> [면접 id]` | `surprise <번호> <expected/unexpected> [면접 id]` |
| `추이` | `stats` |

이 스킬이 불렸을 때의 인자: $ARGUMENTS

첫 낱말이 위 표에 없으면 인자 전체가 주제다.

## 그 밖의 경우

- `kind`가 `setup_needed`: 사용자에게 면접 기록을 둘 폴더의 경로를 묻고 `setup --data-dir '<경로>'`를 실행한다. 그다음 처음 받은 명령을 다시 실행한다.
- `kind`가 `status`: `say`를 보여 준다.
- `ok`가 `false`: `say`를 보여 준다. `next`를 따른다. `code`가 `usage_limit`이면 다시 하지 않는다.
- 명령이 JSON 없이 끝났을 때(도구의 시간 제한 등): 파일을 열지 않는다. 사용자에게 처리가 끝나지 않았다고 알리고, 사용자가 다시 하겠다고 하면 `resume`을(복기를 만들던 중이었으면 `review`를) 실행한다.
- `kind`가 `finished`: `say`를 보여 준다. 사용자가 복기를 만들겠다고 하면 `review`를 실행한다.
- `kind`가 `review_partial`: `say`를 보여 준다. 사용자가 다시 하겠다고 하면 `review`를 실행한다.
- `kind`가 `review_ready`, `marked`, `stats`: `say`와 문서의 경로를 알려 준다. 면접이 끝난 뒤에는 그 문서를 읽고 사용자와 이야기해도 된다.
````

- [ ] **Step 4: 권한 규칙의 꼴을 확인한다.** 공식 문서(https://code.claude.com/docs/en/permissions)를 읽고, 사용자의 `settings.json`에 넣을 허용 규칙 둘의 정확한 꼴을 정한다: 엔진 명령 하나(Bash 도구용, PowerShell 도구용)와 면접 폴더의 `answers/` 아래 파일 쓰기(파일 쓰기 도구가 어느 규칙 이름으로 묶이는지, 절대 경로를 어떻게 적는지). 문서에서 확인하지 못한 꼴은 README에 "확인하지 못함"이라고 적는다. 근거를 보고에 적는다.

- [ ] **Step 5: `plugin/README.md`를 쓴다.** 절과 꼭 들어갈 사실:
  1. 무엇인가 — 한 문단. 앱(`README.md`)과의 관계 한 줄.
  2. 필요한 것 — Claude Code 명령줄 `claude`(구독으로 로그인), Node 24. 데스크톱 앱만 설치한 경우에는 명령줄을 따로 설치해야 한다. npm으로 설치해 `claude.cmd`인 경우에는 설정의 `claudeCommand`를 고친다.
  3. 설치 — `~/.claude/skills/pressure-interview`를 이 저장소의 `plugin/skills/pressure-interview`로 잇는 방법(Windows `mklink /J`, macOS·Linux `ln -s`). 새 세션에서 `/pressure-interview`.
  4. 쓰는 법 — 설계 6.1의 명령표. 질문이 열려 있는 동안의 메시지는 모두 답이라는 것. 멈추려면 `/pressure-interview 끝`.
  5. 호출과 한도 — 질문마다 5~6회(질문 문장, 흘림 검사, 가정을 바꾼 질문이면 전제 검사, 정답지 작성, 정답지 검증, 답 분석), 시작할 때 1회, 다시 만들기와 되묻기가 있으면 더, 복기는 답한 질문마다 1회. 앱의 실제 한 판(질문 6)은 35회 + 복기 6회였다. 구독 한도를 쓴다. API 키를 쓰지 않는다(엔진이 `ANTHROPIC`·`CLAUDE`로 시작하는 환경 변수를 지우고 부르고, 시작할 때 구독 로그인인지 확인한다). 한 판이 한도를 얼마나 쓰는지는 재 본 값이 생기면 적는다.
  6. 숨긴 폴더 — 정답지와 질문 의도는 면접 폴더의 `interviews/<면접>/hidden/`에 있다. 면접이 끝나기 전에는 열지 않는다. 열면 보인다.
  7. 권한 창 — 답 하나마다 파일 쓰기 한 번과 명령 실행 한 번이 일어난다. Step 4에서 정한 허용 규칙. 스킬은 설정 파일을 고치지 않는다.
  8. 설정 — `~/.pressure-interview/config.json`의 항목과 기본값(Task 2의 `DEFAULTS`).
  9. 문제가 생기면 — `node <스킬 폴더>/scripts/cli.mjs doctor`, 코드별 뜻.
  10. 개발 — 테스트 명령, `tools/port-app-src.mjs`, `lib/app/`은 손대지 않는다는 것.

- [ ] **Step 6: 저장소 뿌리의 `README.md` 끝에 한 단락을 더한다** — 제목 `## 스킬`. 같은 면접을 서버 없이 Claude Code 스킬로 돌리는 것이 `plugin/`에 있고 쓰는 법은 `plugin/README.md`에 있다는 두 문장.
- [ ] **Step 7: 통과를 확인한다** — `node --test plugin/test/docs.test.mjs` → PASS. 전체 테스트 PASS.
- [ ] **Step 8: 커밋** — `docs: 스킬의 SKILL.md와 README`

---

### Task 9: 앱의 기억을 옮기는 도구

**Files:**
- Create: `tools/import-app-memory.mjs`
- Test: `plugin/test/import-memory.test.mjs`

**Interfaces:**
- Consumes: `openStore`(Task 2), `loadConfig`(Task 2).
- Produces: `export function toRecords(rows): Record[]` — DB의 줄(`{ id, axis, statement, status, encounters, last_seen_at, created_at }`)을 `{ id, axis, statement, status, encounters, lastSeenAt: Date, createdAt: Date }`로 바꾼다.
- Produces: `node tools/import-app-memory.mjs [--container pressure-interview-db] [--db interview] [--user interview]` — `docker exec <container> psql -U <user> -d <db> -At -c "<select>"`로 `assumption_records`를 JSON 한 덩어리로 읽는다(`select coalesce(json_agg(r), '[]') from (select id, axis, statement, status, encounters, last_seen_at, created_at from assumption_records order by created_at, id) r`). 설정의 면접 폴더에 `memory.json`으로 쓴다. `memory.json`에 이미 기록이 있으면 쓰지 않고 그렇다고 알린 뒤 종료 코드 1로 끝난다. 끝나면 옮긴 기록 수와 상태별 수를 낸다. DB에는 `select`만 보낸다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `toRecords`가 날짜를 `Date`로 바꾸고 `encounters`를 그대로 둔다. 줄 둘을 넣으면 기록 둘이 나온다. `selectMemory(toRecords(rows), now, 24)`가 던지지 않는다.
- [ ] **Step 2: 실패를 확인한다** → FAIL
- [ ] **Step 3: 구현한다.** 파일을 직접 실행했을 때만 DB를 읽는다(`import.meta.url`로 가른다).
- [ ] **Step 4: 통과를 확인한다** → PASS. 전체 테스트 PASS. **도구를 실제로 돌리지는 않는다**(사용자의 개발 DB를 읽는 일이라 아래 체크포인트에서 한다).
- [ ] **Step 5: 커밋** — `feat: 앱의 기억을 스킬로 옮기는 도구`

---

## 체크포인트: 설치와 실제 한 판 (태스크가 아니다. 사용자와 함께 한다)

모든 태스크와 전체 브랜치 검토가 끝난 뒤에 한다. 각 단계는 사용자에게 알리거나 물은 뒤에 한다.

**설계와 다른 곳 하나 [제안]:** 설계 9장은 `main`에 병합한 뒤 설치한다고 했다. 실제 한 판에서 고칠 것이 나올 수 있으므로, 병합 전에 worktree로 이어 시험하고 병합한 뒤 주 checkout으로 다시 잇는 순서를 제안한다. 사용자가 설계대로 하겠다고 하면 1단계 앞에 병합을 둔다.

1. **설치** (사용자의 설정 폴더를 건드린다. 묻고 한다): `~/.claude/skills/pressure-interview`를 worktree의 `plugin/skills/pressure-interview`로 잇는다.
2. **점검** (모델 호출 1회, 알리고 한다): `node plugin/skills/pressure-interview/scripts/cli.mjs doctor --call`.
3. **실제 한 판, Claude가 지원자** (구독 한도를 쓴다. 알리고 한다).
   - **시험용 면접 폴더에서 한다.** `setup --data-dir`로 따로 만든 폴더를 쓴다. 이 한 판의 복기가 사용자의 기억에 섞이지 않게 하려는 것이다. 기억이 다음 질문에 실리는 것을 보려면 앱의 기억을 그 폴더에 복사해 넣고, 24시간 규칙에 걸리지 않는지 코드에서 먼저 확인한다.
   - **진행자와 지원자를 나눈다.** 진행자는 스킬이 설치된 새 Claude Code 세션이다. 지원자는 답을 정해 그 세션에 메시지로 보내는 쪽이고 `hidden`을 보지 않는다. 한 세션이 둘을 겸하면 메시지가 답이 되는 길, 권한 창, 진행자가 말을 보태는지를 볼 수 없다.
   - 재고 볼 것:
     - 답 뒤 대기(엔진이 잰 값과, 메시지를 보낸 때부터 질문이 보일 때까지)
     - 호출 수와 토큰(`calls.jsonl`), 사용자가 `/usage`로 본 한도의 앞뒤
     - 권한 창이 뜬 횟수, README의 허용 규칙을 넣었을 때 줄어드는지
     - 숨길 내용이 대화에 나오지 않았는가, 진행자가 말을 보태지 않았는가
     - 보낸 답과 `review.md`에 저장된 답이 글자까지 같은가
     - sonnet 직무 고르기가 주제에 맞는 직무를 골랐는가, 흘림 검사가 기술의 역할을 제대로 갈랐는가(복기와 `hidden`에서)
     - 실패한 호출이 있었다면 그 결과의 모양(Task 3의 `classify`가 맞는지)
     - `${CLAUDE_SKILL_DIR}`가 치환됐는가
     - 터미널 세션에서도 한 번 시작해 `key.json`이 생기는지(뒤 작업이 살아남는지), PowerShell 도구로 돌렸을 때 한글 출력이 깨지지 않는지
     - 대화 압축 뒤의 진행을 봤는지 못 봤는지
4. **기록**: `docs/skill-review.md`에 측정값과 관찰, 사용자의 판정을 [결정]으로 적는다. README의 한도 절을 측정값으로 채운다.
5. **병합** (묻고 한다): 사용자가 정하면 `main`에 병합하고 연결을 주 checkout 쪽으로 다시 잇는다.
6. **기억 옮기기** (개발 DB를 읽기만 한다. 묻고 한다): 사용자가 정한 면접 폴더로 `setup`을 다시 한 뒤 `node tools/import-app-memory.mjs`. 사용자의 첫 판 바로 앞에 한다.
7. **사용자가 직접 한 판.**

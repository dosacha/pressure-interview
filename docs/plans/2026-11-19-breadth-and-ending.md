# 넓게 묻고 스스로 끝내는 면접 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스킬 `/pressure-interview`가 주제의 여러 영역을 줄기(여는 가정 변경 질문 + 꼬리질문 최대 1회) 단위로 묻고, 질문 수 제한 없이 근거를 대고 스스로 끝내게 한다.

**Architecture:** 시작할 때 `topicMap` 호출이 주제를 영역으로 나눠 숨겨 둔다. 답 분석이 점수와 신호를 더해 근거 장부를 만든다. 줄기가 닫힐 때마다 `endJudge` 호출이 계속·끝을 고르고, 순수 규칙 모듈(`thread.mjs`)이 그 판정을 장부로 다시 센다. 면접 진행(`interview.mjs`)은 이 둘을 엮고, 끝나면 같은 명령 안에서 복기까지 만든다.

**Tech Stack:** Node 24, 의존성 없음, `node:test`, 실제 모델 대신 `plugin/test/fake-claude.mjs`.

**Spec:** [`docs/specs/2026-11-19-breadth-and-ending-design.md`](../specs/2026-11-19-breadth-and-ending-design.md) (승인 2026-11-19). 실행자는 계획과 설계를 함께 읽는다. 절 번호(5.2 등)는 설계의 것이다.

## Global Constraints

- 작업 위치: worktree `C:\Users\dosac\projects\interview-skill`, 브랜치 `feat/breadth-and-ending`. git 명령은 한 줄씩(파이프·루프 없이) 돌린다.
- 테스트: `node --test "plugin/test/**/*.test.mjs"`를 저장소 뿌리에서. 모든 태스크 끝에 전부 통과해야 한다. 실제 모델(`claude`)을 부르지 않는다.
- 커밋 메시지에 Claude 표시(`Co-Authored-By`, `Generated with`)를 넣지 않는다.
- 의존성을 더하지 않는다.
- 숨길 값(주제 지도, 점수, 신호, 판정, 정답지, 의도, 결함)은 `hidden/` 밖으로, 그리고 엔진 출력으로 나가지 않는다(설계 E4).
- 점수 값과 이름은 그대로 쓴다: `solid` 잘 앎, `mostly` 대체로 앎, `unclear` 애매함, `wrong` 틀림/모름. 정의 문장은 설계 5.4의 표 그대로다.
- 신호 값: `practical` 실무 적용, `reasoning` 추론, `selfCorrection` 스스로 고침. 정의 문장은 설계 5.4 그대로다.
- 판정 값: `enough`, `exhausted`, `settled`, `continue`. 후보가 걸린 까닭: `repeat`, `contrived`, `offTopic`.
- 문턱(설계 5.5, 출발값): `CORE_MOSTLY_RATIO = 0.8`, `CORE_SOLID_RATIO = 0.5`, `PRACTICAL_THREADS = 2`, `LEARNING_SIGNALS = 1`, `SETTLED_WRONG_RATIO = 0.5`, `EXHAUSTED_CANDIDATES = 3`, 같은 영역의 전제 모름 닫힘 상한 `UNKNOWN_REOPEN_LIMIT = 2`.
- 설정: `questionLimit`를 없애고 `questionCap`(기본 30, 정수 1 이상)을 둔다. 예전 설정 파일에 `questionLimit`가 있어도 오류 없이 무시한다.
- 사용자에게 보이는 고정 문장(그대로 쓴다):
  - 시작 안내(첫 질문 `say`의 맨 앞 줄): `끝내고 싶으면 언제든 '끝'이라고 하세요. 바로 끝내고 복기를 시작합니다.`
  - Claude가 끝낼 때의 마무리: `이 주제로 준비한 면접은 여기까지입니다. 수고하셨습니다.`
  - 안전장치: `질문이 {N}개가 됐습니다. 이어 하려면 '계속', 끝내려면 '끝'이라고 하세요.`
  - 진행 중 면접: `진행 중인 면접이 있습니다({주제}). 하던 면접을 끝내고 새로 시작할까요?`
  - 예전 면접: `예전 방식의 면접이라 이어 할 수 없습니다. '끝'으로 끝내고 새로 시작해 주세요.`
  - 질문 머리: `**질문 {n} · {직무 이름} 면접관**` (분모 없음)

## Review Focus

1. **답이 정확히 "끝"일 때** — 사용자는 면접을 끝내고 복기가 나오길 기대한다. 앞뒤 공백·줄바꿈이 있어도 같아야 하고, "끝내 주세요"는 답으로 넘어가야 한다. → Task 6에 테스트.
2. **꼬리질문 뒤 답이 되묻기일 때** — 되묻기는 한도에 세지 않으므로 줄기가 닫히면 안 된다. → Task 3과 Task 6에 테스트.
3. **판정이 지도에 없는 영역이나 이미 두 번 닫힌 영역을 다음으로 줄 때** — 엔진이 멈추지 않고 안 물은 핵심 영역으로 넘어가야 한다. → Task 3에 테스트.
4. **끝내기 판정 호출이 실패했을 때** — `resume`이 분석을 다시 하지 않고 판정부터 해야 한다. → Task 6에 테스트.
5. **안전장치에서 "계속"이 아닌 말** — 끝내고 복기해야 한다. 그리고 상한에 닿은 상태에서 `resume`은 같은 안전장치 문장을 다시 내야 한다. → Task 6과 Task 7에 테스트.

---

## 파일 구조

| 파일 | 할 일 |
|---|---|
| `plugin/skills/pressure-interview/scripts/lib/thread.mjs` (새) | 줄기, 영역 상태, 판정 확인, 다음 영역·면접관 고르기. 순수 함수만 |
| `.../lib/app/interview/calls/topic-map.call.mjs` (새) | 주제 지도 호출: 스키마, 프롬프트, 호출 함수 |
| `.../lib/app/interview/calls/end-judge.call.mjs` (새) | 끝내기 판정 호출: 스키마, 프롬프트, 호출 함수 |
| `.../lib/app/interview/calls/analyze.call.mjs` | 점수와 신호를 더한다 |
| `.../lib/app/interview/calls/question.call.mjs` | 영역 지시를 받고, 덧붙임·`targetAxis`를 거둔다 |
| `.../lib/app/interview/calls/review.call.mjs` | 점수 재검사를 더한다 |
| `.../lib/app/session/session-rules.mjs` | `chooseTargetAxis`, 덧붙임 갈래를 거둔다 |
| `.../lib/turn.service.mjs` | `pickTopicMap`, `judgeEnd`, 꼬리질문 종류 |
| `.../lib/interview.mjs` | 줄기 진행, 판정, 끝내기, 안전장치, 대체 시작, 예전 면접 막기 |
| `.../lib/store.mjs` | 턴의 `thread` 필드, `judge.json` 읽고 쓰기 |
| `.../lib/config.mjs` | `questionLimit` → `questionCap` |
| `.../lib/review.mjs`, `.../lib/render.mjs`, `.../lib/app/review/review.view.mjs` | 끝낸 까닭, 영역 표, 점수, 재검사 확인 |
| `.../scripts/cli.mjs` | 새 출력 종류, `--replace`, `continue`, 끝나면 복기, 질문 머리 |
| `.../SKILL.md` | 새 출력 종류의 진행자 규칙 |
| `plugin/test/fake-claude.mjs`, `plugin/test/helpers.mjs` | 새 호출 둘의 종류 가르기 |
| `tools/port-app-src.mjs`, `plugin/test/port.test.mjs` | 지운다 |
| `README.md`, `plugin/README.md`, `docs/skill-review.md` | 문서 |

---

### Task 1: 스킬의 독립 (설계 5.1)

**Files:**
- Delete: `tools/port-app-src.mjs`, `plugin/test/port.test.mjs`
- Modify: `plugin/skills/pressure-interview/scripts/lib/app/**/*.mjs`, `plugin/test/app/**/*.mjs` 첫 줄
- Modify: `README.md`("개발" 절), `plugin/README.md`("개발" 절)
- Test: `plugin/test/docs.test.mjs`

**Interfaces:**
- Produces: 이후 태스크는 `scripts/lib/app/` 아래 파일을 손으로 고친다.

- [ ] **Step 1: Write the failing test** — `plugin/test/docs.test.mjs`에 더한다.

```js
test('옮겨 온 파일은 손으로 고치는 파일이라고 밝힌다', () => {
  const files = globAll('plugin/skills/pressure-interview/scripts/lib/app', '.mjs')
    .concat(globAll('plugin/test/app', '.mjs'));
  assert.ok(files.length > 20);
  for (const f of files) {
    const first = fs.readFileSync(f, 'utf8').split('\n')[0];
    assert.doesNotMatch(first, /생성된 파일이다/, f);
    assert.match(first, /^\/\/ 서버판 src\/.+ @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다\.$/, f);
  }
});
test('README들이 옮기는 도구를 말하지 않는다', () => {
  for (const f of ['README.md', 'plugin/README.md']) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /port-app-src/, f);
  }
});
```

`globAll(dir, ext)`는 같은 파일 안에 `fs.readdirSync(dir, { recursive: true })`로 만드는 작은 도우미다.

- [ ] **Step 2: Run it to make sure it fails** — `node --test plugin/test/docs.test.mjs`, 둘 다 FAIL.
- [ ] **Step 3: 첫 줄 바꾸기** — 각 파일의 첫 줄 `// 생성된 파일이다. 손으로 고치지 않는다. 원본: <경로> @ aeae0dd, 도구: tools/port-app-src.mjs`를 `// 서버판 <경로> @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.`로 바꾼다. 한 번 돌리는 node 스크립트로 바꾸고 스크립트는 남기지 않는다. `tools/port-app-src.mjs`와 `plugin/test/port.test.mjs`를 지운다. 두 README의 "개발" 절에서 옮기는 도구·`--check`·`aeae0dd`가 없는 클론 이야기를 지우고, "규칙과 프롬프트는 서버판(aeae0dd)에서 옮겨 왔고 이제 스킬이 직접 고친다. 서버판은 더 고치지 않는다"를 한 문장으로 쓴다.
- [ ] **Step 4: Run tests** — 전체 테스트 PASS(포트 테스트 3개가 빠져 284개 근처).
- [ ] **Step 5: Commit** — `git commit -m "refactor: 스킬이 옮겨 온 규칙과 프롬프트를 직접 가진다"`

### Task 2: 근거 장부 — 점수와 신호 (설계 5.4)

**Files:**
- Modify: `.../lib/app/interview/calls/analyze.call.mjs`
- Test: `plugin/test/app/interview/calls/calls.test.mjs` (같은 파일에 더한다), `plugin/test/fake-claude.mjs`의 기본 analyze 응답

**Interfaces:**
- Produces: `ANALYZE_SCHEMA.properties.score` (`enum: ['solid','mostly','unclear','wrong']` 또는 `null`), `ANALYZE_SCHEMA.properties.signals` (`[{ type: 'practical'|'reasoning'|'selfCorrection', quote: string }]`). 둘 다 `required`. `kind: 'clarify'`이면 `score: null`, `signals: []`. 내보내는 상수 `SCORES = ['solid','mostly','unclear','wrong']`, `SCORE_NAMES`, `SIGNAL_TYPES`, `SIGNAL_NAMES` (`catalog.mjs`에 둔다).

- [ ] **Step 1: Write the failing test**

```js
it('분석 스키마가 점수와 신호를 요구한다', () => {
  expect(ANALYZE_SCHEMA.required).toEqual(expect.arrayContaining(['score', 'signals']));
  expect(ANALYZE_SCHEMA.properties.score.anyOf ?? ANALYZE_SCHEMA.properties.score.type).toBeTruthy();
  expect(enumAt(ANALYZE_SCHEMA, ['properties', 'signals', 'items', 'properties', 'type'])).toEqual(['practical', 'reasoning', 'selfCorrection']);
});
it('분석 프롬프트가 점수와 신호의 정의를 그대로 싣는다', () => {
  const { system } = buildAnalyzePrompt(sampleInput);
  for (const s of ['핵심을 맞게 말했고, 왜 그런지 원리로 설명했다', '결론은 맞지만 이유가 얕거나', '맞는 말과 틀린 말이 섞였거나', '핵심이 틀렸거나 모른다고 했다',
    '구체적인 운영 상황에서 무엇을 고르고', '아는 원리로부터 그럴듯한 답에 다가갔다', '자기 답의 틀린 곳을 찾아 고쳤다']) expect(system).toContain(s);
  expect(system).toContain('답에서 그 부분을 글자 그대로 인용');
});
```

`buildAnalyzePrompt`가 지금 내보내지 않으면 내보낸다. `sampleInput`은 같은 파일의 기존 분석 테스트 입력을 쓴다.

- [ ] **Step 2: Run it to make sure it fails.**
- [ ] **Step 3: 스키마와 프롬프트** — 스키마에 두 필드를 더하고, 시스템 프롬프트에 "점수" 절(설계 5.4 표의 넷, 값과 정의)과 "신호" 절(셋, 해당할 때만, 인용 필수)을 더한다. 면접관이 꺼낸 전제 기술을 모른다고 한 답은 `score: null`로 두라는 문장도 넣는다(설계 5.10의 1). `fake-claude.mjs`의 기본 analyze 응답에 `score: 'mostly', signals: []`를 넣는다.
- [ ] **Step 4: Run tests** — 전체 PASS.
- [ ] **Step 5: Commit** — `feat: 답 분석이 점수와 신호를 매긴다`

### Task 3: 줄기 규칙 (설계 5.2, 5.4, 5.5의 코드 확인, 5.6, 5.10의 1)

**Files:**
- Create: `plugin/skills/pressure-interview/scripts/lib/thread.mjs`
- Test: `plugin/test/thread.test.mjs`

**Interfaces:**
- Consumes: 턴(`store.readTurns`의 모양 + Task 6이 더하는 `thread: { no, role: 'open'|'follow', areaId, followKind: 'deepen'|'defect'|null }`), 분석(`score`, `signals`, `defects`), 주제 지도 `{ areas: [{ id, name, core, why, axis, angles }] }`, 패널.
- Produces (모두 `thread.mjs`에서 내보냄):
  - `THRESHOLDS` — Global Constraints의 일곱 값.
  - `followUpKind({ score, defects, askedUnknown }) → 'deepen' | 'defect' | null` — `askedUnknown`이면 `null`, `score === 'solid'`면 `'deepen'`, 결함(`type !== 'none'`)이 있으면 `'defect'`, 그 밖 `null`.
  - `threadsOf(turns) → Thread[]` — `Thread = { no, areaId, openSeq, followSeq|null, followKind, closed, score, openScore, followScore, signals: [{ type, quote, seq }], depthLimit: boolean, unknownPremise: boolean }`. 되묻기(`analysis.kind === 'clarify'`)인 답은 줄기를 닫지 않는다. `closed`는 꼬리질문 답이 분석됐거나, 여는 질문 답이 분석됐고 `followUpKind`가 `null`이면 참.
  - `threadScore(thread)` — `unknownPremise`면 `null`, `followKind === 'defect'`면 꼬리질문 답의 점수, `'deepen'`이면 여는 질문 답의 점수(꼬리질문이 `unclear`·`wrong`이면 `depthLimit = true`), 꼬리질문이 없으면 여는 질문 답의 점수.
  - `areaStatus(topicMap, threads) → { [areaId]: { asked: boolean, unknownCount: number, threadNos: number[] } }` — `unknownPremise` 줄기만 있으면 `asked`는 거짓, 단 `unknownCount >= UNKNOWN_REOPEN_LIMIT`이면 참.
  - `checkJudgment({ judgment, topicMap, threads }) → { decision, nextAreaId|null, failed: string[] }` — 설계 5.5의 "코드의 확인". `enough`·`settled`의 조건을 다시 세고, 근거 줄기 번호가 있고 조건을 채우는지 본다. 안 맞으면 `decision: 'continue'`, `failed`에 어긋난 기준 이름(`'knows'`, `'applies'`, `'learns'`, `'coreCovered'`, `'wrongRatio'`, `'noLearning'`, `'candidates'`). `exhausted`는 핵심 영역을 다 물었고 후보가 셋이며 셋 다 까닭이 있을 때만. `continue`의 `nextAreaId`는 `pickNextArea`로 정한다.
  - `pickNextArea({ wanted, topicMap, threads }) → areaId` — `wanted`가 지도에 있고 `unknownCount < UNKNOWN_REOPEN_LIMIT`이면 그것, 아니면 안 물은 첫 핵심 영역, 없으면 안 물은 첫 영역, 없으면 지도의 첫 영역.
  - `pickOpenerFor({ area, panel, history, maxConsecutive }) → member` — `ROLES[m.role].axes`에 `area.axis`가 있는 면접관 가운데, 연속 상한에 걸린 사람을 빼고, 가장 오래 쉰 사람. 맡은 사람이 없으면 상한에 안 걸린 사람 가운데 가장 오래 쉰 사람(지금 `pickNext`의 `oldest`와 같은 규칙).

- [ ] **Step 1: Write the failing tests** — `plugin/test/thread.test.mjs`. 턴을 만드는 작은 도우미(`turn(seq, { thread, score, signals, defects, kind })`)를 파일 안에 둔다. 테스트 이름과 단정:
  - `followUpKind: 모름이면 null, solid면 deepen, 결함 있으면 defect, mostly에 결함 없으면 null`
  - `threadsOf: 여는 질문 답이 되묻기면 줄기가 열려 있다` → `closed === false`
  - `threadsOf: 꼬리질문 답이 되묻기여도 닫히지 않는다` (Review Focus 2)
  - `threadScore: defect 꼬리질문은 꼬리질문 답 점수, deepen은 여는 답 점수이고 꼬리 wrong이면 depthLimit`
  - `threadScore: 전제 모름은 null`
  - `areaStatus: 전제 모름 한 번은 안 물은 것, 두 번이면 물은 것`
  - `checkJudgment enough: 핵심 5개 다 묻고 mostly 이상 4/5, solid 3, practical 2줄기, reasoning 1 → enough`
  - `checkJudgment enough: solid가 절반 미만이면 continue, failed에 knows`
  - `checkJudgment enough: 근거 줄기 번호가 장부에 없으면 continue`
  - `checkJudgment enough: 비율 계산에서 점수 없는 줄기를 뺀다`
  - `checkJudgment settled: 핵심을 다 돌기 전이면 continue, failed에 coreCovered`
  - `checkJudgment settled: wrong 절반 이상이어도 reasoning이 있으면 continue`
  - `checkJudgment exhausted: 후보가 둘이면 continue, failed에 candidates`
  - `pickNextArea: 지도에 없는 id면 안 물은 첫 핵심 영역` (Review Focus 3)
  - `pickNextArea: 전제 모름으로 두 번 닫힌 영역을 주면 다른 영역` (Review Focus 3)
  - `pickOpenerFor: 축을 맡은 사람, 연속 상한이면 다른 사람, 맡은 사람이 없으면 가장 오래 쉰 사람`
- [ ] **Step 2: Run** `node --test plugin/test/thread.test.mjs` — FAIL(모듈 없음).
- [ ] **Step 3: Implement** — 위 Interfaces의 함수들. `ROLES`는 `./app/interview/catalog.mjs`에서 가져온다.
- [ ] **Step 4: Run** — PASS, 전체 PASS.
- [ ] **Step 5: Commit** — `feat: 줄기와 끝내기 판정의 규칙`

### Task 4: 새 호출 둘 — 주제 지도와 끝내기 판정 (설계 5.3, 5.5)

**Files:**
- Create: `.../lib/app/interview/calls/topic-map.call.mjs`, `.../lib/app/interview/calls/end-judge.call.mjs`
- Modify: `.../lib/turn.service.mjs`, `.../lib/config.mjs`(`calls.topicMap`, `calls.endJudge` 기본값), `plugin/test/fake-claude.mjs`, `plugin/test/helpers.mjs`(종류 가르기 `['areas', 'topicMap']`, `['decision', 'endJudge']`)
- Test: `plugin/test/app/interview/calls/topic-map.call.test.mjs`, `plugin/test/app/interview/calls/end-judge.call.test.mjs`

**Interfaces:**
- Produces:
  - `TOPIC_MAP_SCHEMA` — `required: ['areas']`. `areas`: 4~8개(`minItems: 4, maxItems: 8`), 항목 `required: ['id','name','core','why','axis','angles']`, `axis`는 `OWNABLE_AXES` 가운데 하나, `angles` 1~3개.
  - `buildTopicMapPrompt(topic) → { system, user }`, `generateTopicMap(llm, topic) → { data, usage }`. 받은 뒤 확인: 핵심 영역이 2~6개가 아니면, `id`가 겹치면 `EngineError('schema_failed')`.
  - `END_JUDGE_SCHEMA` — `required: ['decision','evidence','candidates','nextArea','direction','note']`. `decision` enum 넷. `evidence: { knows: number[], applies: number[], learns: number[] }`(줄기 번호). `candidates: [{ question, verdict: 'repeat'|'contrived'|'offTopic'|'ok', why }]`. `nextArea: string`(영역 id, 끝낼 때는 빈 문자열), `direction: string`(다음 여는 질문의 방향 한 문장), `note: string`(끝낸 까닭 한두 문장, 복기에 보인다).
  - `buildEndJudgePrompt({ topic, topicMap, ledger, unaskedAreaIds }) → { system, user }`, `judgeEnd(llm, input) → { data, usage }`. `ledger`는 `threadsOf`의 결과에서 줄기마다 `{ no, areaId, openText, followText, followKind, openScore, followScore, score, signals, depthLimit, unknownPremise }`만 담는다. 답의 전문은 넣지 않는다(설계 5.5).
  - `TurnService#pickTopicMap(topic)`, `TurnService#judgeEnd(input)` — 호출 종류 `topicMap`, `endJudge`.
  - 설정 기본값: `calls.topicMap = { model: 'opus', effort: 'medium' }`, `calls.endJudge = { model: 'opus', effort: 'high' }`.

- [ ] **Step 1: Write the failing tests**
  - `주제 지도 프롬프트가 핵심 영역의 정의를 싣는다` → system에 `이 주제를 실무에서 쓰는 사람이라면 반드시 알아야 할 것`, `핵심 영역은 2개 이상 6개 이하`.
  - `주제 지도의 핵심 영역이 1개면 schema_failed`
  - `판정 프롬프트가 네 판정과 기준을 싣는다` → system에 설계 5.5의 세 기준 이름, `repeat`/`contrived`/`offTopic`의 정의 문장, `다음 질문 후보 셋`, 문턱 값(`80%`, `절반`).
  - `판정 user 메시지에 답의 전문이 없다` → 장부에 넣은 줄기의 답 전문 표식 문자열이 user에 없다. 점수와 신호 인용은 있다.
  - `TurnService.judgeEnd는 종류 endJudge로 부른다` (가짜 llm의 `req.kind`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — 위 Interfaces. 판정 프롬프트는 설계 5.5의 A~D 조건을 그대로 옮겨 싣는다.
- [ ] **Step 4: Run** — PASS, 전체 PASS.
- [ ] **Step 5: Commit** — `feat: 주제 지도와 끝내기 판정 호출`

### Task 5: 질문 호출 — 여는 질문과 꼬리질문 (설계 5.2, 5.6)

**Files:**
- Modify: `.../lib/app/interview/calls/question.call.mjs`, `.../lib/app/session/session-rules.mjs`
- Test: `plugin/test/app/interview/calls/question.call.test.mjs`, `plugin/test/app/session/session-rules.test.mjs`

**Interfaces:**
- Consumes: 영역 `{ id, name, axis, angles }`, 판정의 `direction`.
- Produces: `buildQuestionPrompt(input)`의 입력에서 `addOn`, `targetAxis`를 없애고 `opening: { area: { name, axis, angles }, direction: string } | null`을 둔다. `opening`이 있으면 여는 질문, 없으면 꼬리질문(`reactionIntent`, `defect` 필수). 꼬리질문이 심화면 `reactionIntent: 'B1'`, `defect: { type: 'none', axis, note }`. `session-rules.mjs`에서 `chooseTargetAxis`를 지우고 `nextAsker`를 지운다(덧붙임이 없어져 호출하는 곳이 사라진다).

- [ ] **Step 1: Write the failing tests**
  - `여는 질문의 user 메시지가 영역, 축, 방향을 싣고 가정 변경을 요구한다` → `새 영역: <name>`, `<axis> <axisName> 축의 가정을 바꿔`, 방향 문장, `교과서 정의를 묻지 않는다`(설계 E5).
  - `첫 질문도 여는 질문이라 "기본 질문으로 시작해도 된다"가 없다`.
  - `꼬리질문의 user 메시지에 영역 지시가 없고 반응 의도와 결함이 있다`.
  - `덧붙이는 질문 문장이 프롬프트 어디에도 없다` → `저도 하나 덧붙이면` 없음.
  - 지운 함수의 기존 테스트(`chooseTargetAxis`, `nextAsker`, `addOn`)는 지운다.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — 위 Interfaces.
- [ ] **Step 4: Run** — 이 파일들 PASS. `interview.mjs`는 아직 옛 입력을 넘기므로 흐름 테스트가 깨질 수 있다. 깨진 테스트 이름을 적어 두고 Task 6에서 고친다. 전체가 통과하지 않으면 Task 5와 6을 한 커밋으로 묶는다.
- [ ] **Step 5: Commit** — `feat: 여는 질문은 영역의 가정을 바꿔 묻는다` (Task 6과 묶으면 생략)

### Task 6: 면접 진행 — 줄기, 판정, 끝내기, 안전장치 (설계 5.2~5.8, 5.10의 2·4)

**Files:**
- Modify: `.../lib/interview.mjs`, `.../lib/store.mjs`, `.../lib/config.mjs`, `.../lib/turn.service.mjs`(`handleAnswer`가 `followKind`를 돌려줌)
- Test: `plugin/test/interview.test.mjs`, `plugin/test/store.test.mjs`, `plugin/test/config.test.mjs`

**Interfaces:**
- Consumes: Task 3의 함수 전부, Task 4의 `pickTopicMap`, `judgeEnd`, Task 5의 `opening` 입력.
- Produces:
  - `question.json`의 새 필드 `thread: { no, role, areaId, followKind }`. `targetAxis`, `addOn`, `pendingSecondary`는 쓰지 않는다. `store.readTurns`는 `thread`를 실어 준다(없으면 `null`).
  - 여는 질문의 `causeTurnId`·`reactionIntent`·`defect`는 `null`, 꼬리질문의 `causeTurnId`는 여는 질문의 턴 id다. 복기의 `followUpsOf`(`causeTurnId`로 후속 질문을 찾는다)가 이 규칙에 기댄다.
  - `store.writeJudge(id, seq, judge)`, `store.readJudge(id, seq)` — `hidden/turns/NN/judge.json`. 내용: `{ judgment, checked: { decision, nextAreaId, failed }, at }`.
  - `session.json`의 새 필드: `topicMap`, `questionCap`(시작할 때 설정값), `capPending: boolean`, `end: null | { by: 'user'|'claude'|'cap'|'replaced', decision?: 'enough'|'exhausted'|'settled', judgeSeq?: number }`. `questionLimit`는 쓰지 않는다.
  - `interviews.start({ topic, replace = false })` — 진행 중 면접이 있고 `replace`가 거짓이면 `EngineError('interview_open')`(그대로), 참이면 그 면접을 `end: { by: 'replaced' }`로 끝내고 시작한다. 직무 고르기와 주제 지도를 `Promise.all`로 부른다. 첫 영역 = `pickNextArea({ wanted: null, ... })`, 첫 면접관 = `pickOpenerFor`.
  - `interviews.submitAnswer(id, text, file)` — `text.trim() === '끝'`이면 답으로 저장하지 않고 `end: { by: 'user' }`로 끝낸다(Review Focus 1).
  - `interviews.continueAfterCap(id)` — `questionCap += 30`, `capPending = false`, 다음 줄기를 연다.
  - `interviews.finish(id, by = 'user')`.
  - `view(id)`의 새 필드: `capPending`, `end`. `turnCount`는 그대로 질문 번호로 쓴다. `questionLimit`는 뺀다.
  - 예전 면접(세션에 `topicMap`이 없음)에 `submitAnswer`나 `resume`이 오면 `EngineError('legacy_interview')`. `finish`는 된다.
  - `proceed(id)`의 순서: 분석이 없으면 분석 → 되묻기면 응답 → 꼬리질문이 필요하면(`thread.role === 'open'`이고 `followKind !== null`) 같은 줄기의 꼬리질문 → 줄기가 닫혔으면 판정(`judge.json`이 없을 때만 부른다, Review Focus 4) → 끝이면 `end: { by: 'claude', decision, judgeSeq }`로 끝냄 → 계속이면 다음 질문 번호가 `questionCap`을 넘는지 보고, 넘으면 `capPending = true`, 아니면 다음 줄기를 연다.
  - 설정: `DEFAULTS.questionCap = 30`, `questionLimit`는 지우고 읽을 때 무시한다.

- [ ] **Step 1: Write the failing tests** — `interview.test.mjs`에 가짜 실행기로. 기존 테스트 가운데 `questionLimit`, `secondary`, `targetAxis`에 기대는 것(예: "secondary가 있는 답 뒤에…")은 새 규칙에 맞게 고치거나 지운다.
  - `시작하면 직무와 주제 지도를 부르고, 첫 질문은 첫 핵심 영역의 여는 질문이다` → `session.topicMap`, 첫 `question.json`의 `thread = { no: 1, role: 'open', areaId: <첫 핵심>, followKind: null }`, 질문 user에 `새 영역:`.
  - `잘 앎이면 심화 꼬리질문 하나, 그 답 뒤에는 판정을 부른다` → 둘째 질문 `thread.role === 'follow'`, `followKind === 'deepen'`, 셋째 전에 `endJudge` 한 번.
  - `결함이 있으면 결함 꼬리질문 하나, 그 답이 또 틀려도 꼬리질문은 더 없다` (설계 E1).
  - `대체로 앎에 결함이 없으면 꼬리질문 없이 판정한다`.
  - `전제 기술을 모른다고 하면 꼬리질문 없이 판정하고, 줄기 점수는 null`.
  - `꼬리질문 답이 되묻기면 응답을 붙이고 줄기를 닫지 않는다` (Review Focus 2).
  - `판정이 continue면 다음 영역을 맡은 면접관이 연다`.
  - `판정이 enough여도 조건이 안 맞으면 계속한다` → `judge.json`의 `checked.decision === 'continue'`.
  - `판정이 enough이고 조건이 맞으면 끝나고 end.by는 claude`.
  - `판정 호출이 실패하면 resume은 분석을 다시 하지 않고 판정부터 한다` (Review Focus 4) → analyze 호출 수가 늘지 않는다.
  - `답이 "끝"이면(앞뒤 공백 포함) 끝나고 답으로 저장되지 않는다`, `"끝내 주세요"는 답이다` (Review Focus 1).
  - `질문이 questionCap에 닿으면 capPending이고 다음 질문을 만들지 않는다`, `continueAfterCap은 상한을 30 늘리고 다음 줄기를 연다` (Review Focus 5).
  - `replace로 시작하면 하던 면접은 end.by replaced로 끝나고 새 면접이 진행 중이다`.
  - `topicMap이 없는 진행 중 면접에 answer는 legacy_interview, finish는 된다`.
  - `config: questionLimit가 있어도 오류가 없고 questionCap 기본 30` (`config.test.mjs`).
  - `store: thread 필드와 judge.json을 읽고 쓴다` (`store.test.mjs`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — 위 Interfaces. `nextQuestion`은 두 갈래가 된다: `openThread(id, session, turns, areaId, direction)`과 `followUp(id, session, turns, followKind)`. 꼬리질문의 면접관: `defect`면 지금처럼 `pickNext`가 고른 사람, `deepen`이면 여는 질문을 한 사람.
- [ ] **Step 4: Run** — 전체 PASS.
- [ ] **Step 5: Commit** — `feat: 줄기 단위로 묻고 근거를 확인해 스스로 끝낸다`

### Task 7: 엔진 명령과 진행자 규칙 (설계 5.7, 5.8, 5.11)

**Files:**
- Modify: `.../scripts/cli.mjs`, `.../lib/render.mjs`(`sayQuestion`), `.../SKILL.md`
- Test: `plugin/test/cli.test.mjs`, `plugin/test/leak.test.mjs`, `plugin/test/docs.test.mjs`

**Interfaces:**
- Consumes: Task 6의 `start({ replace })`, `continueAfterCap`, `finish(id, by)`, `view`의 `capPending`·`end`, `EngineError('legacy_interview')`.
- Produces (엔진 출력 `kind`):
  - `confirm_replace` — 진행 중 면접이 있을 때의 `start`. `ok: true`, `say`는 Global Constraints의 문장, `next`: `사용자가 그렇다고 하면 start --topic '<주제>' --replace를 실행하고, 아니라고 하면 resume을 실행한다. 사용자의 이 대답은 면접의 답이 아니다.`
  - `cap` — `capPending`일 때의 `answer`·`resume`. `say`는 안전장치 문장, `next`: `사용자가 '계속'이라고 하면 continue를 실행하고, 그 밖의 말이면 finish를 실행한다. 사용자의 이 대답은 면접의 답이 아니다.`
  - 면접이 끝나는 모든 명령(`answer`, `finish`, Claude의 끝, 안전장치 뒤 `finish`)은 같은 명령 안에서 복기를 돌리고 `review_ready` 또는 `review_partial`을 낸다. `say` 맨 앞에 마무리 문장(사용자가 끝내면 지금의 `CLOSING_TEXT`, Claude가 끝내면 Global Constraints의 문장)을 붙인다. `replaced`로 끝난 면접은 복기하지 않는다.
  - 첫 질문의 `say` 맨 앞 줄에 시작 안내 문장, 빈 줄, 그다음 질문 머리.
  - `legacy_interview` 오류 코드와 `say`.
  - 명령 `continue`, `start`의 `--replace`.
- `SKILL.md`: 명령 표에 `계속`(→ `continue`)을 더하지 않는다(`cap`의 `next`가 안내한다). "그 밖의 경우"에 `confirm_replace`, `cap`, 끝나면 복기가 같은 명령에서 나온다는 것을 더한다. "끝"은 엔진이 가르므로 진행자 규칙("질문이 열려 있는 동안의 메시지는 모두 답")은 그대로다.

- [ ] **Step 1: Write the failing tests**
  - `cli: 진행 중 면접이 있으면 start는 confirm_replace`, `--replace면 새 면접이 시작된다`.
  - `cli: 첫 질문 say의 첫 줄이 시작 안내이고 질문 머리에 분모가 없다` → `/질문 1 · .+ 면접관/`, `/\/6/` 없음.
  - `cli: 답이 "끝"이면 review_ready이고 say가 마무리 문장으로 시작한다`.
  - `cli: Claude가 끝내면 say가 "이 주제로 준비한 면접은 여기까지입니다."로 시작하고 review.md가 생긴다`.
  - `cli: 상한에 닿으면 cap, resume도 cap, continue면 question` (Review Focus 5), `cap 뒤 finish면 review_ready`.
  - `cli: 예전 면접에 answer는 legacy_interview`.
  - `leak: 주제 지도, 점수, 신호, 판정(evidence, candidates, note, direction)에 표식을 심고 면접이 끝나기 전 모든 출력에 없다` (설계 E4).
  - `docs: SKILL.md가 confirm_replace와 cap을 말한다`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — 위 Interfaces.
- [ ] **Step 4: Run** — 전체 PASS.
- [ ] **Step 5: Commit** — `feat: 끝내기·안전장치·대체 시작의 엔진 출력과 진행자 규칙`

### Task 8: 복기 — 끝낸 까닭, 영역 표, 점수 재검사 (설계 5.9, 5.10의 2·3)

**Files:**
- Modify: `.../lib/app/interview/calls/review.call.mjs`, `.../lib/app/review/review.view.mjs`, `.../lib/review.mjs`, `.../lib/render.mjs`
- Test: `plugin/test/review.test.mjs`, `plugin/test/render.test.mjs`, `plugin/test/app/interview/calls/review.call.test.mjs`

**Interfaces:**
- Consumes: 턴의 `analysis.score`·`signals`, `thread`, `judge.json`, 세션의 `topicMap`·`end`, Task 3의 `threadsOf`·`threadScore`·`checkJudgment`.
- Produces:
  - `REVIEW_SCHEMA.properties.scoreCheck: { score: <SCORES> | null, note: string }`(required). 복기 프롬프트에 점수 정의(Task 2와 같은 문장)와 "면접 중 점수가 맞는지 다시 보고, 다르면 바로잡은 점수와 까닭"을 싣는다.
  - `toReviewView`의 새 필드: `end` (`{ by, decision, note, evidence, candidates, recheckFailed: string[] }` 또는 예전 면접이면 `null`), `areas` (`[{ name, core, asked, score, reviewedScore, signals }]`), 질문마다 `score`, `reviewedScore`, `signals`.
  - `recheckFailed`: 끝낸 판정이 `enough`·`settled`일 때, 줄기 점수를 바로잡은 점수로 바꿔 `checkJudgment`를 다시 돌려 어긋난 기준. 렌더는 `재검사 점수로는 조건을 채우지 못함: <기준 이름들>`을 한 줄 단다.
  - 렌더 순서: `# 복기` → `## 끝낸 까닭` → `## 영역별` → `## 가정별 결과`(지금) → 질문별 절(점수·신호 더함) → 호출 기록 → 답 뒤 대기. 예전 면접(`topicMap` 없음)은 앞의 두 절과 점수 줄을 빼고 지금처럼 그린다.
  - 끝낸 까닭의 문장: `by`별 — 사용자 `사용자가 끝냄`, `claude` + 판정별 `볼 만큼 봤다` / `더 물을 게 없다` / `판단이 섰다`, `cap` `질문 상한에서 끝냄`, `replaced` `새 면접을 시작하며 끝냄`.

- [ ] **Step 1: Write the failing tests**
  - `복기 스키마가 scoreCheck를 요구한다`.
  - `렌더: 끝낸 까닭에 판정, 기준별 근거 줄기, note가 나온다`, `exhausted면 후보 셋과 까닭이 나온다`.
  - `렌더: 영역별 표에 묻지 않은 영역도 나온다`.
  - `렌더: 바로잡은 점수로 enough 조건이 무너지면 그 줄이 나온다`.
  - `렌더: topicMap 없는 예전 면접은 지금과 같은 절만 나온다` → 끝낸 까닭·영역별 절 없음.
  - `복기: replaced로 끝난 면접을 나중에 복기하면 끝낸 까닭이 "새 면접을 시작하며 끝냄"`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — 위 Interfaces.
- [ ] **Step 4: Run** — 전체 PASS.
- [ ] **Step 5: Commit** — `feat: 복기에 끝낸 까닭, 영역별 점수, 점수 재검사를 보인다`

### Task 9: 문서와 마무리

**Files:**
- Modify: `README.md`, `plugin/README.md`, `docs/skill-review.md`
- Test: `plugin/test/docs.test.mjs`

- [ ] **Step 1: Write the failing test** — `docs: README가 질문 6개를 말하지 않고 '끝'과 끝내기 판정을 말한다` → 두 README에 `질문 6개`, `questionLimit`가 없고, `'끝'`, `볼 만큼 봤다`, `questionCap`이 있다.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Write** — 두 README의 "시작하기", "쓰는 법", "한 판은 이렇게 돈다", "호출과 한도", "내 것으로 만들기"(설정 표)를 새 동작으로 고친다. 호출 수는 "질문마다 5~6회, 줄기가 닫힐 때마다 판정 1회, 시작할 때 주제 지도 1회"로 쓰고 실제로 잰 값은 새로 재기 전까지 "아직 재지 않음"으로 둔다. `docs/skill-review.md`에 10장 "넓게 묻고 스스로 끝내기"를 열어 만든 것, 확인한 범위(가짜 실행기), 실제로 확인하지 않은 것을 적는다.
- [ ] **Step 4: Run** — 전체 PASS.
- [ ] **Step 5: Commit** — `docs: 넓게 묻고 스스로 끝내는 면접의 안내와 기록`

## 체크포인트 (사용자에게 묻고 한다)

- 실제 한 판: 사용자가 새 세션에서 `/pressure-interview <주제>`. 볼 것: 핵심 영역을 다 도는가, 여는 질문이 가정 변경이고 뻔하지 않은가(E5), 끝낸 까닭이 납득되는가, 전제 모름 닫힘이 얼마나 잦은가(설계 5.10의 1), 줄기당 호출과 대기.
- `main` 병합과 GitHub push는 그때마다 묻는다.

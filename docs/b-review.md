# 체크포인트 B 검토 기록

- 작성: 2026-11-17
- 대상: 계획 2(`docs/plans/2026-11-17-interview-app.md`)의 B부(Task 10~13)와 체크포인트 B
- 코드: 브랜치 `feat/interview-app`, HEAD `644d3dc`

표기: **[결정]** 은 사용자가 정한 것, **[제안]** 과 "관찰"은 Claude의 것이다.

## 1. 상태

**체크포인트 B의 실제 실행 전이다.** B부의 구현과 전체 브랜치 최종 검토, 그 수정까지 끝났다. 실제 API로 면접 한 판과 복기를 돌리는 일은 유료라 사용자 승인을 기다린다. 복기 재검사 호출과 기억은 실제 모델로 아직 한 번도 돌리지 않았다.

지금까지 받은 [결정] (2026-11-18):

- **[결정]** 호출·비용 줄이기는 1번부터 한다. 사용자 원문: "1부터 시작. 단, 여태까지 작업한 모든 내용을 인수인계하는 프롬프트부터 생성해라." 1번은 Claude가 제시한 선택지 가운데 프롬프트 캐싱과, 흘림 검사·전제 검사의 동시 실행이다. 호출 수는 그대로 두고 품질을 건드리지 않는 변경이다. 호출 수 자체를 줄이는 방법(정답지 검증을 빼거나 복기 때로 미루기, 답 분석과 질문 생성을 한 호출로 합치기)은 고르지 않았다.
- 복기를 실제 모델로 돌리는 것은 아직 승인받지 않았다. 새 면접 없이, 재측정 때 끝낸 면접(`29d5cad4-689d-42e0-b7b9-e48367fd0cef`)의 복기만 만들면 된다는 것까지 사용자에게 알렸다.
- 세션을 넘긴다. 인수인계 문서는 [`docs/handoff-2026-11-18.md`](handoff-2026-11-18.md)다.

## 2. B부에서 만든 것

| 태스크 | 내용 | 커밋 |
|---|---|---|
| Task 10 | 복기 재검사 호출(`TurnService.reviewTurn`, `TurnReview`), 호출 역할 `review`(기본 effort high) | `e917266`, `3a37695` |
| Task 11 | 가정별 기억(`src/memory`): 접는 규칙, 다시 낼 가정 고르기, 세션 맞추기. 질문 프롬프트의 저장 매체 문장 삭제 | `14880e4` |
| Task 12 | 복기 서비스와 HTTP API, 다시 연습할 주제, 추이(`src/review`) | `21dd8f5`, `2a097fc` |
| Task 13 | 복기 화면과 추이 화면 | `656c89a`, `ca896dc` |
| 최종 검토 수정 | 아래 4장의 아홉 가지 | `ed2ef8f` |
| README | 띄우는 순서, 과금 안내, 테스트 명령 | `644d3dc` |

## 3. 확인한 범위

- 이번 실행(`ed2ef8f`의 내용): 단위 테스트 232개, e2e 92개(임시 PostgreSQL 컨테이너, 가짜 모델 응답), 프런트 테스트 23개와 빌드, typecheck, lint 통과.
- 가짜 응답 앱(`npm run start:fake`, 과금 없음)과 내장 브라우저로 본 것(`656c89a`, `ca896dc`): 6문항 면접을 끝낸 뒤 "복기 만들기" → 카드 6장(질문과 면접관, 내 답, 답 시작 시간, 질문 의도, 나온 까닭, 의도를 향했는가, 판정 재검사, 바뀐 가정, 정답지, 예상 표시, 가정 결과 고치기). 예상 표시와 결과 고치기가 저장되고 새로 불러와도 남는다. 고치면 같은 화면의 추이 표가 바로 바뀐다. 진행 중인 면접의 복기 주소로 들어가면 "아직 끝나지 않은 면접입니다" 문장만 보인다. 375px 폭에서 가로 스크롤이 없다.
- 브라우저에서 보지 못한 것: 진행 표시 "(n/6)"가 바뀌는 모습(가짜 응답이 즉시 끝난다), 되묻기·덧붙이는 질문·흘림 표시가 있는 카드, 실패 뒤 "다시 만들기".
- 실제 모델로 확인하지 않은 것: 복기 재검사의 판정, 가정이 같은지 가르는 판단(`sameAs`), 기억이 다음 면접의 질문에 미치는 영향, 복기 호출의 출력 스키마(`sameAs`가 문자열 또는 null). 스키마는 API 참조 문서에서 지원된다는 것만 확인했다.

## 4. 최종 검토

브랜치 전체(약 12,000줄)를 영역 넷(엔진, 세션·HTTP, 복기·기억, 화면)으로 나눠 검토자 넷이 읽었고, 중요한 지적은 다른 검증자가 코드로 반박을 시도했다. 정적 검토다.

- Critical 0, Important 2(둘 다 확인됨), Minor 9. 태스크별 검토에서 미뤄 둔 사소한 지적은 모두 "나중에 해도 됨"으로 분류됐다.
- 고친 것(`ed2ef8f`, 재검토에서 아홉 가지 모두 해결로 확인):
  1. 면접 시작 요청이 도는 동안 "이어 하기"나 "복기 보기"로 다른 화면에 가면 시작 응답이 올 때 새 면접 화면으로 끌려오던 것(Important).
  2. 복기가 가정 결과를 "해당 없음"으로 준 턴에서 사용자가 결과를 직접 고쳐도 기억에 들어가지 않던 것(Important).
  3. 이미 말한 기술을 표기만 다르게("redis") 모른다고 한 기술로 잡을 수 있던 것.
  4. 전제가 틀렸다는데 무엇이 틀렸는지 없을 때 같은 입력으로 질문을 다시 만들던 것.
  5. 검증이 같은 목록을 다시 내도 "정답지 수정됨"이 되던 것.
  6. 사용량 행이 0개가 될 수 있던 것.
  7. 면접을 시작할 때 모델과 상관없는 실패도 "모델 호출 실패"로 나가던 것.
  8. e2e의 기다림 상한(1초 → 5초).
  9. 추이를 다시 읽을 때 예전 오류 문장과 늦게 온 응답이 남던 것.
- 고치지 않고 둔 것:
  - 되묻기 프롬프트가 질문용 규칙 줄을 그대로 싣고, 다시 만들 때의 피드백 문구가 "질문"을 가리킨다. 프롬프트 변경이라 실제 모델 확인 없이 건드리지 않았다. 두 번의 유료 실행에서 되묻기 응답은 범위와 조건만 말했다.
  - 답을 처리하는 동안 새로 불러오면 "다시 시도" 버튼이 보인다. 누르면 안내 문장만 나오고 모델 호출은 겹치지 않는다.
  - 재검토가 새로 짚은 사소한 것 하나: "정답지 수정됨"을 값 비교로 정하는데, 대안 항목의 키 순서만 달라도 수정으로 센다.

## 5. 사용자가 정할 것 ([결정] 대기)

1. 답 뒤 대기 약 24초(`docs/a-review.md` 8장)가 견딜 만한가. 질문 생성·검증의 effort를 medium으로 둘 것인가.
2. 복기는 "이 답에서 나온 질문"을 맞는 지적 / 오판 / 의도된 확신 시험 셋으로 가른다. 답이 맞아 더 깊이 물은 질문(상향 심화)이나 넘어간 질문은 셋 중 어디에도 꼭 맞지 않는다. 지금은 모델이 셋 중 하나를 고른다. [제안] 체크포인트 B의 실제 결과를 보고 정한다.
3. 질문 프롬프트의 "저장 매체를 바꾸는 가정은 내지 않는다" 문장을 계획대로 지웠다(D8). 기억이 비어 있는 지금은 사용자가 실제 면접에서 겪은 저장 매체 가정을 막는 것이 없다. [제안] 그 가정을 기억에 한 건 미리 넣는다. 넣을 문장과 결과는 사용자가 정한다.
4. `docs/a-review.md` 5장의 나머지 항목(질문 수 6, 안내 문구, 되묻기 프롬프트의 두 문장 등)과 8장의 눈에 띈 점(질문 첫마디 "한번 반박해 보겠습니다").
5. 체크포인트 B에서 볼 것(계획): 재검사가 맞는가(오판을 오판이라고 하는가), 가정별 결과가 납득되는가, 정답지와 복기에 틀린 내용이 없는가, 다음 면접에서 잘 답한 가정이 다시 나오지 않는가(두 번째 판이 필요하다).

이미 Claude가 설계 쪽으로 정해 반영한 것 하나: 복기가 "해당 없음"으로 준 가정 결과를 사용자가 직접 고치면 기억에 넣는다(4장의 2번). 설계 8장의 "사용자가 복기에서 판정을 고칠 수 있게 한다"를 근거로 했다. 다르게 정하면 조건 한 줄로 되돌린다.

## 6. Claude가 정한 것 ([제안])

계획 2를 실행하면서 Claude가 사용자 대신 정한 것 전부다. 작업 원장에 적은 순서대로 옮겼다. 각 줄은 "정한 것 — 까닭 — 틀렸을 때 드는 것"의 꼴이다. 틀린 것이 있으면 그 줄만 되돌리면 된다.

- Ruling: 별도 worktree를 만들지 않는다 — 사용자가 브랜치 방식을 골랐고 이 저장소에 다른 진행 중 작업이 없다 — 틀리면 브랜치를 worktree로 옮긴다.
- Ruling: 태스크마다 Workflow 하나(구현자 → 검토자, 차례로)로 돌린다. 워크플로 에이전트는 재개할 수 없으므로 수정 라운드는 새 수정 담당에게 brief·보고서·지적 목록을 준다 — 세션의 Ultracode 설정과 사용량 한도(한 번에 하나) — 수정 담당이 맥락을 다시 읽는 비용.
- Ruling: 검토 묶음은 검토자가 `git diff BASE..HEAD`로 직접 만든다(package-lock.json 본문 제외) — 워크플로 스크립트는 셸을 못 돌린다 — 검토자 토큰이 조금 더 든다.
- Ruling: 모델 배정 — 구현자: Task 1·2·3·6·8·9·13 sonnet, Task 4·5·7·10·11·12 opus(프롬프트, 동시성, 기억 규칙). 검토자: Task 6 sonnet, 나머지 opus. 최종 전체 검토는 opus(계획 1과 같은 이유: 사용량 한도) — 틀리면 더 강한 모델이 잡았을 지적을 놓친다.
- PF1 Task 1의 가짜 클라이언트 기본 응답이 "Task 10의 TurnReview 모양"을 가리키는데 Task 1 구현자는 Task 10을 못 본다. Ruling: Task 1 발송에 review 기본 응답을 글자로 준다 `{ intent: { aimed: true, note: '' }, defects: [], reactions: [], assumption: { result: 'none', note: '', sameAs: null }, keyProblems: [] }` — 계획 Task 10의 타입 그대로 — 틀리면 Task 10에서 한 줄 고침.
- PF3 Task 9 Step 5와 Task 13 Step 4는 브라우저 확인을 요구하는데 서브에이전트에는 브라우저 도구가 없을 수 있다. Ruling: 구현자는 `start:fake`를 띄워 HTTP로 확인한다(정적 파일 200, API 흐름을 요청으로 끝까지). 브라우저 확인(375px, 콘솔 오류, 새로고침)은 태스크 검토 뒤 컨트롤러가 내장 브라우저로 한다 — 화면 버그가 유료 실행에서야 드러나는 것을 막는다 — 컨트롤러 맥락을 조금 쓴다.
- Task 3: Ruling: 구현자 우려(iterations가 비어 있지 않은데 message·fallback_message 항목이 없으면 0줄) — 최종 수정 때 "항목에서 한 줄도 못 만들면 최상위 usage로 한 줄"로 고친다. 지금 호출은 compaction·advisor를 쓰지 않아 일어나지 않는다 — 계획의 규칙이 그 경우를 빠뜨렸다 — 그 전까지 그런 응답의 사용량이 빠진다.
- Task 4: Ruling: F1 — 덧붙이기 줄을 `이번 질문:` 절의 첫 줄로 옮기고 "이 질문이 반응하는 답변은 바로 앞 답변이 아니라 그 앞의 답변(대화 목록의 끝에서 두 번째)이다"로 바꾼다(발송 메모 2 대체) — 덧붙이기는 A부 실제 한 판에서 쓰이고 문장이 어긋나면 엉뚱한 답변에 반응한다 — 틀리면 프롬프트 한 줄.
- Task 4: Ruling: F2 — addOn일 때만 반응 의도 줄과 결함 줄을 "그 앞의 답변"으로 쓰고, 시스템 프롬프트의 "직전 답변" 문장 셋은 그대로 둔 채 "덧붙이는 질문이면 직전 답변은 user 메시지가 가리키는 그 앞의 답변을 뜻한다"는 두 문장을 더한다 — 기존 문장과 계획 1 테스트를 건드리지 않는다 — 시스템 프롬프트가 두 문장 길어진다.
- Ruling(Task 7): 테스트가 백그라운드 사후 검증이 끝나기를 기다릴 수 있게 InterviewService에 `settle(): Promise<void>`(진행 중인 사후 검증을 모두 기다림)를 둔다 — 계획의 e2e("사후 검증이 정답지를 고치면…", "백그라운드 사후 검증이 끝난 뒤 답을 저장해도…")가 시점을 맞출 방법이 없다 — 테스트용 메서드 하나.
- Ruling(Task 7): 테스트 앱은 Nest 로거를 끈다(test/support/test-app.ts에 logger: false) — 실패 경로 테스트가 서버 로그를 찍어 테스트 출력이 지저분해진다 — 테스트에서 서버 로그를 볼 수 없다.
- Ruling(Task 8): Nest의 HttpException(잘못된 JSON 본문, 없는 경로 등)은 상태 코드는 그대로, 본문은 404면 { error: 'NOT_FOUND' }, 그 밖에는 { error: 'HTTP_ERROR' } — 계획은 "상태 코드 그대로"만 정했다 — 틀리면 필터 한 줄.
- Task 8: Ruling: I1 — 상한을 2147483647로 둔다 — 계획이 상한을 적지 않았고 컬럼이 integer다 — 틀릴 일 없음(약 24.8일).
- Ruling(Task 9): scripts/run-fake-app.ts는 스크립트 안에서만 다는 경로 GET /__fake/stop을 둔다(앱을 닫고 임시 DB를 지운 뒤 종료) — Windows에서 프로세스를 강제로 죽이면 정리 코드가 돌지 않아 e2e 컨테이너가 남는다. 구현자와 컨트롤러가 자동으로 끌 방법이 필요하다 — 개발용 스크립트에만 있는 경로 하나.
- Ruling(Task 9): 임시 DB를 띄우고 내리는 코드는 scripts/run-e2e.ts와 run-fake-app.ts가 함께 쓰도록 scripts/e2e-db.ts로 뽑는다(run-e2e.ts의 동작은 바꾸지 않는다) — 같은 논리 블록의 복사를 피한다 — Task 1의 파일을 한 번 더 고친다.
- Ruling(Task A1): "한 번에 최대 둘"은 프롬프트 규칙으로만 반영하고 코드로 물음 수를 세지 않는다 — 물음표·어미 세기는 부정확하고 재생성이 대기를 더 늘린다 — 모델이 안 지키면 긴 질문이 그대로 나간다(체크포인트에서 사람이 본다).
- Ruling(Task A1): REQUIRED_RULES의 "질문은 한 번에 하나만 한다. 질문 의도는 말하지 않는다." 줄을 둘로 나누고 앞 줄을 "한 질문에서 묻는 것은 하나다. 꼭 이어서 물어야 할 때만 둘까지 묻고, 셋 이상은 묻지 않는다."로 바꾼다 — 기존 문장이 있었는데도 모델이 한 턴에 네댓 가지를 물었다(턴 하나로 읽음). 사용자 결정이 계획 1의 문장보다 우선한다 — 계획 1의 REQUIRED_RULES가 11줄에서 12줄이 된다.
- Task A1: Ruling: 검토자 Minor 1(이유 문단이 '반응 의도가 주어지면…' 소개 문단과 B1~B11 목록 사이에 끼어 둘을 갈라놓음)은 발송 메모 3이 자리를 잘못 정한 것이다. 문단 하나를 목록과 반응 설명 뒤('## 가정 변경 질문' 앞)로 옮기는 변경이라 컨트롤러가 직접 고쳤다(문장은 그대로, 위치만) — 다음 유료 실행 전에 프롬프트 구조를 바로잡는다 — 틀리면 문단 위치 하나.
- Ruling: "effort는 미디움"의 범위를 question·verify 두 역할로 읽는다(a-review 6장의 D가 말한 범위). 새로 나뉘는 정답지 호출은 question 역할, 전제 검사는 verify 역할의 설정을 쓴다. analyze(medium)·leak(low)는 그대로. B부의 review 역할은 계획 P10대로 high — 사용자가 D 항목을 가리켜 말한 맥락 — 틀리면 설정 기본값 한 줄. 사용자에게 해석을 알림(docs/a-review.md 1장).
- Ruling(Task A2): 엔진과 세션을 한 태스크로 묶는다 — 엔진만 먼저 바꾸면 세션의 e2e를 중간 상태에 맞춰 고쳤다가 다시 고쳐야 한다 — 태스크가 크다(Task 7 수준).
- Ruling(Task A2): TurnService.prepareQuestion은 남긴다(prepareDraft + completeQuestion의 합성) — R1 실행기가 쓴다 — 실행기와 리포트의 타입·표시를 함께 고쳐야 한다.
- Ruling(Task A2): 검증 출력의 "고친 부분만"은 필수 필드만 쓰는 스키마로 한다(lists 배열과 alternatives { changed, items }). 선택 필드·null은 구조화 출력에서 되는지 확인하지 않았으므로 쓰지 않는다 — 추측 금지 — 스키마가 조금 장황하다.
- Ruling(Task A2, 앞의 Ruling을 바꿈): TurnService.prepareQuestion과 PreparedQuestion을 없앤다. R1 실행기는 prepareDraft → save → completeQuestion을 직접 부른다 — 합성 함수 안에서 정답지·검증이 실패하면 돈을 내고 만든 초안이 결과에 남지 않는다(검토 8) — R1Step·리포트의 모양이 바뀐다.
- Ruling(Task A2): completeQuestion의 입력은 AnswerKeyInput(주제·면접관·반응 의도·결함·addOn·대화·초안)이고 세션은 턴 행에서 함수 하나로 만든다 — 정답지 호출은 질문 쓰기 지시(userMentioned·avoidTechs·memory·feedback·targetAxis)를 쓰지 않고, 그 값들은 턴에 저장돼 있어 재기동 뒤에도 같게 만들 수 있다(검토 5·9) — 틀리면 입력 필드 추가.
- Ruling(Task A2): REQUIRED_RULES의 마지막 줄('숨은 정답지는 정확해야 한다…')을 빼서 정답지 프롬프트로 옮긴다(REQUIRED_RULES 12줄 → 11줄) — 질문·되묻기 호출이 정답지를 쓰지 않게 되어 그 줄이 쓰임 없이 남는다. 규칙의 효력은 정답지를 쓰는 호출에 있어야 한다(검토 4) — 계획 1의 문장 목록과 달라진다.
- Ruling(Task A2): answerKeyCorrected는 검증 응답의 corrections가 비어 있지 않은지로 정한다(verifyAnswerKey가 corrected로 돌려줌). problems의 field로 추정하지 않는다(검토 11).
- Ruling(Task A2): 화면에 나간 뒤의 검증에서 premiseOk가 false여도 질문을 다시 만들지 않고 verification에만 남긴다. flags.premise는 보여 주기 전 전제 검사 결과만 뜻한다 — 가정 없는 질문은 지금도 사후에만 전제가 검사됐다(설계 6.2-6) — 가정을 바꾼 질문의 전제를 두 번(짧은 검사 + 사후 검증) 보게 된다.
- Task A2: Ruling: 검토자 Minor 1·2(검증 프롬프트의 '이 검토는 지원자가 답을 쓰는 동안 돈다'는 재기동·실패 경로에서 사실이 아님 / 질문 프롬프트의 '…기술 사실도 정확해야 한다'의 '도'가 받던 문장이 옮겨 감)와 내가 읽다 본 한 곳('…넣지 않는 데만 신경 쓴다' 바로 뒤에 다른 요구가 이어짐)은 문장 세 곳의 한두 어절이라 컨트롤러가 직접 고쳤다(커밋 `fix: 검증·질문 프롬프트 문장을 바뀐 흐름에 맞춘다`) — 다음 유료 실행 전에 프롬프트를 사실에 맞춘다 — 틀리면 문장 세 곳.
- Task A2: Ruling: AnswerKeyInput을 Pick<> 대신 interface로 적은 것은 받아들인다 — types.ts의 `interface Pick`(면접관 고르기)이 유틸리티 Pick을 가린다. 모양은 브리프와 같다 — QuestionInput 필드가 바뀌면 함께 고쳐야 한다.
- Ruling: 재측정이 대기 문제의 해결을 보여 줬으므로(115.2초 → 23.8초) 승인된 계획의 순서대로 B부를 시작한다. a-review 5장의 남은 판정(질문 수, 안내 문구, medium 유지 등)은 프롬프트·설정의 작은 변경이라 B부 코드와 겹치지 않는다 — 사용자가 계획 전체를 승인했고 체크포인트 A에서 나온 수정(A1·A2)은 반영이 끝났다 — 사용자가 대기를 더 줄이라고 하면 Task 10 뒤에 끼워 넣는다. 사용자에게 알림.
- Task 10: Ruling(cannot verify): sameAs의 `anyOf: [{type:'string'},{type:'null'}]`는 그대로 둔다 — claude-api 스킬의 참조 문서(shared/tool-use-concepts.md "JSON Schema Limitations")가 구조화 출력에서 기본 타입 null과 anyOf를 지원한다고 적는다(문서 확인, 실제 호출은 아님) — 틀리면 체크포인트 B의 첫 복기 호출이 400으로 실패한다. 그때는 문자열 하나로 바꾸고 빈 문자열을 "없음"으로 읽는다(reviewTurn이 이미 모르는 key를 null로 바꾼다).
- Task 10: Ruling: 검토자 Minor 1(같은 index가 두 번 오면 판정이 둘 붙음)은 컨트롤러가 직접 고쳤다(3a37695, 처음 것만 남김 + 테스트 1개. 단위 207개 통과) — Task 12·13이 index로 결함과 질문을 찾는다 — 필터 한 줄.
- Task 10: Ruling: 검토자 Minor 2(복기 프롬프트의 "지원자가 말하지 않은 기술의 이름을 써도 된다")는 둔다 — 설계 7장이 복기에서는 금지된 대안 기술도 공개한다고 정했고, 브리프의 "숨길 것이 없다"와 같은 뜻이다.
- Task 11: Ruling(브리프가 정하지 않은 것 7건): 구현자가 고른 동작을 받아들인다 — ① reissue·expected의 둘째 순서는 lastSeenAt 최신순 ② expected에서 빼는 기준은 상한을 적용한 뒤의 retired·reissue 목록(브리프 글자 그대로) ③ pendingTopics에는 상한 없음 ④ answeredAt 없는 턴은 접을 때 뺌 ⑤ all·knownForAxis는 createdAt, id 순 ⑥ 세션이 없으면 던짐 ⑦ 같은 at이면 turnId가 큰 쪽이 status — 모두 브리프 문장과 어긋나지 않고 상한(30·5·10)은 개인 사용에서 한동안 닿지 않는다(P16) — ②가 틀리면 조건 한 줄.
- Task 12: Ruling: 검토자 Minor 1(start가 오류를 잠금 밖에서 지워, 겹친 updateTurn의 MEMORY_SYNC_FAILED가 끝난 복기에 남을 수 있음)은 컨트롤러가 직접 고친다(errors.delete를 잠금 안 작업의 첫 줄로) — 화면이 '준비됨'과 '기억 반영 실패'를 함께 보여 주는 어긋남을 막는다 — 세 줄 이동. 경합이라 전용 테스트는 두지 않았다(기존 e2e로 회귀 확인).
- Task 12: Ruling(브리프가 정하지 않은 것 9건): 구현자가 고른 보수적 동작을 받아들인다 — 복기 대상이 아닌 턴의 PATCH는 409, 둘 중 하나가 거절되면 아무것도 저장하지 않음, REQUIRED의 field는 'body', 입력을 만들다 난 오류는 API_ERROR, knownAssumptions는 seq가 작은 같은 축 가정 변경 턴 전부, stats의 최근·date는 createdAt, error는 메모리에만, POST의 status는 직후 뷰의 값, getView는 flush 뒤에 사용량을 읽음 — 틀리면 각 한두 줄.
- Task 13: Ruling: 검토자 Minor 4(복기 화면의 추이 표가 표시를 고쳐도 그대로)를 브라우저에서 확인했고(고친 뒤 "표시 없음", 새로 불러오면 "100%") 컨트롤러가 직접 고쳤다(StatsPanel에 version, 만들기·고치기 뒤에 올림. 커밋 `fix: 복기에서 표시를 고치면 추이도 다시 읽는다`). 고친 뒤 브라우저에서 "표시 없음" → "0%"로 바로 바뀌는 것 확인, frontend:verify exit 0.
- Ruling: 최종 검토를 검토자 한 명이 아니라 영역 넷으로 나눈다 — 브랜치 diff가 약 12,000줄이라 한 사람이 한 번에 읽을 수 없다. 동시에 도는 에이전트는 둘로 묶는다(사용량 한도) — 영역 사이에 걸친 문제를 놓칠 수 있다(각 검토자에게 의존하는 쪽을 따라가 보라고 함).
- Ruling(최종 검토): Important 2건과 Minor 7건(F1~F9)을 수정 한 번에 묶는다(task-final-findings.md). 고치지 않는 것: 되묻기 프롬프트의 규칙 줄 정리와 피드백 문구(프롬프트 변경이라 실제 모델 확인 없이 건드리지 않는다. 두 번의 유료 실행에서 되묻기 응답은 문제없었다), 처리 중에 보이는 '다시 시도'(누르면 409 문장만 나오고 호출은 겹치지 않는다. 알려진 한계로 둔다), 미뤄 둔 사소한 지적 전부 — 틀리면 다음 수정에서 다룬다.
- Ruling(최종 검토 F2): 가정을 바꾼 질문에서 복기 결과가 none이어도 사용자가 고친 결과가 있으면 기억에 넣는다 — 설계 8장이 "판정 한 번으로 가정이 은퇴하므로, 사용자가 복기에서 판정을 고칠 수 있게 한다"고 정했고, 고친 값이 말없이 사라지는 것은 그 목적에 어긋난다. 사용자에게 물었던 항목이지만(답 없음) 최종 검토가 결함으로 확인해 설계 쪽으로 고친다 — 틀리면 조건 한 줄을 되돌린다. 사용자에게 알림.
- Ruling(최종 검토 F5): 그 테스트의 altOnly 입력을 `items: [{ name: 'X', traits: 't' }]`로 바꾼다(컨트롤러가 직접) — 테스트가 지키려던 것은 "대안 목록을 바꾸면 corrected"이고, 새 기준에서는 실제로 달라지는 입력이어야 그 뜻이 유지된다. 내 지시의 모순이었다 — 틀리면 테스트 입력 한 줄.

## 7. 미뤄 둔 사소한 지적

태스크별 검토에서 나와 고치지 않고 적어 둔 것이다. 최종 검토는 모두 병합 전에 고치지 않아도 된다고 분류했다. 그 뒤 풀린 것도 섞여 있다(예: 주소의 hash만 바꾸면 반응하지 않던 것은 Task 13에서 풀렸다).

- Task 1: minor (deferred): scripts/run-e2e.ts가 npm_execpath를 docker up 뒤에 검사함(먼저 검사하면 헛되이 컨테이너를 띄우지 않음)
- Task 1: minor (deferred): scripts/run-e2e.ts가 SIGINT/SIGTERM을 처리하지 않아 Ctrl+C 때 e2e 컨테이너가 남을 수 있음
- Task 1: minor (deferred): database.options.ts가 반환 타입 대신 satisfies를 씀(BlueGang과 같은 꼴, 동작 차이 없음)
- Task 1: minor (deferred): e2e 실행 출력에 migration:run의 TypeORM query 로그가 나옴
- Task 2: minor (deferred): test/schema.e2e-spec.ts의 panel·question 픽스처가 `as unknown as` 단언(타입에 맞는 값으로 바꾸면 단언 불필요)
- Task 2: minor (deferred): seq 중복·CHECK 위반 테스트가 rejects.toThrow()만 봄(PostgreSQL 오류 코드 23505·23514로 좁히면 제약 자체를 증명)
- Task 2: minor (deferred): test/support/reset-db.ts의 `if (TABLES.length === 0) return;`이 죽은 코드
- Task 2: minor (deferred): schema.e2e의 verification 리터럴이 Verification 인터페이스와 맞는지 타입으로 확인되지 않음(DeepPartial)
- Task 3: minor (deferred): test/usage.e2e-spec.ts:52 Logger spy를 단언 뒤에만 복원(afterEach로)
- Task 3: minor (deferred): usage-recorder.ts:32 record가 sink를 try 없이 부름(sink가 동기로 던지면 callJson이 실패)
- Task 3: minor (deferred): usageRows에 iterations: [] 경계 테스트 없음
- Task 3: minor (deferred): usage-recorder.spec.ts:31 실제 타이머 5ms/30ms에 기대는 테스트
- Task 4: minor (deferred): turn.service.ts verifyLate 주석의 "설계 6.2의 6단계" — 컨트롤러 확인: 설계 6.2의 6번이 정답지 검증 호출이라 맞다. 조치 없음.
- Task 5: minor (deferred): CLARIFY_SCHEMA·JOB_ROLE_SCHEMA가 as const 없이 넓은 타입(기존 스키마와 같은 꼴, enum은 ROLES 대조 테스트가 지킴)
- Task 6: minor (deferred): interview.config.ts:36 재출제 시간 상한을 Number.MAX_SAFE_INTEGER 비교로 갈라 쓴 오류 문구(우회적, 동작 문제 없음)
- Task 7: minor (deferred): InterviewService.start가 questionLimit 범위를 검사하지 않음(Task 8의 입력 검증과 DB CHECK가 막는다. 서비스 계약에는 범위가 없음)
- Task 7: minor (deferred): nextQuestion에서 pick이 없으면 평범한 Error(정상 흐름에서 닿지 않는 불변식)
- Task 8: minor (deferred): http-error.filter.ts:36 500일 때 스택을 로그에 남기는지 보는 테스트 없음
- Task 8: minor (deferred): interview-input.ts:74 turnId가 문자열이 아닐 때 MUST_BE_STRING이 아니라 MUST_BE_UUID
- Task 9: minor (deferred): scripts/run-fake-app.ts가 SIGINT 처리기를 DB를 띄운 뒤에 걸어, 띄우는 동안 Ctrl+C면 컨테이너가 남을 수 있음
- Task 9: minor (deferred): 앱은 뜰 때만 hash를 읽는다. 같은 문서에서 주소의 hash만 손으로 바꾸면 반응하지 않는다(hashchange를 듣지 않음).
- Task A1: minor (deferred): 되묻기 프롬프트도 REQUIRED_RULES를 그대로 실어 '한 질문에서 묻는 것은 하나다' 줄이 쓰임 없이 들어감
- Task A2: minor (deferred): 개발 DB에 A2 이전 모양의 진행 중 면접이 있으면(answerKey가 이미 있고 verification이 null인 가정 없는 질문) 사후 검증 없이 분석으로 넘어간다. 체크포인트 A의 면접은 끝난 면접이라 해당 없음. DB는 띄우지 않아 행은 확인하지 않음.
- Task 11: minor (deferred): e2e 실행기 출력의 docker compose 경고 "No services to build"(이 태스크가 만든 것이 아니라 실행기에 원래 있던 잡음).
- Task 12: minor (deferred): 데이터가 어긋난 오류(정답지 null, 후속 질문에 반응 의도·결함 없음)가 API_ERROR로 보인다. 사유 코드를 늘릴 때 다룬다.
- Task 13: minor (deferred): 시작 화면에서 최근 면접 읽기와 다시 연습할 주제 읽기가 함께 실패하면 오류 문장이 하나만 보임. 진행을 묻다 네트워크 오류가 나면 자동으로 다시 묻지 않음(새로 불러오면 이어짐). review-screen.tsx 398줄(카드와 화면이 한 파일). 가짜 앱의 review 응답이 프롬프트 글자로 index 범위를 셈(가짜 앱에서만).
- 최종 검토: dispatched (Workflow wf_eeb73d2c-bbf, HEAD ca896dc, merge-base ae4c54c). 영역 넷(engine, session, review-memory, frontend)을 opus 검토자가 둘씩 읽고, critical·important 지적은 영역별 opus 검증자가 반박을 시도한다. 영역별 diff는 final-*.diff. 검토자에게 원장의 "minor (deferred)" 줄을 분류하게 함.
- 최종 검토 결과(opus 검토자 넷 + 검증자 둘, 정적 검토): Critical 0, Important 2(둘 다 검증자가 confirmed), Minor 9. 원장의 "minor (deferred)" 줄은 영역별로 모두 can_wait.

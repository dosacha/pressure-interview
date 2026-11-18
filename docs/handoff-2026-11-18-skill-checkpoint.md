# 인수인계: 압박 면접 스킬의 설치와 실제 확인 (2026-11-18)

이 문서는 다음 세션의 Claude에게 주는 프롬프트다. 앞 세션은 스킬을 다 만들고 검토까지 끝낸 뒤 여기서 넘긴다. 새 세션의 일은 **4장(설치와 점검)** 부터다. 컨텍스트가 차서 넘기는 것이고, 막힌 일은 없다.

표기: **[결정]** 은 사용자가 정한 것, **[제안]** 은 Claude가 정했거나 추천한 것이다. 사용자와의 대화와 문서에서 이 둘을 계속 구분해 적는다.

---

## 1. 무엇을 만들었나

기술 압박 면접을 혼자 연습하는 도구를, 서버 없이 Claude Code 세션 안에서 도는 스킬 `/pressure-interview`로 만들었다. 원래 있던 앱(NestJS + PostgreSQL + 화면 + Anthropic API 키)의 규칙과 프롬프트를 그대로 옮긴 것이다.

- **진행자** = 스킬을 부른 주 세션. `SKILL.md`를 따라 엔진 명령을 돌리고, 엔진이 준 문장(`say`)만 그대로 보여 주고, 사용자의 답을 파일로 넘긴다.
- **엔진** = Node 스크립트 `plugin/skills/pressure-interview/scripts/cli.mjs`. 한 판의 순서와 규칙을 돌리고, 모델이 필요한 곳에서만 `claude -p`를 한 번씩 따로 띄운다(도구 없음, 출력 스키마 강제).
- **숨김** = 질문 의도, 정답지, 결함 판정 등은 사용자가 정한 면접 폴더의 `interviews/<면접>/hidden/`에만 있고 엔진의 출력에는 나오지 않는다.

먼저 읽을 문서(이 순서):

1. `docs/skill-review.md` — 가장 최신 기록. 만든 것, 확인한 범위, Claude가 대신 정한 것 열넷(6장), 미뤄 둔 지적(7장), 실제 확인에서 볼 것(8장)
2. `docs/plans/2026-11-18-pressure-interview-skill.md` — 구현 계획. **끝의 "체크포인트" 절이 지금 할 일의 원문이다**
3. `docs/specs/2026-11-18-pressure-interview-skill-design.md` — 설계(승인됨). 11장이 남은 위험, 12장이 설계 때 잰 값
4. `plugin/README.md` — 사용자용 안내(설치, 명령, 호출 횟수, 권한 창, 설정)
5. `plugin/skills/pressure-interview/SKILL.md` — 진행자의 규칙 전부

## 2. 지금 상태

- **위치**: worktree `C:\Users\dosac\projects\interview-skill`, 브랜치 `feat/pressure-interview-skill`(`main`의 `cdb3ba6`에서 냄). HEAD는 이 문서의 커밋이고, 그 앞의 코드 커밋은 `9e81301`.
- **`main`에 병합하지 않았다. 스킬을 설치하지 않았다. 엔진을 통한 실제 모델 호출은 한 번도 없었다.**
- 마지막으로 직접 돌려 확인한 것(`cf58d33`): `node --test "plugin/test/**/*.test.mjs"` 283개 통과(모델 호출은 모두 가짜 실행기), `node --no-warnings tools/port-app-src.mjs --check` 종료 코드 0.
- 임시 홈으로 `status`, `setup`, `doctor`를 직접 돌려 봤다(모델 호출 없음). `doctor`가 실제 `claude`의 로그인과 버전(2.1.326)을 읽어 "통과"를 냈다.
- 주 checkout `C:\Users\dosac\projects\interview`는 브랜치 `feat/unknown-tech-volunteered`에 있고, 사용자가 띄운 앱 서버(포트 3110)와 개발 DB 컨테이너 `pressure-interview-db`가 떠 있을 수 있다. **건드리지 않는다.**
- 작업 원장(git에 올리지 않음): worktree의 `.superpowers/sdd/2026-11-18-pressure-interview-skill/progress.md`. 태스크별 기록과 판단(Ruling)이 시간순으로 있다. 병합 전까지 지우지 않는다.

### 세션을 여는 법

기억(memory)은 주 폴더 `C:\Users\dosac\projects\interview`의 것이다. 새 세션을 그 폴더에서 열고, 작업은 `EnterWorktree`에 `path: C:\Users\dosac\projects\interview-skill`을 주어 worktree로 옮겨서 한다(앞 세션이 그렇게 했다). worktree로 옮긴 세션에서는:

- git 명령을 루프·파이프·명령 치환 없이 한 줄씩 돌린다. 하니스가 복잡한 git 명령을 거부한다.
- 기억은 `C:\Users\dosac\.claude\projects\C--Users-dosac-projects-interview\memory\`에 절대 경로로 쓴다(세션의 프로젝트 이름이 `…-interview-skill`로 잡혀도 기억은 이쪽이다).

## 3. 사용자가 정한 것

- **[결정]** (2026-11-18, "전부 추천대로") 호출은 스킬의 Node 스크립트가 부르는 `claude -p`. 이름은 `pressure-interview`. 이 저장소의 새 폴더(`plugin/`)에 만들고 개인 스킬로 설치하며 플러그인 구조만 맞춘다. 면접 폴더는 처음 부를 때 묻고 홈의 설정 파일에 적는다. 흘림 검사와 직무 고르기는 sonnet, 나머지는 opus, effort는 앱과 같게. Node, 의존성 없음. 앱의 기억을 스킬로 옮긴다(개발 DB는 읽기만). 앱은 그대로 둔다. 실제 한 판은 Claude가 먼저, 그 뒤 사용자가 직접.
- **[결정]** ("승인, 계획 작성") 설계 승인. ("서브에이전트로 진행") 구현 방식.
- **[결정]** (2026-11-18, 원문: "설치하고 점검을 시작할게. 단, 컨텍스트가 너무 차서 새로운 세션에서 시작할테니 인수인계 프롬프트를 생성해줘") **설치와 점검을 한다.** 곧 4.1과 4.2는 승인된 범위다. 다시 묻지 않는다. 4.3부터는 단계마다 묻는다.
- 앞선 결정(숨김은 파일로 하고 열어 보는 것은 사용자의 선택, 한도 사용은 README에 밝힌다, 복기와 추이는 문서로, 답 시작 시간은 재지 않는다)은 설계 문서에 있다.

## 4. 지금 할 일: 체크포인트

계획 끝의 "체크포인트" 절을 따른다. 아래는 그 절에 앞 세션이 안 것을 더한 것이다.

### 4.0 시작하기 전에

- worktree의 `git status`가 깨끗한지, HEAD가 이 문서의 커밋인지, 테스트 283개가 통과하는지 먼저 본다.
- 포트 3110과 `docker ps`를 확인만 한다.

### 4.1 설치 (승인됨)

`C:\Users\dosac\.claude\skills\pressure-interview`를 worktree의 `plugin\skills\pressure-interview`로 잇는다(Windows의 폴더 연결).

- 먼저 그 자리에 이미 무엇이 있는지 본다. 있으면 멈추고 사용자에게 알린다.
- PowerShell: `New-Item -ItemType Junction -Path "C:\Users\dosac\.claude\skills\pressure-interview" -Target "C:\Users\dosac\projects\interview-skill\plugin\skills\pressure-interview"`
- `C:\Users\dosac\.claude\skills\` 아래의 다른 스킬과 `C:\Users\dosac\.codex` 아래는 건드리지 않는다.
- 스킬은 세션이 시작할 때 읽힌다. 연결을 만든 세션에서는 `/pressure-interview`가 안 보일 수 있다. 사용자가 새 세션에서 쳐 봐야 한다.
- 스킬은 사용자가 불러야만 돈다(`disable-model-invocation: true`). Claude가 Skill 도구로 부를 수 없다.
- `main`에 병합한 뒤에는 연결을 주 checkout 쪽으로 다시 이어야 한다(4.5).

### 4.2 점검 (승인됨, 모델 호출 1회)

**실제 홈의 설정 파일(`~/.pressure-interview/config.json`)을 아직 만들지 않는다.** 그 파일은 사용자가 처음 스킬을 부를 때 면접 폴더를 정하면서 생긴다([결정]). 점검은 시험용 홈으로 한다.

```bash
export PRESSURE_INTERVIEW_HOME="C:/Users/dosac/projects/interview-skill/.superpowers/sdd/2026-11-18-pressure-interview-skill/checkpoint/home"
```

```bash
node "C:/Users/dosac/.claude/skills/pressure-interview/scripts/cli.mjs" setup --data-dir "C:/Users/dosac/projects/interview-skill/.superpowers/sdd/2026-11-18-pressure-interview-skill/checkpoint/data"
```

```bash
node "C:/Users/dosac/.claude/skills/pressure-interview/scripts/cli.mjs" doctor --call
```

- 설치한 경로(연결)를 거쳐 돌리는 것이 연결이 맞는지의 확인이기도 하다.
- `doctor --call`은 직무 고르기 호출을 주제 `Redis`로 한 번 한다(sonnet). 구독 한도를 조금 쓴다. 호출 기록(`calls.jsonl`)에는 남지 않는다.
- `setup`을 먼저 하는 까닭: 실패했을 때의 원래 오류가 시험용 면접 폴더 뿌리의 `errors.log`에 남는다. `doctor`의 실패는 면접 내용이 아니므로 이 세션이 그 파일을 읽어도 된다.
- 볼 것:
  - 호출 시험이 "통과"인가. 이것이 엔진을 통한 첫 실제 모델 호출이다.
  - 걸린 시간(명령 전체). 설계 때 잰 값은 `claude -p` 한 번에 sonnet 4.6초였다.
  - **출력 상한**: 엔진은 호출마다 `CLAUDE_CODE_MAX_OUTPUT_TOKENS=16000`을 준다. 이 값을 준 호출이 정상으로 도는지는 본 적이 없다. 실패하면 이것부터 의심한다(`lib/llm.mjs`의 상수 한 줄).
  - 실패했다면 출력의 코드와 `errors.log`의 원문을 보고, `lib/llm.mjs`의 `classify`가 그 모양을 맞게 가르는지 본다. 한도·거절·스키마 불일치의 실제 결과 모양은 아직 모른다.
- 결과를 사용자에게 알리고(측정값, 통과 여부) 다음 단계를 묻는다.

### 4.3 실제 한 판, Claude가 지원자 (묻고 한다. 구독 한도를 쓴다)

- **시험용 면접 폴더에서 한다.** 이 한 판의 복기가 사용자의 기억에 섞이지 않게 하려는 것이다. 진행자 세션은 실제 홈의 설정을 쓰므로, 이 단계에서는 실제 홈에 `setup --data-dir <시험용 폴더>`를 하게 된다. 사용자에게 그렇게 해도 되는지, 시험용 폴더를 어디에 둘지 묻는다. 끝난 뒤 사용자가 정한 진짜 폴더로 `setup`을 다시 한다(4.6).
- **진행자와 지원자를 나눈다.** 진행자는 스킬이 설치된 새 Claude Code 세션이다. 지원자는 답을 정해 그 세션에 메시지로 보내는 쪽이고 `hidden`을 보지 않는다. 한 세션이 둘을 겸하면 메시지가 답이 되는 길, 권한 창, 진행자가 말을 보태는지를 볼 수 없다. 스킬을 Claude가 부를 수 없으므로 `/pressure-interview <주제>`를 치는 것은 사용자가 해야 할 수 있다. 방법을 사용자와 정한다.
- 기억이 다음 질문에 실리는 것까지 보려면 앱의 기억을 시험용 폴더에 복사해 넣는다. 그 전에 24시간 규칙(마지막 만남에서 24시간이 지나야 다시 낸다)에 걸리지 않는지 코드(`lib/app/memory/memory-rules.mjs`)에서 확인한다. 앞 세션들의 실수가 이것이었다.
- 재고 볼 것(계획의 목록 + `docs/skill-review.md` 8장):
  - 답 뒤 대기: 엔진이 잰 값(`calls.jsonl`의 `type: "wait"` 줄)과, 메시지를 보낸 때부터 질문이 보일 때까지. 앱은 약 25초였다.
  - 호출 수와 토큰(`calls.jsonl`), 사용자가 `/usage`로 본 한도의 앞뒤. 앱의 한 판은 35회 + 복기 6회였다.
  - 권한 창이 뜬 횟수. README의 허용 규칙을 넣었을 때 줄어드는지.
  - 숨길 내용이 대화에 나오지 않았는가. 진행자가 `say`에 말을 보태지 않았는가.
  - 보낸 답과 `review.md`에 저장된 답이 글자까지 같은가.
  - sonnet 직무 고르기가 주제에 맞는 직무를 골랐는가. 흘림 검사가 기술의 역할을 제대로 갈랐는가.
  - 뒤에서 도는 정답지 작업이 실제로 `key.json`을 남기는가. 호출이 시간 상한에 걸렸을 때 프로세스가 남지 않는가.
  - `${CLAUDE_SKILL_DIR}`가 치환됐는가. 안 됐다면 `SKILL.md`가 "Base directory for this skill" 줄의 경로를 쓰게 돼 있다.
  - 터미널 세션에서도 한 번 시작해 `key.json`이 생기는지. PowerShell 도구로 돌렸을 때 한글 출력이 깨지지 않는지.
  - 대화 압축 뒤의 진행을 봤는지 못 봤는지.

### 4.4 기록

`docs/skill-review.md`에 측정값과 관찰을 더하고, 사용자의 판정을 [결정]으로 적는다. `plugin/README.md`의 "호출과 한도" 절을 측정값으로 채운다. 측정값, 계산값, 추정값을 구분한다.

### 4.5 병합 (묻고 한다)

사용자가 정하면 `main`에 병합한다(원격이 없어 push는 없다). 병합한 뒤 4.1의 연결을 주 checkout의 `plugin\skills\pressure-interview`로 다시 잇는다. 주 checkout은 지금 `feat/unknown-tech-volunteered`에 있고 서버가 그 폴더의 코드를 쓰고 있으므로, 그 폴더에서 브랜치를 바꾸는 일은 사용자에게 먼저 묻는다.

### 4.6 기억 옮기기 (묻고 한다. 개발 DB를 읽기만 한다)

사용자가 정한 면접 폴더로 `setup`을 한 뒤 worktree에서 `node tools/import-app-memory.mjs`. 컨테이너 `pressure-interview-db`가 떠 있어야 한다. DB에는 `select` 하나만 보낸다. 이 도구의 본체는 돌려 본 적이 없다(`psql`의 출력이 JSON 한 줄인지, 날짜가 제대로 바뀌는지 본다). 사용자의 첫 판 바로 앞에 한다.

### 4.7 사용자가 직접 한 판

## 5. 답을 기다리는 [제안]

- 계획의 넷: 프롬프트를 옮겨 적지 않고 도구로 옮긴 것, 병합 전에 설치해 시험하는 순서, "기다리는 덧붙임"을 세션 파일이 아니라 턴의 파일에 둔 것, 시스템 프롬프트를 인자로 넘기는 것.
- `docs/skill-review.md` 6장의 열넷. 그 가운데 사용자가 한 번 봐 주면 좋은 것: 진행 중인 면접은 하나만(설계 6.1), 실패하면 알리고 다시 할지 묻는다, 출력 상한 16,000토큰, 시작이 실패했을 때 "같은 주제로 다시 시작"을 안내하게 고친 것(계획의 결함이었다).
- 앱 쪽에 남은 것(스킬과 별개). 앞의 인수인계 문서 `docs/handoff-2026-11-18-skill.md`는 사용자 지시로 2026-11-18에 지웠다(원문은 `git show 9fd4c38:docs/handoff-2026-11-18-skill.md`). 그 3장에 있던 것을 옮긴다:
  - `feat/unknown-tech-volunteered`를 `main`에 병합할지. 사용자가 직접 써 본 뒤에 묻기로 했다. 모델이 `selfUnknownTechs`를 실제로 채우는지는 확인하지 않았다.
  - 답이 없는 [제안]: 주 checkout의 `docs/b-review.md` 5장 6~10번(캐시 수명, 교과형 문단의 자리, 이름 위반 시도의 전제 검사 결과, 넷째 분류의 이름과 범위와 빈틈, 스스로 꺼낸 모름의 범위).
  - 앱에서 실제로 확인하지 못한 것: 잘 답함이 된 가정이 다음 면접에서 빠지는지, 24시간 뒤 기억이 저절로 실리는지, 복기가 틀린 분석을 잡는지.
  - 복기 문장에 내부 이름이 보인다("p1", "defects", "keyPoints", 정답지의 "[4]"). 프롬프트 변경이라 손대지 않았다.
  - 모두 끝나면 앱의 작업 원장 폴더(주 checkout의 `.superpowers/sdd/2026-11-17-interview-app/`)를 지워도 된다.

## 6. 지켜야 할 것

- **한도를 쓰는 실행은 알리고 한다.** 4.1과 4.2는 승인됐다. 그 밖의 실제 모델 호출은 그때마다 묻는다. 서브에이전트에게는 실제 모델 호출을 맡기지 않는다.
- **API 과금이 나가지 않게 한다.** 엔진은 자식 프로세스의 환경에서 `CLAUDE`·`ANTHROPIC`으로 시작하는 변수를 지우고 부르며, 시작할 때 구독 로그인인지 확인한다. 주 checkout의 `.env`에 실제 API 키가 있다. 읽거나 출력하지 않는다. `claude auth status`의 출력에는 계정 정보가 있으니 대화에 그대로 옮기지 않는다.
- **진행자 역할을 할 때는 `hidden` 폴더와 `errors.log`를 읽지 않는다.** 면접이 끝난 뒤의 확인(4.3의 일부)에서는 읽어도 된다.
- **커밋 메시지와 PR 설명에 Claude 표시를 넣지 않는다**(`Co-Authored-By`, `Generated with`).
- **미정 업무 규칙을 만들지 않는다.** 문서가 정하지 않은 것은 가장 보수적인 동작을 고르고, 판단으로 기록해 사용자에게 알린다.
- **숫자를 만들지 않는다.** 검증 범위도 구분한다: 이번 실행 / 저장된 과거 결과 / 가짜 실행기 / 정적 검토 / 실제 `claude`.
- 서브에이전트는 한 번에 하나, 많아야 둘. opus나 sonnet을 쓴다(사용자의 기억: 최상위 모델 다섯을 동시에 돌려 5시간 한도를 7분에 썼다).
- `lib/app/`과 `plugin/test/app/`은 도구가 만든 파일이다. 손으로 고치지 않는다. 프롬프트의 글자를 바꾸지 않는다.
- 미추적 파일을 지우거나 reset·clean을 하지 않는다. 다른 프로젝트의 Docker 자원을 건드리지 않는다. `C:\Users\dosac\.codex` 아래와 `codex/` 브랜치는 Codex의 것이다.
- commit은 작업 브랜치에서 한다. merge, push, 배포는 그때마다 묻는다.
- 사용자는 한국어로 협업하고 원격으로 볼 때가 많다. 마지막 메시지는 그것만 읽어도 되게 쓰고, 정해 줄 것이 있으면 선택지를 글로 적는다. 결과와 근거를 먼저 말한다.

## 7. 환경에서 알아 둘 것

- Windows 11, PowerShell 5.1과 Git Bash. Node 24.22.1. `.gitattributes`가 `eol=lf`다.
- `claude`는 `C:\Users\dosac\.local\bin\claude.exe`(2.1.326), 구독(Max)으로 로그인돼 있다. 셸에 `ANTHROPIC_API_KEY`는 없었다(2026-11-18).
- 데스크톱 앱 세션의 셸에는 `CLAUDE_CODE_*`와 `ANTHROPIC_BASE_URL` 등 30여 개 변수가 있다. 엔진이 지우고 부르므로 따로 할 일은 없다.
- 설계 때 잰 값(각 1회, 실험 스크립트): `claude -p` 한 번에 sonnet 4.6초·opus 6.7초, 호출마다 프로세스를 띄우는 데 1.6~2.4초, 동시 호출 둘이 함께 3.1초, 같은 시스템 프롬프트의 다음 호출은 캐시를 읽음, 떼어 낸 프로세스가 도구 호출이 끝난 뒤에도 살아 결과를 남김. 설계 12장.
- 엔진 명령은 Bash 도구로 돌리고 도구의 시간 제한을 600000ms로 준다(`answer`와 `review`가 2분을 넘을 수 있다).
- 권한 규칙의 꼴(공식 문서에서 확인): `Bash(<명령 앞부분> *)`, `PowerShell(<명령 앞부분> *)`, 파일 쓰기는 `Edit(<경로>)` 규칙이 맡고 `Write(...)` 규칙은 맞지 않는다. Windows 절대 경로는 `//c/Users/...`. 따옴표가 든 명령이 규칙과 어떻게 맞는지, 작업 폴더 밖의 파일에 허용 규칙만으로 충분한지는 문서에 없다.
- 앞 세션이 실행 중에 배운 것: 계획의 마지막 태스크를 뽑는 스크립트가 뒤따르는 절(체크포인트)까지 딸려 뽑는다. 워크플로 에이전트는 웹 문서를 읽지 못하는 경우가 있어 문서 확인은 주 세션이 했다. 실패하는 테스트를 먼저 돌리는 과정에서 저장소 뿌리에 빈 폴더가 생긴 적이 있다(지웠다).

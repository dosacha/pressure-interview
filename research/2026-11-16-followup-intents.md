# 꼬리질문 의도 역추출 초안 (웹 조사)

- 작성: 백그라운드 조사 subagent, 2026-11-16
- 검증 범위: 이번 실행에서 웹 검색과 페이지 열람만 함. 페이지는 요약 도구로 읽어 원문 전체를 대조하지 않음. 메인 세션은 출처를 재확인하지 않음. 실제 면접 기록은 보지 않음. 숫자 없음.
- 예시 꼬리질문: 출처의 질문은 번역해 요약함. 나머지는 조사자가 쓴 예시.
- 설계 결정이 아니라 재료다. 목록 채택 여부는 미정.

**요약:** 질문 의도 15개, 반응 의도 11개. 근거가 가장 단단한 자료는 영어권 시스템 디자인 follow-up 분류 글 [S5], 면접관용 힌트·명확화 가이드 [S11][S12], 공개 스킬 문서 [K1~K4]. 한국어 면접관 1차 글과 실제 꼬리질문 연쇄가 담긴 후기는 거의 없음.

## (a) 질문 의도

| # | 이름 | 한 줄 정의 | 예시 꼬리질문 | 근거 | 표시 |
|---|---|---|---|---|---|
| A1 | 원리 이해(암기 깨기) | 현상에서 원인, 구현까지 내려갈 수 있는지 본다 | "InnoDB는 RR에서 Phantom Read를 왜 막나요?" | S4, S9 | S9 직접 / S4 연쇄에서 추론 |
| A2 | 선택 근거 | 결정이 숙고의 결과인지, 반사적 선택인지 본다 | "Kafka를 고른 이유는? SQS는요?" | S1, S5 | 직접 |
| A3 | 대안 시야 | 다른 방법을 검토했는지 본다 | "스케줄러나 메시지 큐는 검토했나요?" | S1, S10 | 직접 |
| A4 | 트레이드오프·한계 인식 | 단점을 스스로 말하는지 본다 | "그 방식의 단점은요?" | K4, S8 | 직접 |
| A5 | 검증·측정 | 효과를 기준선과 측정으로 입증하는지 본다 | "유실이 실제로 줄었다는 건 어떻게 확인했나요?" | S1, K4, K2 | 직접 |
| A6 | 경험 진위·본인 기여 | 본인이 한 일과 팀이 한 일을 구분하는지 본다 | "그 부분에서 직접 한 건 정확히 뭔가요?" | S9, S10, S3 | 직접 |
| A7 | 개념의 실무 적용 | CS 지식을 상황에 적용할 수 있는지 본다 | "트래픽이 급증하면요?" | S2 | 직접 |
| A8 | 규모 적응 | 배수나 비대칭으로 늘어날 때 병목을 아는지 본다 | "읽기는 그대로인데 쓰기만 크게 늘면요?" | S5, S6 | 직접 |
| A9 | 극단 분포 | 평균이 아니라 꼬리 케이스로 설계하는지 본다 | "팔로워가 극단적으로 많은 한 사용자는요?" | S5 | 직접 |
| A10 | 장애·부분 실패 | 완전 중단뿐 아니라 느림·중복까지 추론하는지 본다 | "캐시 계층이 통째로 사라지면요?" | S5, S16 | 직접 |
| A11 | 요구 변경·진화성 | 초기 결정이 나중의 변경을 비싸게 만드는지 본다 | "단일 한도를 경로·등급별 한도로 바꾸면요?" | S5, S15 | 직접 |
| A12 | 복잡도의 필요성 | 그 복잡도가 꼭 필요한지, 범위를 줄일 수 있는지 본다 | "인프라 예산이 절반이 되면요?" | S5 | 직접 |
| A13 | 운영 경계·미래 부채 | 운영 책임과 설계 부채를 정직하게 보는지 본다 | "새벽 3시에 누가 호출되나요? 후임이 원망할 결정은요?" | S5 | 직접 |
| A14 | 지식 경계 매핑 | 모를 때까지 파고들어 경계가 어디인지 확인한다 | 특정 프로토콜의 세부 동작 질문 | S9 | 직접 |
| A15 | 미지 문제 접근·학습 가능성 | 모르는 영역을 어떻게 추론하는지 본다 | "안 해봤다면 어떻게 접근하겠어요?" | S1b, S2, S12 | 직접 |

## (b) 반응 의도

| # | 이름 | 한 줄 정의 | 예시 | 근거 | 표시 |
|---|---|---|---|---|---|
| B1 | 상향 심화("잘하네, 어디까지?") | 강한 답 뒤에 규모·난이도를 올린다. 경계에 닿을 때까지 간다 | "그럼 그걸 엔진은 어떻게 구현하죠?" | K2, K3, S8, S9 | 직접 / S4 연쇄에서 추론 |
| B2 | 구체화 요구("애매하네") | 모호한 답에 구체적이고 직접적인 질문을 던진다. 모호함 자체를 모르거나 회피하는 신호로 본다 | "'최적화했다'는 구체적으로 뭘요?" | S12, K1, K4 | 직접 |
| B3 | 근거 요구("주장만 있네") | 수치나 기준선이 없는 개선 주장에 측정 방법을 묻는다 | "개선 전 값은 얼마였나요?" | K4, K2 | 직접 |
| B4 | 누락 신호("놓친 건가, 모르는 건가") | 결함이 있다는 것만 알리고 스스로 찾게 한다 | "빠진 케이스는 없을까요?" | S11, K4 | 직접 |
| B5 | 방향 넛지 | 엉뚱한 범위로 가기 전에 방향을 틀어 준다 | "그 방향 말고 다른 쪽은요?" | S11 | 직접 |
| B6 | 반례 재질문("틀렸네") | 고쳐 주는 대신 특정 입력이나 테스트로 다시 묻는다. 마지막 단계에서는 직접 설명하고 회복 속도를 본다 | "다른 테스트 케이스는요?" | S11, S13 | 직접 |
| B7 | 맥락 보충 재질문("질문을 오해했나") | 유도 질문이나 원칙 제시로 "알지만 전달에 실패한 것"인지 가린다 | "X라는 조건이면 어떻게 되죠?" | S12 | 직접 |
| B8 | 확신 시험("맞는데 흔든다") | 맞는 답에도 반박해서 근거로 버티는지 본다 | "정말 그게 맞나요?" | S7, S6, S17 | 직접. 기술면접 근거는 S7 한 곳뿐이고 S17은 비기술 압박면접 글 |
| B9 | 수용성 시험 | 결함을 지적받았을 때 방어하는지, 적응하는지 본다 | "이 설계엔 이런 문제가 있는데요?" | S9 | 직접 |
| B10 | 과장 감지·레벨 재보정 | 서류 주장이 무너지면 기대 레벨을 낮추고, 과장된 항목을 집중해서 판다 | (이력서 항목 세부 연속 질문) | K2, K3, S1b | 직접 |
| B11 | 전환·정리 | 전문 영역 밖이면 넘어간다. 막힌 문항은 결론으로 이끌고 이동한다 | "좋습니다, 다음으로 가죠" | S12, S11, S1b | 직접 |

## 가정 변경 질문이 바꾸는 축

- **규모:** 배수 증가, 읽기·쓰기 비대칭 증가 [S5], 트래픽 급증 [S9]
- **자원 한도:** 캐시 메모리 제한 [S9]
- **데이터 분포:** 핫 키, 극단 사용자 [S5]
- **장애 양상:** 중단, 느림, 중복 [S5]
- **정확도·일관성 완화:** 요청마다 Redis를 조회하던 구조를 로컬 카운터와 주기 동기화로 바꾸면 전역 정확도를 일부 잃는다 [S15]
- **영속성·전달 보장:** Redis Pub/Sub은 받지 못한 메시지가 유실되고, Kafka는 로그를 보존해 재처리할 수 있다 [S18]. 면접 맥락의 글은 아니어서 비교 축으로만 씀.
- **요구·규제 변경:** GDPR 삭제 요구 [S5], 한도 정책 세분화 [S15]
- **기술 대체:** "SQS가 아니라 왜 Kafka?" [S5]
- **비용:** 예산 절반 [S5]
- **지연 예산·데이터 가용성:** [S6]
- **시간·조직:** 미래 부채, 운영 책임 [S5]

S6에 따르면 높은 레벨 면접에서는 한 라운드에 제약 변경을 2~3개 겹쳐 묻는 일이 많다. "인메모리 PostgreSQL vs Redis"처럼 저장 매체를 바꿔 두 기술의 정체성을 비교하는 질문은 직접 사례를 찾지 못했다.

## 직무별 차이

- **백엔드 시니어 [K2]:** 튜토리얼 지식인지 운영 경험인지를 가르는 게 중심축. Engineer 레벨은 구현과 API를 정확히 쓰는지, Senior 레벨은 트레이드오프·용량 산정·장애 예측을 본다. "what만 있고 why가 없으면" 탈락 신호.
- **SRE/DevOps [K3]:** 실제 장애를 서술할 수 있는지, SLI와 MTTR을 다룰 수 있는지. 장애를 외부 탓으로 돌리면 감점. DevOps는 파이프라인 경계와 시크릿 교체.
- **DB형:** 격리 수준 → MVCC → 엔진 구현으로 내려가는 연쇄, Lost Update 해결로 이어지는 연쇄 [S4, 연쇄에서 추론].
- **아키텍트형:** S5의 정당화·진화·단순화 질문이 해당한다고 봄(조사자 추론).
- **보안형:** 자료 없음.

## 참고 스킬에서 쓸 만한 발상 (데이터로만 열람, 실행 안 함)

- **careerforge [K1]:** 꼬리질문은 최대 3층, 라운드당 최소 2회, 모든 문항에 붙이지는 않음. 트리거는 답변이 모호할 때 / 파고들 만한 지점이 나왔을 때 / 논리에 빈틈이 있을 때. 면접 중 피드백 없음, 점수 분산 강제.
- **techeer hiring-sim [K4]:** 답변 결함 유형마다 꼬리질문을 매핑(모호 → 구체화, why 없음 → why, 트레이드오프 누락 → 단점, 수치 없음 → 측정 방법). 이력서와 답변의 일관성을 평가 항목에 넣음.
- **matt-daily [K2][K3]:** 강한 답에는 상향, 약한 답에는 구체화. 시니어 주장이 무너지면 레벨을 낮춰 재평가. 비관습적이어도 논리적인 답에는 가점.
- **dhruvjainin/absolute:** 저장소 트리에 technical-interviewing이 없었고 raw 경로는 404. 확인 못 함.

## 자료가 빈약하거나 확인하지 못한 부분

- 한국어 면접관 본인 글, 기업 기술블로그의 면접 글을 찾지 못함. 한국어 자료는 대부분 강의 홍보·뉴스레터·Q&A이고, S1·S1b 글쓴이도 면접관 경력을 밝히지 않음.
- 한국어 실제 후기의 꼬리질문 연쇄는 발견하지 못함. 가장 가까운 것은 강의 목차 S4(강사 측 주장).
- wikidocs 면접관용 가이드(434920, 434921)는 403으로 막혀 검색 스니펫만 봄. 근거에서 뺌.
- B8(확신 시험)은 기술면접 1차 근거가 약함.
- (b) 목록은 대부분 가이드·스킬 문서에서 왔고 실제 연쇄로 검증하지 않음.
- 영어 출처 상당수는 면접 준비 사이트 콘텐츠. S5 저자는 면접관 경험이 있다고 스스로 밝힘.
- careerforge의 하위 references 파일(압박 예시, 채점 규칙)은 열지 않음.
- 위험: 한국 실전 면접관의 관행이 이 목록에 충분히 반영되지 않았을 수 있음.

## 출처

- S1 https://maily.so/developerh/posts/8mo5m4vnz9p
- S1b https://maily.so/developerh/posts/knrj1w34rld
- S2 https://www.elancer.co.kr/blog/detail/817
- S3 https://comento.kr/job-questions/모든회사/모든직무/면접관이_계속 꼬리질문을 하는 이유가 뭔가요-640084
- S4 https://www.inflearn.com/course/cs-interview-prepara-1
- S5 https://dev.to/numb_code_07/the-follow-up-questions-that-decide-system-design-interviews-and-how-to-pre-empt-them-32n3
- S6 https://www.educative.io/courses/grokking-the-machine-learning-system-design-interview/handling-follow-up-questions-and-pushback
- S7 https://hellointerview.substack.com/p/how-to-handle-bad-interviewers
- S8 https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction
- S9 https://prachub.com/resources/how-to-handle-follow-up-questions-in-tech-interviews
- S10 https://yardstick.team/how-to-ask-follow-up-questions
- S11 https://www.holloway.com/g/technical-recruiting-hiring/sections/hinting-and-helping-candidates-shine
- S12 https://holloway.com/g/technical-recruiting-hiring/sections/seeking-clarity-in-questions-and-answers
- S13 https://interviewing.io/blog/best-technical-interviews-common
- S15 https://notes.kodekloud.com/docs/System-Design-for-Interview-Prep/Warm-Ups-The-Read-Heavy-Classics/Curveball-Byte-Rate-Limiter/page
- S16 https://maily.so/devpill/posts/e9o02j3ez8w
- S17 https://brunch.co.kr/@ny0303/326
- S18 https://www.inflearn.com/community/questions/1817801/redis와-kafca의-pub-sub-차이
- K1 https://raw.githubusercontent.com/rebecha1227-a11y/careerforge/main/skills/mock-interview/SKILL.md
- K2 https://raw.githubusercontent.com/meirongdev/matt-daily-skills/main/skills/java-senior-interviewer/SKILL.md
- K3 https://raw.githubusercontent.com/meirongdev/matt-daily-skills/main/skills/senior-ops-interviewer/SKILL.md
- K4 https://raw.githubusercontent.com/techeer-sv/career-skills/main/skills/hiring-sim-interview/SKILL.md

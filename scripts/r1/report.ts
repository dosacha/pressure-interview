import type { CallRole, EngineConfig } from '../../src/config/engine.config';
import {
  AXES,
  DEFECT_NAMES,
  QUESTION_INTENTS,
  REACTION_INTENTS,
  ROLES,
  TEMPERAMENTS,
} from '../../src/interview/catalog';
import type {
  Analysis,
  Defect,
  PanelMember,
  Pick,
  PickChoice,
  PreparedQuestion,
  TokenUsage,
  Verification,
} from '../../src/interview/types';

export interface R1Step {
  prepared: PreparedQuestion;
  lateVerification: Verification | null;
}
export interface R1FollowUp {
  answerKind: string;
  answer: string;
  analysis: Analysis;
  pick: Pick | null;
  next: R1Step | null;
}
export interface R1Result {
  scenarioId: string;
  topic: string;
  panel: PanelMember[];
  first: R1Step | null;
  followUps: R1FollowUp[];
  usage: TokenUsage[];
  error: string | null;
}

export function sumUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (a, u) => ({
      input_tokens: a.input_tokens + u.input_tokens,
      output_tokens: a.output_tokens + u.output_tokens,
    }),
    { input_tokens: 0, output_tokens: 0 },
  );
}

const CALL_ROLES: CallRole[] = ['question', 'leak', 'verify', 'analyze'];
const CHECKLIST = [
  '- [ ] 예상 밖인가',
  '- [ ] 정답지가 정확한가',
  '- [ ] 해답을 흘리지 않았나',
  '- [ ] 의도가 질문에 드러나지 않았나',
];

const axisName = (id: string) => AXES.find((a) => a.id === id)?.name ?? id;
const list = (items: string[]) => (items.length > 0 ? items.join(', ') : '(없음)');
const quote = (text: string) => `> ${text.split('\n').join('\n> ')}`;

function memberName(panel: PanelMember[], id: string): string {
  const m = panel.find((p) => p.id === id);
  return m ? `${id} (${ROLES[m.role].name} · ${TEMPERAMENTS[m.temperament]})` : id;
}
function defectLine(d: Defect): string {
  return `${DEFECT_NAMES[d.type]} · 축 ${axisName(d.axis)}${d.note ? ` — ${d.note}` : ''}`;
}
function choiceLine(panel: PanelMember[], c: PickChoice): string {
  return `${memberName(panel, c.interviewerId)}, 반응 의도 ${c.reactionIntent} ${REACTION_INTENTS[c.reactionIntent]}, 맡은 결함: ${defectLine(c.defect)}`;
}

function renderStep(step: R1Step, heading: string): string[] {
  const { question, verification, answerKeyCorrected, flags, attempts } = step.prepared;
  const late = step.lateVerification;
  const lateCorrected = late !== null && late.problems.length > 0;
  const key = lateCorrected ? late.answerKey : question.answerKey;
  const shown = late ?? verification;
  const assumption =
    question.assumption.axis === 'none'
      ? '없음(가정을 바꾸지 않는 질문)'
      : `${axisName(question.assumption.axis)} — ${question.assumption.statement}`;

  const lines = [
    heading,
    '',
    quote(question.text),
    '',
    `- 숨은 질문 의도: ${question.questionIntent} ${QUESTION_INTENTS[question.questionIntent]}`,
    `- 바뀐 가정: ${assumption}`,
    `- flags: leak(흘림이 끝까지 남음) ${flags.leak}, premise(전제 오류가 끝까지 남음) ${flags.premise}`,
    '',
    `**숨은 정답지**${answerKeyCorrected || lateCorrected ? ' (정답지 수정됨, 고친 것을 보여 준다)' : ''}`,
    '',
    `- 사라지는 차이: ${list(key.vanishing)}`,
    `- 남는 차이: ${list(key.remaining)}`,
    `- 대안 기술: ${list(key.alternatives.map((a) => `${a.name} — ${a.traits}`))}`,
    `- 기대하는 답의 핵심: ${list(key.keyPoints)}`,
    '',
    '**검증**',
    '',
  ];
  if (!shown) {
    lines.push('- 검증하지 않았다');
  } else {
    lines.push(
      `- 시점: ${late ? '질문 뒤 검증(가정 없는 질문)' : '질문을 보여 주기 전'}`,
      `- 전제: ${shown.premiseOk ? '맞음' : '틀림'}`,
      ...(shown.problems.length > 0
        ? shown.problems.map((p) => `- 문제 [${p.field}]: ${p.problem}`)
        : ['- 문제: 없음']),
    );
    if (answerKeyCorrected || lateCorrected) lines.push('- 정답지 수정됨');
  }

  const discarded = attempts.slice(0, -1);
  lines.push(
    '',
    '**흘림 검사**',
    '',
    `- 첫 시도의 위반: ${list(attempts[0]?.naming.violations ?? [])}`,
    `- 재생성: ${discarded.length}회`,
  );
  discarded.forEach((a, i) => {
    const reason = !a.naming.ok
      ? `이름 위반(${a.naming.violations.join(', ')})`
      : `전제 오류(${(a.verification?.problems ?? []).map((p) => p.problem).join(' / ')})`;
    lines.push(`- 버려진 시도 ${i + 1}: "${a.question.text}" — 버린 이유: ${reason}`);
  });

  lines.push('', '**검토**', '', ...CHECKLIST, '');
  return lines;
}

function renderFollowUp(panel: PanelMember[], f: R1FollowUp, n: number): string[] {
  const { analysis, pick } = f;
  const lines = [
    `### 후속 ${n} — 지원자 답: ${f.answerKind}`,
    '',
    quote(f.answer),
    '',
    '**분석**',
    '',
    `- 판정: ${analysis.kind === 'clarify' ? '되묻기' : '답'}`,
    ...(analysis.defects.length > 0
      ? analysis.defects.map((d) => `- 결함: ${defectLine(d)}`)
      : ['- 결함: 분석이 돌려준 결함 없음']),
    `- 지원자가 말한 것으로 잡힌 기술: ${list(analysis.mentionedTechs)}`,
    '',
    '**다음 질문자**',
    '',
  ];
  if (pick) {
    lines.push(
      `- 고른 면접관: ${choiceLine(panel, pick)}`,
      `- 덧붙이기(secondary): ${pick.secondary ? choiceLine(panel, pick.secondary) : '없음'}`,
    );
  } else {
    lines.push(
      analysis.kind === 'clarify'
        ? '- 되묻기로 판정돼 질문자를 바꾸지 않았다(pick 없음)'
        : '- 고른 면접관 없음(pick 없음)',
    );
  }
  lines.push('');
  if (f.next) lines.push(...renderStep(f.next, `#### 후속 질문 ${n}`));
  else lines.push('후속 질문을 만들지 않았다.', '');
  return lines;
}

export function renderReport(run: {
  startedAt: string;
  results: R1Result[];
  engine?: EngineConfig;
}): string {
  const { results, engine } = run;
  const total = sumUsage(results.flatMap((r) => r.usage));
  const errors = results.filter((r) => r.error !== null).length;
  const lines = [
    '# R1 시험 결과',
    '',
    `- 시작: ${run.startedAt}`,
    `- 시나리오: ${results.length}개, 오류 ${errors}개`,
    '',
  ];

  if (engine) {
    lines.push('## 모델 설정', '', '| 호출 | 모델 | effort |', '|---|---|---|');
    for (const role of CALL_ROLES) {
      lines.push(`| ${role} | ${engine.models[role]} | ${engine.effort[role]} |`);
    }
    lines.push('');
  }

  lines.push('## 사용량', '', '| 시나리오 | input_tokens | output_tokens |', '|---|---|---|');
  for (const r of results) {
    const u = sumUsage(r.usage);
    lines.push(`| ${r.scenarioId} | ${u.input_tokens} | ${u.output_tokens} |`);
  }
  lines.push(
    `| 전체 | ${total.input_tokens} | ${total.output_tokens} |`,
    '',
    '사용량은 응답을 만든 시도만 센 것이다. 폴백으로 거절된 시도의 토큰은 빠져 있다.',
    '',
  );

  for (const r of results) {
    lines.push(`## 시나리오 ${r.scenarioId} (주제: ${r.topic})`, '');
    if (r.error !== null) lines.push(`오류: ${r.error}`, '');
    lines.push('**패널**', '');
    lines.push(
      ...(r.panel.length > 0
        ? r.panel.map((m) => `- ${memberName(r.panel, m.id)}`)
        : ['- (패널 정보 없음)']),
      '',
    );
    if (r.first) {
      lines.push(...renderStep(r.first, '### 첫 질문'));
    } else {
      lines.push('첫 질문을 만들지 못했다.', '');
    }
    r.followUps.forEach((f, i) => lines.push(...renderFollowUp(r.panel, f, i + 1)));
  }
  return lines.join('\n');
}

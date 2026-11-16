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
  askedBy?: string;
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
// 목록 항목 안의 인용 블록. 모델이 만든 문장에 줄바꿈이 있어도 목록이 끊기지 않는다.
const nestedQuote = (text: string) => `  ${quote(text).split('\n').join('\n  ')}`;
const inline = (label: string, text: string) =>
  text.includes('\n') ? `${label}\n${nestedQuote(text)}` : `${label} ${text}`;

function memberName(panel: PanelMember[], id: string): string {
  const m = panel.find((p) => p.id === id);
  return m ? `${id} (${ROLES[m.role].name} · ${TEMPERAMENTS[m.temperament]})` : id;
}
const defectName = (d: Defect) => `${DEFECT_NAMES[d.type]} · 축 ${axisName(d.axis)}`;
function choiceLine(panel: PanelMember[], c: PickChoice): string {
  return `${memberName(panel, c.interviewerId)}, 반응 의도 ${c.reactionIntent} ${REACTION_INTENTS[c.reactionIntent]}, 맡은 결함: ${defectName(c.defect)}`;
}

function verificationLines(
  title: string,
  v: Verification,
  corrected: boolean,
  extra: string[] = [],
): string[] {
  return [
    `**${title}**`,
    '',
    `- 전제: ${v.premiseOk ? '맞음' : '틀림'}`,
    ...extra,
    ...(v.problems.length > 0
      ? v.problems.map((p) => inline(`- 문제 [${p.field}]:`, p.problem))
      : ['- 문제: 없음']),
    ...(corrected ? ['- 정답지 수정됨'] : []),
    '',
  ];
}

function renderStep(
  step: R1Step,
  heading: string,
  panel: PanelMember[],
  scenarioFailed: boolean,
): string[] {
  const { question, verification, answerKeyCorrected, flags, attempts } = step.prepared;
  const late = step.lateVerification;
  const lateCorrected = late !== null && late.problems.length > 0;
  const key = lateCorrected ? late.answerKey : question.answerKey;
  const noAssumption = question.assumption.axis === 'none';
  const assumption = noAssumption
    ? '없음(가정을 바꾸지 않는 질문)'
    : `${axisName(question.assumption.axis)} — ${question.assumption.statement}`;
  const lastNaming = attempts[attempts.length - 1]?.naming;

  const lines = [
    step.askedBy ? `${heading} — ${memberName(panel, step.askedBy)}` : heading,
    '',
    quote(question.text),
    '',
    `- 숨은 질문 의도: ${question.questionIntent} ${QUESTION_INTENTS[question.questionIntent]}`,
    `- 바뀐 가정: ${assumption}`,
    `- flags: leak(흘림이 끝까지 남음) ${flags.leak}, premise(사전 검증에서 전제 오류가 끝까지 남음) ${flags.premise}`,
    ...(lastNaming && !lastNaming.ok
      ? [`- 최종 질문에 남은 이름 위반: ${list(lastNaming.violations)}`]
      : []),
    '',
    `**숨은 정답지**${answerKeyCorrected || lateCorrected ? ' (정답지 수정됨, 고친 것을 보여 준다)' : ''}`,
    '',
    `- 사라지는 차이: ${list(key.vanishing)}`,
    `- 남는 차이: ${list(key.remaining)}`,
    `- 대안 기술: ${list(key.alternatives.map((a) => `${a.name} — ${a.traits}`))}`,
    `- 기대하는 답의 핵심: ${list(key.keyPoints)}`,
    '',
  ];

  if (verification) {
    lines.push(
      ...verificationLines('사전 검증(질문을 보여 주기 전)', verification, answerKeyCorrected),
    );
  }
  if (late) {
    lines.push(
      ...verificationLines(
        '사후 검증(가정 없는 질문, 질문이 나간 뒤)',
        late,
        lateCorrected,
        late.premiseOk ? [] : ['- 이미 나간 질문의 전제가 사후 검증에서 틀린 것으로 나옴'],
      ),
    );
  } else if (noAssumption && scenarioFailed) {
    lines.push('**사후 검증**', '', '- 사후 검증 중 실패(시나리오 오류 참고)', '');
  }
  if (!verification && !late && !(noAssumption && scenarioFailed)) {
    lines.push('**검증**', '', '- 검증하지 않았다', '');
  }

  const discarded = attempts.slice(0, -1);
  lines.push(
    '**흘림 검사**',
    '',
    `- 첫 시도의 위반: ${list(attempts[0]?.naming.violations ?? [])}`,
    `- 재생성: ${discarded.length}회`,
  );
  discarded.forEach((a, i) => {
    const reason = !a.naming.ok
      ? `이름 위반(${a.naming.violations.join(', ')})`
      : `전제 오류(${(a.verification?.problems ?? []).map((p) => p.problem).join(' / ')})`;
    lines.push(inline(`- 버려진 시도 ${i + 1} — 버린 이유:`, reason), nestedQuote(a.question.text));
  });

  lines.push('', '**검토**', '', ...CHECKLIST, '');
  return lines;
}

function renderFollowUp(
  panel: PanelMember[],
  f: R1FollowUp,
  n: number,
  scenarioFailed: boolean,
): string[] {
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
      ? analysis.defects.map((d) =>
          d.note ? inline(`- 결함: ${defectName(d)} —`, d.note) : `- 결함: ${defectName(d)}`,
        )
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
  if (f.next) lines.push(...renderStep(f.next, `#### 후속 질문 ${n}`, panel, scenarioFailed));
  else if (pick && scenarioFailed) lines.push('후속 질문 생성 중 실패(시나리오 오류 참고).', '');
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
    const failed = r.error !== null;
    lines.push(`## 시나리오 ${r.scenarioId} (주제: ${r.topic})`, '');
    if (failed) lines.push(`오류: ${r.error}`, '');
    lines.push('**패널**', '');
    lines.push(
      ...(r.panel.length > 0
        ? r.panel.map((m) => `- ${memberName(r.panel, m.id)}`)
        : ['- (패널 정보 없음)']),
      '',
    );
    if (r.first) {
      lines.push(...renderStep(r.first, '### 첫 질문', r.panel, failed));
    } else {
      lines.push('첫 질문을 만들지 못했다.', '');
    }
    r.followUps.forEach((f, i) => lines.push(...renderFollowUp(r.panel, f, i + 1, failed)));
    if (failed && r.first) {
      lines.push(`시나리오가 여기서 멈췄다: 기록된 후속 ${r.followUps.length}개.`, '');
    }
  }
  return lines.join('\n');
}

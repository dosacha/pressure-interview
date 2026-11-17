import type { JsonLlm } from '../../src/interview/llm/llm.service';
import type { TokenUsage } from '../../src/interview/types';

export type AnswerKind = 'good' | 'vague' | 'wrong';

export const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'intendedFlaw'],
  properties: {
    answer: {
      type: 'string',
      description: '면접에서 말하듯 쓴 지원자의 답. 한국어 존댓말, 목록과 마크다운 없음',
    },
    intendedFlaw: {
      type: 'string',
      description: '이 답에 일부러 넣은 결함 한 문장. 좋은 답이면 없음',
    },
  },
};

// 종류마다 그 종류의 답을 쓰는 지시와, 그 답으로 엔진의 무엇을 보는지
const KIND_RULES: Record<AnswerKind, { name: string; rule: string }> = {
  good: {
    name: '좋은 답',
    rule: '질문의 핵심을 정확하고 구체적으로 답한다. 무엇이 그런지에 더해 왜 그런지까지 원리로 설명한다. 경력 있는 지원자가 하는 좋은 답이다. 엔진이 결함이 적은 답을 결함이 적은 답으로 보는지를 이 답으로 본다.',
  },
  vague: {
    name: '모호한 답',
    rule: '틀린 말은 하지 않지만 일반론에 머문다. 구체적인 원리, 근거, 예를 대지 않는다. 두세 문장으로 짧게 답한다. 엔진이 틀린 데는 없지만 내용이 비어 있는 답을 알아보는지를 이 답으로 본다.',
  },
  wrong: {
    name: '틀린 답',
    rule: '질문의 핵심에 닿는 기술 사실 하나를 틀리게 말하고, 나머지는 그럴듯하게 말한다. 무엇을 틀릴지는 질문을 보고 당신이 고른다. 답의 결론이 기대는 사실을 고르고, 실제 지원자가 할 법한 오해로 고른다. 주변 사실을 틀리면 엔진이 사소한 실수로 넘길 수 있고, 터무니없는 오해는 너무 쉽게 잡혀 시험이 되지 않기 때문이다. 틀린 사실은 망설이지 않고 확신 있게 말하고, 그 사실을 근거로 결론까지 이어 간다. 지원자의 자신감에 흔들리지 않고 틀린 것을 잡는지를 이 답으로 본다.',
  },
};

function buildCandidatePrompt(input: {
  topic: string;
  questionText: string;
  kind: AnswerKind;
  rule?: string;
}): { system: string; user: string } {
  const system = `당신은 기술 면접에서 면접관의 질문에 말로 답하는 지원자다. 당신이 쓴 답은 면접 연습 도구의 엔진을 시험하는 데 쓴다. 엔진은 지원자의 답을 분석해 결함을 찾고, 그 결함에 맞춰 다음에 물을 면접관과 반응 방식을 고른다. 사람은 나중에 리포트를 읽으며 좋은 답, 모호한 답, 틀린 답에 따라 엔진의 분석과 반응이 달라지는지를 본다. 그래서 답에는 요청받은 종류의 특징이 분명히 드러나야 한다.

면접관이 물은 그 질문에 답한다. 질문이 어떤 가정을 세웠으면 그 가정을 그대로 받아들이고 그 위에서 답한다. 가정이 현실과 달라도 따지거나 현실의 이야기로 돌리지 않고, 다른 질문으로 바꿔 답하지 않는다. 질문과 다른 이야기를 하면 어떤 종류의 답이든 엔진은 "질문과 다른 것에 답했다"는 같은 결함만 찾게 되어, 종류에 따른 차이를 볼 수 없기 때문이다. 질문이 여러 가지를 물으면 그 모두에 답하되, 얼마나 깊고 정확하게 답할지는 답의 종류를 따른다.

당신은 질문의 숨은 정답지를 받지 않는다. 실제 지원자도 정답지를 모르고 자기 지식으로 답하기 때문이다. 질문 문장과 당신이 아는 기술 지식만으로 답한다.

규칙이 주어지면 지킨다. 규칙은 엔진의 특정 동작을 시험하려고 시나리오가 정한 조건이라, 어기면 그 시험이 성립하지 않기 때문이다.

answer는 면접장에서 말로 답하듯 한국어 존댓말로 쓴다. 목록, 제목, 마크다운 기호는 쓰지 않는다. 엔진이 실제 면접의 말하기 답과 같은 입력을 받아야 시험이 실제와 같아지기 때문이다. 답 안에서 일부러 넣은 결함을 암시하거나 스스로 바로잡지 않는다. 그러면 엔진이 결함을 찾는지 볼 수 없기 때문이다.

intendedFlaw에는 이 답에 일부러 넣은 결함을 한 문장으로 적는다. 결함을 넣지 않은 좋은 답이면 "없음"이라고 적는다. 이 문장은 사람이 리포트에서 엔진의 분석이 그 결함을 잡았는지 대조하는 데만 쓰고 엔진에는 넘기지 않는다.`;

  const { name, rule } = KIND_RULES[input.kind];
  const user = [
    `주제: ${input.topic}`,
    '',
    '면접관의 질문:',
    input.questionText,
    '',
    `답의 종류: ${input.kind} (${name})`,
    `이 종류의 지시: ${rule}`,
    ...(input.rule ? ['', `지켜야 할 규칙: ${input.rule}`] : []),
  ].join('\n');
  return { system, user };
}

export async function writeCandidateAnswer(
  llm: JsonLlm,
  input: { topic: string; questionText: string; kind: AnswerKind; rule?: string },
): Promise<{ data: { answer: string; intendedFlaw: string }; usage: TokenUsage }> {
  const { data, usage } = await llm.callJson<{ answer: string; intendedFlaw: string }>({
    // shortcut: 지원자 답 호출은 analyze 역할의 모델·effort를 빌려 쓴다, 실행기 전용이라 설정을 늘리지 않음. 따로 조절해야 하면 CallRole 추가
    role: 'analyze',
    ...buildCandidatePrompt(input),
    schema: CANDIDATE_SCHEMA,
  });
  return { data, usage };
}

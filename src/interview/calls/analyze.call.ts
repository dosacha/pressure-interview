import {
  AXES,
  DEFECT_NAMES,
  DEFECT_PRIORITY,
  DEFECT_TYPES,
  OWNABLE_AXES,
  QUESTION_INTENTS,
  type DefectType,
} from '../catalog';
import type { JsonLlm } from '../llm/llm.service';
import type { Analysis, Question, TokenUsage } from '../types';
import { ANSWER_KEY_SCHEMA } from './question.call';

export const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'defects', 'mentionedTechs'],
  properties: {
    kind: {
      type: 'string',
      enum: ['answer', 'clarify'],
      description: '답변이면 answer, 질문의 범위나 조건을 되묻는 것이면 clarify',
    },
    defects: {
      type: 'array',
      description: '답변의 결함. 무거운 것부터. clarify이면 빈 배열',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'axis', 'note'],
        properties: {
          type: { type: 'string', enum: [...DEFECT_TYPES], description: '결함 유형 id' },
          axis: { type: 'string', enum: OWNABLE_AXES, description: '결함과 가장 가까운 축 id' },
          note: {
            type: 'string',
            description: '다음 질문을 쓰는 면접관에게 넘기는 한 문장',
          },
        },
      },
    },
    mentionedTechs: {
      type: 'array',
      items: { type: 'string' },
      description: '이번 입력에서 지원자가 말한 기술 이름 전부',
    },
  },
};

// 설계 6.2의 3단계 이름에 붙인 판정 기준. no_why, no_tradeoff, vague, no_evidence는 조사 노트 K4의 결함 → 꼬리질문 대응에서 왔다.
const DEFECT_DEFS: Record<DefectType, string> = {
  wrong: '답변의 사실이나 추론이 정답지와 어긋난다.',
  missing_axis:
    '정답지가 기대하는 관점 하나를 통째로 다루지 않았다. axis에는 빠진 관점의 축을 적는다.',
  no_why: '무엇인지나 무엇을 했는지는 말했지만, 왜 그런지 원인이나 이유를 말하지 않았다.',
  no_tradeoff: '선택이나 방법의 장점만 말하고 단점이나 대가를 말하지 않았다.',
  vague: '표현이 추상적이어서 무엇을 어떻게 했는지 구체적으로 알 수 없다.',
  no_evidence: '개선이나 효과를 주장하면서 수치, 기준선, 측정 방법을 대지 않았다.',
  none: '정답지의 핵심을 맞게 짚었고 위의 결함이 없다.',
};

const axisName = (id: string): string => AXES.find((a) => a.id === id)?.name ?? id;

function buildAnalyzePrompt(input: { topic: string; question: Question; answer: string }): {
  system: string;
  user: string;
} {
  const defects = [...DEFECT_TYPES]
    .sort((a, b) => DEFECT_PRIORITY[b] - DEFECT_PRIORITY[a])
    .map((id) => `- ${id} ${DEFECT_NAMES[id]}: ${DEFECT_DEFS[id]}`)
    .join('\n');

  const system = `당신은 기술 압박 면접에서 지원자의 답변을 분석하는 검토자다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 당신이 찾은 결함으로 코드가 다음 질문을 할 면접관과 그 면접관의 반응 방식을 정한다. 분석 결과는 면접 중에 지원자에게 보이지 않는다.

판정의 기준은 질문의 숨은 정답지다. 정답지는 질문을 쓴 면접관이 기대한 답을 담고 있으므로, 답변이 정답지의 어디를 맞히고 어디를 놓쳤는지를 본다. 정답지 필드의 뜻은 다음과 같다.

${Object.entries(ANSWER_KEY_SCHEMA.properties)
  .map(([key, field]) => `- ${key}: ${field.description}`)
  .join('\n')}

면접 중의 판정 오류는 복기에서 바로잡으므로, 판정이 틀릴 수 있다는 것은 받아들여져 있다. 다만 결함은 답변에 실제로 있는 말과 빠진 내용에서만 찾고, 답변에 없는 말을 지어내 결함으로 삼지 않는다. 지어낸 결함에는 지원자가 하지 않은 말을 따지는 질문이 이어지기 때문이다.

## 되묻기

지원자의 입력이 답이 아니라 질문의 범위나 조건을 되묻는 것이면 kind를 clarify로 두고 defects는 빈 배열로 둔다. 되묻기는 허용된 행동이고, 같은 면접관이 범위와 조건에만 답하므로 결함을 매길 대상이 아니다. 그 밖에는 kind를 answer로 둔다.

## 결함 유형

결함 유형은 아래 목록에서 고른다. 목록은 무거운 것부터 적었다.

${defects}

결함이 여럿이면 모두 적되 무거운 것부터 적는다. 강한 답이면 none 하나만 적는다. none은 결함이 없다는 판정이라 다른 결함과 함께 적지 않는다.

## 축

결함마다 아래 축 가운데 가장 가까운 것 하나를 axis에 적는다. 축은 그 결함을 이어서 물을 면접관을 정하기 때문이다. none에도 답변 내용과 가장 가까운 축을 적는다. 강한 답 뒤에 난이도를 올려 물을 면접관도 축으로 정하기 때문이다.

${OWNABLE_AXES.map((id) => `- ${id} ${axisName(id)}`).join('\n')}

## note

note에는 다음 질문을 쓰는 면접관에게 넘길 한 문장을 쓴다. 답변의 어느 부분이 왜 그 판정인지를 정답지에 비추어 적는다. 면접관은 이 문장을 보고 반응할 지점을 고른다.

## 지원자가 말한 기술

mentionedTechs에는 이번 입력에서 지원자가 말한 기술 이름을 지원자가 쓴 표기대로 모두 적는다. 되묻기여도 채운다. 이 목록에 든 기술은 다음 질문에서 면접관이 먼저 꺼내도 되는 기술이 되므로, 질문 문장이나 정답지에만 나오고 지원자가 말하지 않은 기술은 넣지 않는다.`;

  const { question } = input;
  const assumption =
    question.assumption.axis === 'none'
      ? '없음(가정을 바꾸지 않는 질문)'
      : `${axisName(question.assumption.axis)} 축. ${question.assumption.statement}`;
  const user = [
    `주제: ${input.topic}`,
    '',
    `질문: ${question.text}`,
    `질문 의도: ${question.questionIntent} ${QUESTION_INTENTS[question.questionIntent]}`,
    `바뀐 가정: ${assumption}`,
    '',
    '숨은 정답지:',
    JSON.stringify(question.answerKey, null, 2),
    '',
    '지원자의 입력:',
    input.answer,
  ].join('\n');

  return { system, user };
}

export async function analyzeAnswer(
  llm: JsonLlm,
  input: { topic: string; question: Question; answer: string },
): Promise<{ data: Analysis; usage: TokenUsage }> {
  const { data, usage } = await llm.callJson<Analysis>({
    role: 'analyze',
    ...buildAnalyzePrompt(input),
    schema: ANALYZE_SCHEMA,
  });
  return { data, usage };
}

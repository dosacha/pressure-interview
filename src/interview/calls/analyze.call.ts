import {
  axisName,
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
  required: ['kind', 'defects', 'mentionedTechs', 'unknownTechs'],
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
    unknownTechs: {
      type: 'array',
      items: { type: 'string' },
      description: '질문이 꺼낸 기술 가운데 이번 입력에서 지원자가 모른다고 밝힌 기술',
    },
  },
};

// 설계 6.2의 3단계 이름에 붙인 판정 기준. no_why, no_tradeoff, vague, no_evidence는 조사 노트 K4의 결함 → 꼬리질문 대응에서 왔다.
const DEFECT_DEFS: Record<DefectType, string> = {
  wrong:
    '답변의 기술 사실이나 추론이 정답지와 어긋난다. 정답지가 다루지 않은 내용이라도 명백히 틀렸으면 여기에 든다.',
  missing_axis:
    '정답지가 기대하는 핵심 관점이 답에서 빠졌다. 핵심 관점은 그대로 다루면서 정답지의 세부 항목 몇 개를 말하지 않은 것은 여기에 들지 않는다. axis에는 빠진 관점의 축을 적는다.',
  no_why: '무엇인지나 무엇을 했는지는 말했지만, 왜 그런지 원인이나 이유를 말하지 않았다.',
  no_tradeoff: '선택이나 방법의 장점만 말하고 단점이나 대가를 말하지 않았다.',
  vague: '표현이 추상적이어서 무엇을 어떻게 했는지 구체적으로 알 수 없다.',
  no_evidence: '개선이나 효과를 주장하면서 수치, 기준선, 측정 방법을 대지 않았다.',
  none: '강한 답이다. 정답지의 keyPoints를 대부분 맞게 짚었고 틀린 말이 없다.',
};

interface AnalyzeInput {
  topic: string;
  question: Question;
  answer: string;
  userMentioned?: string[];
}

function buildAnalyzePrompt(input: AnalyzeInput): {
  system: string;
  user: string;
} {
  const defects = [...DEFECT_TYPES]
    .sort((a, b) => DEFECT_PRIORITY[b] - DEFECT_PRIORITY[a])
    .map((id) => `- ${id} ${DEFECT_NAMES[id]}: ${DEFECT_DEFS[id]}`)
    .join('\n');

  const system = `당신은 기술 압박 면접에서 지원자의 답변을 분석하는 검토자다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 당신이 찾은 결함으로 코드가 다음 질문을 할 면접관과 그 면접관의 반응 방식을 정한다. 분석 결과는 면접 중에 지원자에게 보이지 않는다.

판정의 1차 기준은 질문의 숨은 정답지다. 정답지는 질문을 쓴 면접관이 기대한 답을 담고 있으므로, 답변이 정답지의 어디를 맞히고 어디를 놓쳤는지를 본다. 정답지가 다루지 않은 내용에서 명백히 틀린 말은 아래 wrong의 기준대로 따로 잡는다. 정답지 필드의 뜻은 다음과 같다.

${Object.entries(ANSWER_KEY_SCHEMA.properties)
  .map(([key, field]) => `- ${key}: ${field.description}`)
  .join('\n')}

면접 중의 판정 오류는 복기에서 바로잡으므로, 판정이 틀릴 수 있다는 것은 받아들여져 있다. 다만 결함은 답변에 실제로 있는 말과 빠진 내용에서만 찾고, 답변에 없는 말을 지어내 결함으로 삼지 않는다. 지어낸 결함에는 지원자가 하지 않은 말을 따지는 질문이 이어지기 때문이다.

## 되묻기

지원자의 입력이 답이 아니라 질문의 범위나 조건을 되묻는 것이면 kind를 clarify로 두고 defects는 빈 배열로 둔다. 되묻기는 허용된 행동이고, 같은 면접관이 범위와 조건에만 답하므로 결함을 매길 대상이 아니다. 그 밖에는 kind를 answer로 둔다.

## 결함 유형

결함 유형은 아래 목록에서 고른다. 목록은 무거운 것부터 적었다.

${defects}

## 결함을 몇 개 적는가

적는 결함의 수는 답이 정답지에 얼마나 가까운지에 따라 다르다. 먼저 답이 아래 세 경우 가운데 어디에 드는지 정하고, 그 경우의 방식대로 적는다.

1. 강한 답: keyPoints를 대부분 맞게 짚었고 틀린 말이 없다. none 하나만 적는다. 정답지의 세부 항목 몇 개를 말하지 않은 것은 결함으로 치지 않는다. 정답지는 면접관이 기대할 수 있는 것을 넓게 적은 목록이라, 실제 면접에서 그 전부를 말하는 지원자는 없기 때문이다. none은 결함이 없다는 판정이라 다른 결함과 함께 적지 않는다.
2. 정답에 가까운 답: keyPoints 대부분을 맞게 짚었지만, 핵심 관점 하나가 빠졌거나 한 군데가 틀렸다. 틀린 곳이 있어도 답의 결론이 그 말에 기대지 않는 경우다. 가장 중요한 결함 하나만 적는다. 결함을 여러 개 적으면 면접관 두 명이 한꺼번에 따지게 되는데, 그것은 답이 많이 부족할 때만 맞는 반응이기 때문이다.
3. 그 밖의 답: keyPoints의 상당 부분이 빠졌거나, 표현이 모호해 무엇을 말하는지 알 수 없거나, 답의 결론이 기대는 사실이 틀렸다. 찾은 결함을 모두 적되 무거운 것부터 적는다. 부족한 곳이 여럿인 답에는 여러 면접관이 함께 반응하는 것이 실제 면접과 같기 때문이다.

## 축

결함마다 아래 축 가운데 가장 가까운 것 하나를 axis에 적는다. 축은 그 결함을 이어서 물을 면접관을 정하기 때문이다. none에도 답변 내용과 가장 가까운 축을 적는다. 강한 답 뒤에 난이도를 올려 물을 면접관도 축으로 정하기 때문이다.

${OWNABLE_AXES.map((id) => `- ${id} ${axisName(id)}`).join('\n')}

## note

note에는 다음 질문을 쓰는 면접관에게 넘길 한 문장을 쓴다. 답변의 어느 부분이 왜 그 판정인지를 정답지에 비추어 적는다. 면접관은 이 문장을 보고 반응할 지점을 고른다. none이면 답이 말하지 않은 세부 가운데 가장 더 물어볼 만한 지점을 적는다. 강한 답 뒤에는 면접관이 난이도를 올리거나 확신을 시험하는데, 이 문장이 그 질문의 재료가 되기 때문이다. 정답지의 대안 기술처럼 지원자가 말하지 않은 기술 이름은 note에 쓰지 않고, "대안을 하나도 말하지 않았다"처럼 쓴다. note는 다음 질문 프롬프트에 그대로 들어가므로, 그 이름이 질문으로 흘러가 지원자가 스스로 대안을 떠올리는 연습을 없애기 때문이다.

## 지원자가 말한 기술

mentionedTechs에는 이번 입력에서 지원자가 말한 기술 이름을 지원자가 쓴 표기대로 모두 적는다. 되묻기여도 채운다. 이 목록에 든 기술은 다음 질문에서 면접관이 먼저 꺼내도 되는 기술이 되므로, 질문 문장이나 정답지에만 나오고 지원자가 말하지 않은 기술은 넣지 않는다. 같은 이유로 아래 unknownTechs에 적은 기술은 지원자가 그 이름을 입에 올렸더라도 넣지 않는다.

## 지원자가 모른다고 한 기술

가정 변경 질문은 지원자가 말한 적 없는 기술을 비교 대상으로 꺼낼 수 있다. 지원자가 그 기술을 써 보지 않았다면 기술 자체를 모를 수 있고, 모른다고 하면 면접관은 알겠다고 받고 캐묻지 않고 넘어간다. 써 보지 않은 기술을 모르는 것은 지원자의 결함이 아니고, 그 기술을 캐물으면 주제와 상관없는 지식을 시험하게 되기 때문이다.

그래서 unknownTechs에는 질문 문장에 나온 기술 가운데, 주제 기술이 아니고, 지원자가 이전에 말한 적 없으며, 이번 입력에서 지원자가 모른다고 밝힌 기술을 적는다. 지원자가 이전에 말한 기술은 user 메시지에 있으면 그것을 본다. 지원자가 이름을 대지 않고 "이 부분은 잘 모르겠습니다"라고만 해도, 그 모름이 질문이 꺼낸 그런 기술에 관한 것이면 그 기술을 적는다. 모르는 기술의 이름을 다시 말하지 않는 지원자도 많기 때문이다.

지원자가 이미 말한 기술이나 주제 기술에 대해 모른다고 한 것은 unknownTechs에 넣지 않고, 다른 입력처럼 답으로 분석해 결함을 적는다. 그 기술은 지원자가 스스로 꺼냈거나 면접의 중심이어서, 어디까지 아는지가 확인할 대상이기 때문이다.

unknownTechs가 비어 있지 않으면 defects는 빈 배열로 둔다. 면접관이 캐묻지 않고 넘어가므로 결함을 매길 대상이 아니기 때문이다. 해당하는 기술이 없으면 unknownTechs는 빈 배열이다.`;

  const { question } = input;
  const assumption =
    question.assumption.axis === 'none'
      ? '없음(가정을 바꾸지 않는 질문)'
      : `${axisName(question.assumption.axis)} 축. ${question.assumption.statement}`;
  const user = [
    `주제: ${input.topic}`,
    ...(input.userMentioned
      ? [`지원자가 이전까지 말한 기술: ${input.userMentioned.join(', ')}`]
      : []),
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
  input: AnalyzeInput,
): Promise<{ data: Analysis; usage: TokenUsage }> {
  const { data, usage } = await llm.callJson<Analysis>({
    role: 'analyze',
    ...buildAnalyzePrompt(input),
    schema: ANALYZE_SCHEMA,
  });
  return { data, usage };
}

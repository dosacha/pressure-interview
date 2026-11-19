// 서버판 src/interview/calls/analyze.call.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { axisName, DEFECT_NAMES, DEFECT_PRIORITY, DEFECT_TYPES, OWNABLE_AXES, QUESTION_INTENTS, SCORES, SIGNAL_TYPES } from '../catalog.mjs';
                                                  
                                                               
import { ANSWER_KEY_SCHEMA } from './question.call.mjs';

// 복기 프롬프트도 이 문장을 그대로 쓴다.
export const SCORE_DEFINITIONS = `- solid 잘 앎: 핵심을 맞게 말했고, 왜 그런지 원리로 설명했다. 빠진 것이 있어도 짚어 주면 바로 채울 수준이다
- mostly 대체로 앎: 결론은 맞지만 이유가 얕거나 중요한 조건 하나를 놓쳤다
- unclear 애매함: 맞는 말과 틀린 말이 섞였거나, 일반론만 말해 아는지 알 수 없다
- wrong 틀림/모름: 핵심이 틀렸거나 모른다고 했다`;

export const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'defects', 'mentionedTechs', 'unknownTechs', 'selfUnknownTechs', 'score', 'signals'],
  properties: {
    score: {
      anyOf: [{ type: 'string', enum: SCORES }, { type: 'null' }],
      description: '답의 점수. clarify이거나 면접관이 꺼낸 전제 기술을 모른다고 한 답이면 null',
    },
    signals: {
      type: 'array',
      description: '답에서 보인 근거 신호. 해당할 때만. clarify이면 빈 배열',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'quote'],
        properties: {
          type: { type: 'string', enum: SIGNAL_TYPES, description: '신호 유형 id' },
          quote: { type: 'string', description: '답에서 그 부분을 글자 그대로 인용한 것' },
        },
      },
    },
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
    selfUnknownTechs: {
      type: 'array',
      items: { type: 'string' },
      description: '지원자가 이번 입력에서 스스로 꺼내며 모른다고 밝힌 기술',
    },
  },
};

// 설계 6.2의 3단계 이름에 붙인 판정 기준. no_why, no_tradeoff, vague, no_evidence는 조사 노트 K4의 결함 → 꼬리질문 대응에서 왔다.
const DEFECT_DEFS                             = {
  wrong:
    '답변의 기술 사실이나 추론이 정답지와 어긋난다. 정답지가 다루지 않은 내용이라도 명백히 틀렸으면 여기에 든다.',
  missing_axis:
    '질문이 물은 관점 가운데 답하지 않은 것이 있다. 무엇이 빠졌다고 보는지는 아래 "결함을 몇 개 적는가"를 따른다. axis에는 빠진 관점의 축을 적는다.',
  no_why: '무엇인지나 무엇을 했는지는 말했지만, 왜 그런지 원인이나 이유를 말하지 않았다.',
  no_tradeoff: '선택이나 방법의 장점만 말하고 단점이나 대가를 말하지 않았다.',
  vague: '표현이 추상적이어서 무엇을 어떻게 했는지 구체적으로 알 수 없다.',
  no_evidence: '개선이나 효과를 주장하면서 수치, 기준선, 측정 방법을 대지 않았다.',
  none: '결함이 없다. 아래 "결함을 몇 개 적는가"의 강한 답에만 쓴다.',
};

                        
                
                     
                 
                           
 

function buildAnalyzePrompt(input              )   
                 
               
  {
  const defects = [...DEFECT_TYPES]
    .sort((a, b) => DEFECT_PRIORITY[b] - DEFECT_PRIORITY[a])
    .map((id) => `- ${id} ${DEFECT_NAMES[id]}: ${DEFECT_DEFS[id]}`)
    .join('\n');

  const system = `당신은 기술 압박 면접에서 지원자의 답변을 분석하는 검토자다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 당신이 찾은 결함으로 코드가 다음 질문을 할 면접관과 그 면접관의 반응 방식을 정한다. 분석 결과는 면접 중에 지원자에게 보이지 않는다.

판정의 1차 기준은 질문의 숨은 정답지다. 정답지는 질문을 쓴 면접관이 기대한 답을 담고 있으므로, 답변의 기술 사실과 이유가 맞는지를 정답지에 비추어 본다. 정답지가 다루지 않은 내용에서 명백히 틀린 말은 아래 wrong의 기준대로 따로 잡는다. 정답지 필드의 뜻은 다음과 같다.

${Object.entries(ANSWER_KEY_SCHEMA.properties)
  .map(([key, field]) => `- ${key}: ${field.description}`)
  .join('\n')}

면접 중의 판정 오류는 복기에서 바로잡으므로, 판정이 틀릴 수 있다는 것은 받아들여져 있다. 다만 결함은 답변에 실제로 있는 말과 빠진 내용에서만 찾고, 답변에 없는 말을 지어내 결함으로 삼지 않는다. 지어낸 결함에는 지원자가 하지 않은 말을 따지는 질문이 이어지기 때문이다.

## 되묻기

지원자의 입력이 답이 아니라 질문의 범위나 조건을 되묻는 것이면 kind를 clarify로 두고 defects는 빈 배열로 둔다. 되묻기는 허용된 행동이고, 같은 면접관이 범위와 조건에만 답하므로 결함을 매길 대상이 아니다. 그 밖에는 kind를 answer로 둔다.

## 점수

답마다 score를 아래 넷 가운데 하나로 매긴다. 결함을 적는 일과 별개로, 이 답이 보여 주는 이해의 수준을 본다.

${SCORE_DEFINITIONS}

되묻기(clarify)에는 score를 null로 둔다. 면접관이 꺼낸 전제 기술을 모른다고 한 답은 score를 null로 둔다. 써 보지 않은 기술을 모르는 것은 지원자의 결함이 아니므로 점수를 매기지 않는다.

## 신호

signals에는 해당할 때만 적는다. 없으면 빈 배열이다. 신호마다 quote에 답에서 그 부분을 글자 그대로 인용한다. 인용할 수 없으면 적지 않는다.

- practical 실무 적용: 구체적인 운영 상황에서 무엇을 고르고, 왜 고르고, 무엇을 감수하는지 말했다.
- reasoning 추론: 모르는 것이나 처음 보는 조건에서 아는 원리로부터 그럴듯한 답에 다가갔다.
- selfCorrection 스스로 고침: 반례나 꼬리질문을 받고 자기 답의 틀린 곳을 찾아 고쳤다.

되묻기(clarify)이면 signals는 빈 배열이다.

## 결함 유형

결함 유형은 아래 목록에서 고른다. 목록은 무거운 것부터 적었다.

${defects}

## 결함을 몇 개 적는가

적는 결함의 수는 답이 얼마나 부족한지에 따라 다르다. 먼저 답이 아래 세 경우 가운데 어디에 드는지 정하고, 그 경우의 방식대로 적는다.

경우를 가르는 기준은 정답지의 항목이 아니라 질문이 물은 것이다. 정답지는 그 질문에서 나올 수 있는 좋은 내용을 넓게 모은 것이고, 지원자는 정답지를 보지 않고 질문에만 답하기 때문이다. 그래서 정답지에는 있지만 답이 다루지 않은 항목은, keyPoints(기대하는 답의 핵심)에 적힌 항목이어도 그것만으로는 결함이 아니다. 질문이 물은 것에 답했는지는 질문이 물은 부분마다 답이 있는지로 본다. 그 부분에 대해 정답지가 적은 항목을 모두 들었는지로 보지 않는다.

1. 강한 답: 질문이 물은 것 전부에 맞게 답했고, 무엇이 그런지에 더해 왜 그런지까지 설명했으며, 틀린 말이 없다. none 하나만 적는다. 물은 것에 모두 답했어도 이유 없이 결론만 말한 답은 강한 답이 아니다. 이유를 댈 수 있는지가 이 면접이 확인하려는 것이기 때문이다. none은 결함이 없다는 판정이라 다른 결함과 함께 적지 않는다.
2. 정답에 가까운 답: 강한 답에서 한 군데만 어긋났다. 질문이 직접 물은 것 가운데 하나에 답하지 않았고 나머지에는 이유까지 답했거나, 물은 것 전부에 이유까지 답했지만 결론을 바꾸지는 않는 한 군데가 틀렸다. 가장 중요한 결함 하나만 적는다. 결함을 여러 개 적으면 면접관 두 명이 한꺼번에 따지게 되는데, 그것은 답이 많이 부족할 때만 맞는 반응이기 때문이다.
3. 그 밖의 답: 질문이 물은 것의 상당 부분에 답하지 않았거나, 물은 것에 답은 했어도 이유와 구체 없이 일반론에 머물렀거나, 답의 결론이 기대는 사실이 틀렸다. 찾은 결함을 모두 적되 무거운 것부터 적는다. 부족한 곳이 여럿인 답에는 여러 면접관이 함께 반응하는 것이 실제 면접과 같기 때문이다.

## 축

결함마다 아래 축 가운데 가장 가까운 것 하나를 axis에 적는다. 축은 그 결함을 이어서 물을 면접관을 정하기 때문이다. none에도 답변 내용과 가장 가까운 축을 적는다. 강한 답 뒤에 난이도를 올려 물을 면접관도 축으로 정하기 때문이다.

${OWNABLE_AXES.map((id) => `- ${id} ${axisName(id)}`).join('\n')}

## note

note에는 다음 질문을 쓰는 면접관에게 넘길 한 문장을 쓴다. 답변의 어느 부분이 왜 그 판정인지를 정답지에 비추어 적는다. 면접관은 이 문장을 보고 반응할 지점을 고른다. none이면 정답지에는 있지만 답이 다루지 않은 항목 가운데 가장 더 물어볼 만한 지점을 적는다. 강한 답 뒤에는 면접관이 난이도를 올리거나 확신을 시험하는데, 이 문장이 그 질문의 재료가 되기 때문이다. 정답지의 대안 기술처럼 지원자가 말하지 않은 기술 이름은 note에 쓰지 않고, "대안을 하나도 말하지 않았다"처럼 쓴다. note는 다음 질문 프롬프트에 그대로 들어가므로, 그 이름이 질문으로 흘러가 지원자가 스스로 대안을 떠올리는 연습을 없애기 때문이다.

## 지원자가 말한 기술

mentionedTechs에는 이번 입력에서 지원자가 말한 기술 이름을 지원자가 쓴 표기대로 모두 적는다. 되묻기여도 채운다. 이 목록에 든 기술은 다음 질문에서 면접관이 먼저 꺼내도 되는 기술이 되므로, 질문 문장이나 정답지에만 나오고 지원자가 말하지 않은 기술은 넣지 않는다. 같은 이유로 아래 unknownTechs와 selfUnknownTechs에 적은 기술은 지원자가 그 이름을 입에 올렸더라도 넣지 않는다.

## 지원자가 모른다고 한 기술

가정 변경 질문은 지원자가 말한 적 없는 기술을 비교 대상으로 꺼낼 수 있다. 지원자가 그 기술을 써 보지 않았다면 기술 자체를 모를 수 있고, 모른다고 하면 면접관은 알겠다고 받고 캐묻지 않고 넘어간다. 써 보지 않은 기술을 모르는 것은 지원자의 결함이 아니고, 그 기술을 캐물으면 주제와 상관없는 지식을 시험하게 되기 때문이다.

그래서 unknownTechs에는 질문 문장에 나온 기술 가운데, 주제 기술이 아니고, 지원자가 이전에 말한 적 없으며, 이번 입력에서 지원자가 모른다고 밝힌 기술을 적는다. 지원자가 이전에 말한 기술은 user 메시지에 있으면 그것을 본다. 지원자가 이름을 대지 않고 "이 부분은 잘 모르겠습니다"라고만 해도, 그 모름이 질문이 꺼낸 그런 기술에 관한 것이면 그 기술을 적는다. 모르는 기술의 이름을 다시 말하지 않는 지원자도 많기 때문이다.

지원자가 이전 입력에서 이미 말한 기술이나 주제 기술에 대해 모른다고 한 것은 unknownTechs에도 selfUnknownTechs에도 넣지 않고, 다른 입력처럼 답으로 분석해 결함을 적는다. 그 기술은 지원자가 앞에서 아는 것으로 꺼냈거나 면접의 중심이어서, 어디까지 아는지가 확인할 대상이기 때문이다.

unknownTechs가 비어 있지 않으면 defects는 빈 배열로 둔다. 면접관이 캐묻지 않고 넘어가므로 결함을 매길 대상이 아니기 때문이다. 해당하는 기술이 없으면 unknownTechs는 빈 배열이다.

selfUnknownTechs에는 질문 문장에 나오지 않았는데 지원자가 이번 입력에서 스스로 이름을 꺼내면서 써 본 적이 없다거나 모른다고 밝힌 기술을 적는다. 주제 기술과 지원자가 이전에 말한 기술은 넣지 않는다. 이 목록에 든 기술은 이후 질문에 다시 넣지 않는다. 지원자가 모른다고 밝힌 기술을 면접관이 아는 기술처럼 꺼내 물으면 답할 수 없는 것을 묻게 되기 때문이다. unknownTechs와 달리 selfUnknownTechs에 기술이 있어도 defects는 평소대로 적는다. 질문이 그 기술에 기대고 있지 않아서 답의 나머지는 분석할 수 있기 때문이다. 해당하는 기술이 없으면 빈 배열이다.`;

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
  llm         ,
  input              ,
)                                                 {
  const { data, usage } = await llm.callJson          ({
    role: 'analyze',
    ...buildAnalyzePrompt(input),
    schema: ANALYZE_SCHEMA,
  });
  return { data, usage };
}

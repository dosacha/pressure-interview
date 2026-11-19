// 서버판 src/interview/calls/review.call.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { axisName, DEFECT_NAMES, QUESTION_INTENTS, REACTION_INTENTS, ROLES, TEMPERAMENTS } from '../catalog.mjs';
                                                  
                                                                            

const note = (description        ) => ({ type: 'string', description });

export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'defects', 'reactions', 'assumption', 'keyProblems'],
  properties: {
    intent: {
      type: 'object',
      additionalProperties: false,
      required: ['aimed', 'note'],
      properties: {
        aimed: { type: 'boolean', description: '답이 질문 의도를 향했으면 true' },
        note: note('그렇게 본 까닭'),
      },
    },
    defects: {
      type: 'array',
      description: '면접 중 분석의 결함마다 하나. 결함이 없었으면 빈 배열',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'verdict', 'note'],
        properties: {
          index: { type: 'integer', description: '분석의 결함 순서(0부터)' },
          verdict: {
            type: 'string',
            enum: ['valid', 'misjudged'],
            description: '맞는 지적이면 valid, 오판이면 misjudged',
          },
          note: note('그렇게 본 까닭'),
        },
      },
    },
    reactions: {
      type: 'array',
      description: '이 답에서 나온 질문마다 하나. 그런 질문이 없으면 빈 배열',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'verdict', 'note'],
        properties: {
          index: { type: 'integer', description: '이 답에서 나온 질문의 순서(0부터)' },
          verdict: {
            type: 'string',
            enum: ['valid_point', 'misjudgment', 'intended_test', 'deepening'],
            description:
              '실제 결함을 짚었으면 valid_point, 오판이면 misjudgment, 일부러 흔든 것이면 intended_test, 결함이 없어 더 깊이 물은 것이면 deepening',
          },
          note: note('그렇게 본 까닭'),
        },
      },
    },
    assumption: {
      type: 'object',
      additionalProperties: false,
      required: ['result', 'note', 'sameAs'],
      properties: {
        result: {
          type: 'string',
          enum: ['well', 'wobbly', 'wrong', 'none'],
          description: '바뀐 가정에 대한 답의 결과. 가정을 바꾸지 않은 질문이면 none',
        },
        note: note('그렇게 본 까닭'),
        sameAs: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: '같은 가정이 이미 있으면 그 key, 없으면 null',
        },
      },
    },
    keyProblems: {
      type: 'array',
      items: { type: 'string' },
      description: '정답지에서 찾은 틀린 내용. 없으면 빈 배열',
    },
  },
};

const defectLine = (d        ) =>
  `${d.type} ${DEFECT_NAMES[d.type]}(관련 축: ${d.axis} ${axisName(d.axis)})${d.note ? `. ${d.note}` : ''}`;

export function buildReviewPrompt(input             )                                   {
  const system = `당신은 기술 압박 면접이 끝난 뒤 면접의 한 턴을 다시 검사하는 복기 검토자다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 면접 중에는 분석 단계가 지원자의 답을 빠르게 판정했고, 그 판정으로 다음에 물을 면접관과 반응 방식이 정해졌다. 그 판정은 틀릴 수 있다는 것을 받아들이고 면접을 진행했고, 이 재검사가 시간을 들여 그것을 바로잡는다. 결과는 복기 화면에서 질문 의도, 숨은 정답지와 함께 지원자에게 보인다.

틀린 복기는 지원자에게 잘못된 지식을 가르친다. 맞는 답을 틀렸다고 하면 지원자는 맞는 지식을 버리고, 틀린 답을 맞다고 하면 틀린 지식을 굳힌다. 그래서 확신이 없는 판정은 그 note에 확신이 없다고 적고 무엇이 불확실한지를 쓴다.

판정의 기준은 user 메시지의 숨은 정답지와 기술 사실이다. 정답지는 검증을 거쳐 고친 것이지만 그래도 틀릴 수 있다. 답이 정답지와 어긋나면 정답지가 맞는지도 확인하고, 정답지가 틀렸다면 그 정답지에 맞추어 답을 틀렸다고 하지 않는다.

note는 모두 지원자가 복기에서 읽는 문장이다. 그 문장만 읽고 답의 어느 부분이 왜 그런 판정인지 알 수 있게 구체적으로 쓴다. 이 호출의 결과는 면접이 끝난 뒤에만 보이므로, 지원자가 말하지 않은 기술의 이름을 써도 된다.

## intent

aimed는 답이 질문 의도가 확인하려던 것을 향했으면 true다. 답이 맞더라도 다른 것을 확인하는 답이면 false다. 지원자는 복기에서 자기 답을 질문 의도에 대조하며, 다음에 같은 의도의 질문을 받을 때 무엇을 겨냥해야 하는지 배우기 때문이다. note에는 그렇게 본 까닭을 쓴다.

## defects

면접 중 분석이 적은 결함마다 하나씩, 답을 다시 읽고 맞는 지적이면 valid, 오판이면 misjudged로 가른다. index는 user 메시지에 적은 결함 번호(0부터)다. none ${DEFECT_NAMES.none}도 판정이므로, 답이 정말 결함 없는 답이었으면 valid, 실제로는 결함이 있었으면 misjudged다. 분석이 결함을 적지 않았으면 빈 배열로 둔다. 지원자가 면접 중에 받은 압박이 실제 결함 때문이었는지를 이것으로 알려 주기 때문이다.

## reactions

이 답에서 나온 질문마다 하나씩 가른다. index는 user 메시지에 적은 그 질문의 번호(0부터)다. 덧붙이는 질문은 다른 면접관이 같은 답에 얹은 질문이라 함께 가른다.

- intended_test: 반응 의도가 B8 ${REACTION_INTENTS.B8}이고, 답이 맞았는데도 의심을 던진 것이다. 일부러 흔든 것이라 오판이 아니다.
- deepening: 답에 실제 결함이 없었고, 면접관도 답을 틀렸다고 보지 않은 채 난이도나 범위를 올려 더 물었거나 답이 다루지 않은 부분으로 넘어간 것이다. 근거로 삼은 결함이 none ${DEFECT_NAMES.none}이고 그 판정이 맞을 때가 여기에 든다. 반응 의도가 B8 ${REACTION_INTENTS.B8}이면 deepening이 아니라 intended_test다. 더 깊이 묻는 질문도 지원자에게는 압박으로 느껴지므로, 이것을 valid_point로 적으면 지원자가 맞는 답에 결함이 있었다고 오해한다.
- valid_point: 답의 실제 결함을 짚은 반응이다. 근거로 삼은 결함이 none ${DEFECT_NAMES.none}이었더라도, 답에 실제로 결함이 있었고 질문이 그것을 짚었으면 여기에 든다.
- misjudgment: 답이 맞았는데 틀렸다고 보고 반응한 것이다.

압박 질문을 받은 지원자는 자기 답이 틀렸다고 여기기 쉽다. 어느 반응이 실제 결함을 짚었고, 어느 것이 답이 맞아 더 물은 것이며, 어느 것이 일부러 흔든 것이거나 오판이었는지 가려 주어야 지원자가 맞는 답을 버리지 않는다. 이 답에서 나온 질문이 없으면 빈 배열로 둔다.

## assumption

result는 가정을 바꾼 질문일 때만 매긴다. 가정을 바꾸지 않은 질문이면 result를 none으로 둔다. 가정이 바뀌어야 사라지는 차이와 남는 차이가 생기고, 이 결과는 그 가정을 다시 물을지 정하는 기억이 되기 때문이다.

- well: 사라지는 차이와 남는 차이의 핵심을 맞게 답했다.
- wobbly: 일부만 맞았다. 핵심 차이 가운데 일부가 빠졌다.
- wrong: 핵심이 틀렸다.

답의 내용만으로 가른다. 되묻기 응답이나 면접관의 반응에서 힌트를 받았는지는 보지 않는다. 힌트를 받았든 아니든 최종적으로 맞게 답했으면 지원자가 그 차이를 안다는 사실은 같기 때문이다. well이면 이 가정을 다시 내지 않으므로, 핵심이 다 맞았는지 확신이 없으면 note에 그렇다고 적는다.

sameAs에는 user 메시지의 같은 축의 기록된 가정 가운데 이 질문의 가정과 같은 가정이 있으면 그 key를 적고, 없으면 null로 둔다. 기술이 달라도 바뀐 것이 같으면 같은 가정이다. 기억의 단위가 기술 쌍이 아니라 바뀐 가정이라서, 다른 기술 조합에 끼워 다시 낸 가정도 같은 가정으로 알아봐야 하기 때문이다. 가정을 바꾸지 않은 질문이면 null이다.

## keyProblems

정답지에 틀린 내용이 보이면 무엇이 왜 틀렸는지 하나씩 적는다. 없으면 빈 배열로 둔다. 정답지는 복기에서 그대로 공개되므로, 여기에 적은 문제를 함께 보여 주어 지원자가 틀린 정답지를 배우지 않게 하기 때문이다. 확인되지 않은 의심은 문제로 적지 않는다.`;

  const role = ROLES[input.interviewer.role];
  const { question, cause } = input;
  const lines           = [
    `주제: ${input.topic}`,
    '',
    `질문한 면접관: ${input.interviewer.id} ${role.name}${role.type === 'job' ? '(직무형)' : ''}, 성향은 ${TEMPERAMENTS[input.interviewer.temperament]}`,
  ];
  if (cause.reactionIntent !== null)
    lines.push(
      `이 질문의 반응 의도: ${cause.reactionIntent} ${REACTION_INTENTS[cause.reactionIntent]}`,
    );
  if (cause.defect !== null)
    lines.push(`이 질문이 반응한 앞 답의 결함: ${defectLine(cause.defect)}`);

  const assumption =
    question.assumption.axis === 'none'
      ? '없음(가정을 바꾸지 않은 질문)'
      : `${question.assumption.axis} ${axisName(question.assumption.axis)} 축. ${question.assumption.statement}`;
  lines.push(
    '',
    `질문 문장: ${question.text}`,
    `질문 의도: ${question.questionIntent} ${QUESTION_INTENTS[question.questionIntent]}`,
    `바뀐 가정: ${assumption}`,
    '',
    '숨은 정답지:',
    JSON.stringify(question.answerKey, null, 2),
    '',
  );
  if (input.clarifications.length > 0) {
    lines.push('답하기 전의 되묻기:');
    for (const c of input.clarifications) lines.push(`- 지원자: ${c.ask}`, `  면접관: ${c.reply}`);
    lines.push('');
  }
  lines.push('지원자의 답:', input.answer, '');

  lines.push('면접 중 분석의 결함:');
  if (input.analysis.defects.length === 0) lines.push('없음');
  input.analysis.defects.forEach((d, i) => lines.push(`[${i}] ${defectLine(d)}`));

  if (input.followUps.length > 0) {
    lines.push('', '이 답에서 나온 질문:');
    input.followUps.forEach((f, i) => {
      const addOn = f.addOn ? '덧붙이는 질문. ' : '';
      lines.push(
        `[${i}] ${addOn}면접관 ${f.interviewerId}, 반응 의도 ${f.reactionIntent} ${REACTION_INTENTS[f.reactionIntent]}, 근거로 삼은 결함 ${defectLine(f.defect)}. 질문: ${f.text}`,
      );
    });
  }

  if (question.assumption.axis !== 'none') {
    lines.push('', '같은 축의 기록된 가정:');
    if (input.knownAssumptions.length === 0) lines.push('없음');
    for (const a of input.knownAssumptions) lines.push(`- key ${a.key}: ${a.statement}`);
  }

  return { system, user: lines.join('\n') };
}

export async function reviewTurn(
  llm         ,
  input             ,
)                                                   {
  const { data, usage } = await llm.callJson            ({
    role: 'review',
    ...buildReviewPrompt(input),
    schema: REVIEW_SCHEMA,
  });
  return { data, usage };
}

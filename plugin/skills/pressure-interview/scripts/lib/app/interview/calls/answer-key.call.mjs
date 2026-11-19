// 서버판 src/interview/calls/answer-key.call.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { axisName, DEFECT_NAMES, QUESTION_INTENTS, REACTION_INTENTS, ROLES, TEMPERAMENTS } from '../catalog.mjs';
                                                  
                                                                      
import { ANSWER_KEY_SCHEMA } from './question.call.mjs';

export function buildAnswerKeyPrompt(input                )                                   {
  const system = `당신은 기술 압박 면접 패널의 면접관이 방금 낸 질문의 숨은 정답지를 쓴다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 질문은 지원자 화면에 그대로 나가고, 숨은 정답지는 면접 중에는 숨겼다가 면접이 끝난 뒤 복기에서 질문 의도와 함께 지원자에게 공개한다. 지원자는 복기에서 자기 답을 의도와 정답지에 대조하며 배운다. 면접 중에는 묻기만 하고 가르치지 않으므로, 가르칠 내용은 모두 정답지에 담는다.

## 정답지의 네 필드

정답지의 네 필드는 다음 뜻이다.
${Object.entries(ANSWER_KEY_SCHEMA.properties)
  .map(([key, field]) => `- ${key}: ${field.description}`)
  .join('\n')}

가정을 바꾸지 않는 질문이면 vanishing과 remaining은 빈 배열로 둔다. 사라지고 남는 차이는 바뀐 가정이 있어야 생기기 때문이다.

질문에는 지원자가 말하지 않은 해답 기술을 넣지 않지만, 정답지는 복기에서 공개하므로 지원자가 말하지 않은 대안 기술과 그 특징도 alternatives에 적는다. 질문에서 흘리면 안 되는 내용이 바로 정답지에 들어가야 하는 내용이다.

user 메시지의 직전 답변 결함은 분석 단계가 찾은 판정이고, 틀릴 수 있다. 질문은 그 판정대로 반응했더라도 정답지는 판정과 상관없이 사실대로 쓴다. 면접 중의 판정 오류는 복기에서 바로잡는데, 그때 기준이 되는 것이 정답지이기 때문이다.

## 정확성

숨은 정답지는 정확해야 한다. 확실하지 않은 사실은 정답지에 넣지 않는다. 정답지가 틀리면 지원자가 복기에서 잘못된 지식을 배우기 때문이다.`;

  const role = ROLES[input.interviewer.role];
  const { draft } = input;
  const answer = input.addOn ? '그 앞의 답변' : '직전 답변';
  const lines           = [
    `주제: ${input.topic}`,
    '',
    `질문한 면접관: ${role.name}${role.type === 'job' ? '(직무형)' : ''}, 성향은 ${TEMPERAMENTS[input.interviewer.temperament]}`,
    '',
  ];
  if (input.history.length > 0) {
    lines.push('지금까지의 대화:');
    input.history.forEach((h, i) => {
      const who =
        h.interviewerId === input.interviewer.id
          ? '질문한 면접관'
          : `다른 면접관(${h.interviewerId})`;
      lines.push(`[${i + 1}] ${who}: ${h.text}`, `    지원자: ${h.answer}`);
    });
    lines.push('');
  }
  if (input.reactionIntent !== null) {
    lines.push(
      `반응 의도: ${input.reactionIntent} ${REACTION_INTENTS[input.reactionIntent]}. 질문은 ${answer}에 이 의도로 반응했다.`,
    );
  }
  if (input.defect !== null) {
    const note = input.defect.note ? `. ${input.defect.note}` : '';
    lines.push(
      `${answer}의 결함: ${DEFECT_NAMES[input.defect.type]}(관련 축: ${axisName(input.defect.axis)})${note}`,
    );
  }
  if (input.addOn) {
    lines.push(
      '덧붙이는 질문이다. 다른 면접관이 먼저 물었고 지원자가 거기에 답한 뒤에 얹은 질문이라, 이 질문이 반응하는 답변은 대화 목록의 끝에서 두 번째 답변이다.',
    );
  }
  if (input.reactionIntent !== null || input.defect !== null || input.addOn) lines.push('');

  const assumption =
    draft.assumption.axis === 'none'
      ? '없음(가정을 바꾸지 않는 질문)'
      : `${draft.assumption.axis} ${axisName(draft.assumption.axis)} 축. ${draft.assumption.statement}`;
  lines.push(
    `질문 문장: ${draft.text}`,
    `질문 의도: ${draft.questionIntent} ${QUESTION_INTENTS[draft.questionIntent]}`,
    `바뀐 가정: ${assumption}`,
  );

  return { system, user: lines.join('\n') };
}

export async function writeAnswerKey(
  llm         ,
  input                ,
)                                                  {
  const { data, usage } = await llm.callJson           ({
    role: 'question',
    ...buildAnswerKeyPrompt(input),
    schema: ANSWER_KEY_SCHEMA,
  });
  return { data, usage };
}

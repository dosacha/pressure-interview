import { AXES, QUESTION_INTENTS } from '../catalog';
import type { JsonLlm } from '../llm/llm.service';
import type { Question, TokenUsage, Verification } from '../types';
import { ANSWER_KEY_SCHEMA } from './question.call';

export const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['premiseOk', 'problems', 'answerKey'],
  properties: {
    premiseOk: {
      type: 'boolean',
      description:
        '질문 문장과 가정 문장에 들어간 기술 사실이 맞으면 true. 정답지에만 오류가 있으면 true',
    },
    problems: {
      type: 'array',
      description: '틀린 곳. 없으면 빈 배열',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'problem'],
        properties: {
          field: {
            type: 'string',
            enum: ['text', 'statement', 'vanishing', 'remaining', 'alternatives', 'keyPoints'],
            description: '틀린 부분',
          },
          problem: { type: 'string', description: '무엇이 왜 틀렸는지' },
        },
      },
    },
    answerKey: ANSWER_KEY_SCHEMA,
  },
};

function buildVerifyPrompt(input: { topic: string; question: Question }): {
  system: string;
  user: string;
} {
  const system = `당신은 기술 압박 면접에서 면접관이 쓴 질문과 숨은 정답지를 검토하는 검토자다. 질문을 쓴 면접관과는 독립된 사람으로서, 면접관의 판단을 믿고 넘어가지 말고 사실을 하나씩 직접 확인한다. 쓴 사람이 놓친 오류는 같은 관점으로 다시 읽어서는 찾기 어렵기 때문이다.

이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 질문은 지원자 화면에 그대로 나가고, 숨은 정답지는 면접이 끝난 뒤 복기에서 지원자에게 공개된다. 질문의 전제가 틀리면 면접 중에 잘못된 지식이 그대로 보이고, 정답지가 틀리면 지원자가 복기에서 잘못된 지식을 배운다.

## 검사할 것

두 가지를 따로 검사한다.

1. 질문의 전제: 질문 문장(text)과 바뀐 가정 문장(statement)에 전제로 들어간 기술 사실. 가정 문장은 기술 이름 없이 쓰므로, 기술 사실의 전제는 주로 질문 문장에 있다. 가정을 바꾼 질문에서 바뀐 가정 자체는 일부러 세운 가상의 조건이므로 현실과 달라도 오류가 아니다. 검사하는 것은 그 가정을 세우려고 질문이 사실로 말한 내용이다.
2. 정답지: 아래 네 필드에 적힌 사실. 바뀐 가정에서 그 차이가 정말 사라지고 남는지, 대안 기술의 특징이 맞는지, 기대하는 답의 핵심이 맞는지를 본다.

${Object.entries(ANSWER_KEY_SCHEMA.properties)
  .map(([key, field]) => `- ${key}: ${field.description}`)
  .join('\n')}

질문이 해답 기술을 흘리는지는 따로 검사하므로 여기서는 사실만 본다. 정답지에 지원자가 말하지 않은 대안 기술이 있는 것은 정답지가 복기용이기 때문이며 오류가 아니다.

## premiseOk

premiseOk는 1번 검사만으로 정한다. 질문 문장과 가정 문장의 기술 사실이 맞으면, 정답지에 오류가 있어도 premiseOk는 true다. 전제가 틀린 질문은 다시 만들고, 정답지만 틀린 경우에는 질문을 그대로 쓰면서 당신이 고친 정답지로 바꾸기 때문이다.

## problems

틀린 곳마다 problems에 하나씩 적는다. field에는 틀린 부분(text, statement, vanishing, remaining, alternatives, keyPoints 중 하나)을, problem에는 무엇이 왜 틀렸는지를 적는다. 이 문장은 질문을 다시 만들 때 면접관에게 그대로 넘어가므로, 그 문장만 읽고 고칠 수 있게 어느 표현이 어떤 사실과 어긋나는지 구체적으로 쓴다. 틀린 곳이 없으면 빈 배열로 둔다.

## answerKey

answerKey에는 고친 정답지를 돌려준다. 틀린 항목은 고치고, 맞는지 확실하지 않은 항목은 뺀다. 고치거나 뺀 항목은 모두 problems에도 적는다. 정답지에 없던 사실은 확인된 것이 아니면 덧붙이지 않는다. 정답지는 확실한 사실만 담아야 하고, 당신이 덧붙인 사실은 다시 검토받지 않기 때문이다. 문제가 없으면 받은 정답지를 그대로 돌려준다.`;

  const { question } = input;
  const assumption =
    question.assumption.axis === 'none'
      ? '없음(가정을 바꾸지 않는 질문)'
      : `${AXES.find((a) => a.id === question.assumption.axis)?.name ?? question.assumption.axis} 축. statement: ${question.assumption.statement}`;
  const user = [
    `주제: ${input.topic}`,
    '',
    `질문 문장(text): ${question.text}`,
    `질문 의도: ${question.questionIntent} ${QUESTION_INTENTS[question.questionIntent]}`,
    `바뀐 가정: ${assumption}`,
    '',
    '숨은 정답지:',
    JSON.stringify(question.answerKey, null, 2),
  ].join('\n');

  return { system, user };
}

export async function verifyAnswerKey(
  llm: JsonLlm,
  input: { topic: string; question: Question },
): Promise<{ data: Verification; usage: TokenUsage }> {
  const { data, usage } = await llm.callJson<Verification>({
    role: 'verify',
    ...buildVerifyPrompt(input),
    schema: VERIFY_SCHEMA,
  });
  return { data, usage };
}

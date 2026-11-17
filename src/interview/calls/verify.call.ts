import { axisName, QUESTION_INTENTS } from '../catalog';
import type { JsonLlm } from '../llm/llm.service';
import type { AnswerKey, Question, TokenUsage, Verification } from '../types';
import { ANSWER_KEY_SCHEMA } from './question.call';

export interface Corrections {
  // 고친 필드만. 그 필드의 새 목록 전체
  lists: { field: 'vanishing' | 'remaining' | 'keyPoints'; items: string[] }[];
  // 바꿨으면 changed true와 새 목록 전체, 아니면 false와 빈 배열
  alternatives: { changed: boolean; items: { name: string; traits: string }[] };
}

export const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['premiseOk', 'problems', 'corrections'],
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
            enum: ['text', 'statement', ...Object.keys(ANSWER_KEY_SCHEMA.properties)],
            description: '틀린 부분',
          },
          problem: { type: 'string', description: '무엇이 왜 틀렸는지' },
        },
      },
    },
    corrections: {
      type: 'object',
      additionalProperties: false,
      required: ['lists', 'alternatives'],
      properties: {
        lists: {
          type: 'array',
          description: '고치거나 뺀 항목이 있는 목록 필드만. 없으면 빈 배열',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'items'],
            properties: {
              field: {
                type: 'string',
                enum: ['vanishing', 'remaining', 'keyPoints'],
                description: '고친 필드',
              },
              items: {
                type: 'array',
                items: { type: 'string' },
                description: '그 필드의 새 목록 전체',
              },
            },
          },
        },
        alternatives: {
          type: 'object',
          additionalProperties: false,
          required: ['changed', 'items'],
          properties: {
            changed: { type: 'boolean', description: '대안 목록을 고쳤으면 true' },
            items: {
              ...ANSWER_KEY_SCHEMA.properties.alternatives,
              description: 'changed가 true면 대안 목록 전체, false면 빈 배열',
            },
          },
        },
      },
    },
  },
};

// 고친 필드만 바꾼 새 정답지. 같은 필드가 두 번 나오면 뒤의 것을 쓴다.
export function applyCorrections(key: AnswerKey, corrections: Corrections): AnswerKey {
  const out: AnswerKey = { ...key };
  for (const { field, items } of corrections.lists) out[field] = items;
  if (corrections.alternatives.changed) out.alternatives = corrections.alternatives.items;
  return out;
}

function buildVerifyPrompt(input: { topic: string; question: Question }): {
  system: string;
  user: string;
} {
  const system = `당신은 기술 압박 면접에서 면접관이 쓴 질문과 숨은 정답지를 검토하는 검토자다. 질문을 쓴 면접관과는 독립된 사람으로서, 면접관의 판단을 믿고 넘어가지 말고 사실을 하나씩 직접 확인한다. 쓴 사람이 놓친 오류는 같은 관점으로 다시 읽어서는 찾기 어렵기 때문이다.

이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 질문은 이미 지원자 화면에 나갔고, 이 검토는 지원자가 답을 쓰는 동안 돈다. 숨은 정답지는 면접이 끝난 뒤 복기에서 지원자에게 공개된다. 정답지가 틀리면 지원자가 복기에서 잘못된 지식을 배운다. 질문의 전제가 틀렸다면 면접 중에 잘못된 지식이 이미 보였으므로, 복기에서 바로잡을 수 있게 기록으로 남긴다.

## 검사할 것

두 가지를 따로 검사한다.

1. 질문의 전제: 질문 문장(text)과 바뀐 가정 문장(statement)에 전제로 들어간 기술 사실. 가정 문장은 기술 이름 없이 쓰므로, 기술 사실의 전제는 주로 질문 문장에 있다. 가정을 바꾼 질문에서 바뀐 가정 자체는 일부러 세운 가상의 조건이므로 현실과 달라도 오류가 아니다. 검사하는 것은 그 가정을 세우려고 질문이 사실로 말한 내용이다.
2. 정답지: 아래 네 필드에 적힌 사실. 바뀐 가정에서 그 차이가 정말 사라지고 남는지, 대안 기술의 특징이 맞는지, 기대하는 답의 핵심이 맞는지를 본다.

${Object.entries(ANSWER_KEY_SCHEMA.properties)
  .map(([key, field]) => `- ${key}: ${field.description}`)
  .join('\n')}

질문이 해답 기술을 흘리는지는 따로 검사하므로 여기서는 사실만 본다. 정답지에 지원자가 말하지 않은 대안 기술이 있는 것은 정답지가 복기용이기 때문이며 오류가 아니다.

## premiseOk

premiseOk는 1번 검사만으로 정한다. 질문 문장과 가정 문장의 기술 사실이 맞으면, 정답지에 오류가 있어도 premiseOk는 true다. premiseOk와 전제에 대한 problems는 이미 나간 질문의 기록으로 남아 복기에서 쓰이고, 정답지의 오류는 아래 corrections로 따로 고치기 때문이다.

## problems

틀린 곳마다 problems에 하나씩 적는다. field에는 틀린 부분(text, statement, vanishing, remaining, alternatives, keyPoints 중 하나)을, problem에는 무엇이 왜 틀렸는지를 적는다. 전제에 대한 problem은 복기에서 쓰이는 기록이고, 정답지에 대한 problem은 무엇을 왜 고쳤는지의 기록이다. 그래서 그 문장만 읽고 무엇이 어떤 사실과 어긋나는지 알 수 있게 구체적으로 쓴다. 틀린 곳이 없으면 빈 배열로 둔다.

## corrections

corrections에는 정답지에서 고친 부분만 낸다. 틀린 항목은 고치고, 맞는지 확실하지 않은 항목은 뺀다. 고치거나 뺀 항목이 있는 필드만, 그 필드의 새 목록 전체를 낸다. vanishing, remaining, keyPoints는 lists에 field와 새 목록(items)으로 넣고, alternatives를 고쳤으면 alternatives.changed를 true로 하고 새 목록 전체를 items에 넣는다. 문제가 없는 필드는 내지 않는다. 내지 않은 필드는 받은 정답지를 그대로 쓰므로, 고치지 않은 필드까지 다시 쓰면 출력만 길어져 검토가 늦어지기 때문이다. 새 목록을 통째로 내는 것은 항목 하나만 받으면 그것이 어느 항목을 바꾼 것인지 맞춰 넣을 수 없기 때문이다. 고칠 것이 없으면 lists는 빈 배열, alternatives는 changed를 false, items를 빈 배열로 둔다.

고치거나 뺀 항목은 모두 problems에도 적는다. 정답지에 없던 사실은 확인된 것이 아니면 덧붙이지 않는다. 정답지는 확실한 사실만 담아야 하고, 당신이 덧붙인 사실은 다시 검토받지 않기 때문이다.`;

  const { question } = input;
  const assumption =
    question.assumption.axis === 'none'
      ? '없음(가정을 바꾸지 않는 질문)'
      : `${axisName(question.assumption.axis)} 축. statement: ${question.assumption.statement}`;
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
): Promise<{ data: Verification; corrected: boolean; usage: TokenUsage }> {
  const { data, usage } = await llm.callJson<{
    premiseOk: boolean;
    problems: Verification['problems'];
    corrections: Corrections;
  }>({
    role: 'verify',
    ...buildVerifyPrompt(input),
    schema: VERIFY_SCHEMA,
  });
  const { premiseOk, problems, corrections } = data;
  return {
    data: {
      premiseOk,
      problems,
      answerKey: applyCorrections(input.question.answerKey, corrections),
    },
    corrected: corrections.lists.length > 0 || corrections.alternatives.changed,
    usage,
  };
}

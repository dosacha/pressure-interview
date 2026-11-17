import { axisName } from '../catalog';
import type { JsonLlm } from '../llm/llm.service';
import type { PremiseCheck, QuestionDraft, TokenUsage } from '../types';

export const PREMISE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['premiseOk', 'problems'],
  properties: {
    premiseOk: {
      type: 'boolean',
      description: '질문 문장과 가정 문장에 들어간 기술 사실이 맞으면 true',
    },
    problems: {
      type: 'array',
      description: '틀린 곳. 없으면 빈 배열',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'problem'],
        properties: {
          field: { type: 'string', enum: ['text', 'statement'], description: '틀린 부분' },
          problem: { type: 'string', description: '무엇이 왜 틀렸는지' },
        },
      },
    },
  },
};

function buildPremisePrompt(input: { topic: string; draft: QuestionDraft }): {
  system: string;
  user: string;
} {
  const system = `당신은 기술 압박 면접에서 면접관이 쓴 질문의 전제를 검토하는 검토자다. 질문을 쓴 면접관과는 독립된 사람으로서, 면접관의 판단을 믿고 넘어가지 말고 사실을 하나씩 직접 확인한다. 쓴 사람이 놓친 오류는 같은 관점으로 다시 읽어서는 찾기 어렵기 때문이다.

이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 이 질문은 검토를 통과하면 지원자 화면에 그대로 나간다. 질문의 전제가 틀리면 면접 중에 잘못된 지식이 그대로 보인다.

## 검사할 것

질문 문장(text)과 바뀐 가정 문장(statement)에 전제로 들어간 기술 사실만 본다. 가정 문장은 기술 이름 없이 쓰므로, 기술 사실의 전제는 주로 질문 문장에 있다. 바뀐 가정 자체는 일부러 세운 가상의 조건이므로 현실과 달라도 오류가 아니다. 검사하는 것은 그 가정을 세우려고 질문이 사실로 말한 내용이다.

질문이 해답 기술을 흘리는지와 숨은 정답지가 맞는지는 따로 검사하므로 여기서는 질문의 전제만 본다.

## premiseOk

질문 문장과 가정 문장의 기술 사실이 모두 맞으면 true, 하나라도 틀리면 false다. 전제가 틀린 질문은 지원자에게 보여 주기 전에 다시 만든다.

## problems

틀린 곳마다 problems에 하나씩 적는다. field에는 틀린 부분(text, statement 중 하나)을, problem에는 무엇이 왜 틀렸는지를 적는다. 이 문장은 질문을 다시 만들 때 면접관에게 그대로 넘어가므로, 그 문장만 읽고 고칠 수 있게 어느 표현이 어떤 사실과 어긋나는지 구체적으로 쓴다. 틀린 곳이 없으면 빈 배열로 둔다.`;

  const { draft } = input;
  const assumption =
    draft.assumption.axis === 'none'
      ? '없음(가정을 바꾸지 않는 질문)'
      : `${axisName(draft.assumption.axis)} 축. statement: ${draft.assumption.statement}`;
  const user = [
    `주제: ${input.topic}`,
    '',
    `질문 문장(text): ${draft.text}`,
    `바뀐 가정: ${assumption}`,
  ].join('\n');

  return { system, user };
}

export async function checkPremise(
  llm: JsonLlm,
  input: { topic: string; draft: QuestionDraft },
): Promise<{ data: PremiseCheck; usage: TokenUsage }> {
  const { data, usage } = await llm.callJson<PremiseCheck>({
    role: 'verify',
    ...buildPremisePrompt(input),
    schema: PREMISE_SCHEMA,
  });
  return { data, usage };
}

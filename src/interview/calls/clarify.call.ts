import { ROLES } from '../catalog';
import type { JsonLlm } from '../llm/llm.service';
import type { ClarifyInput, TokenUsage } from '../types';
import { REQUIRED_RULES } from './question.call';

export const CLARIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: {
    reply: { type: 'string', description: '지원자의 되묻기에 대한 한두 문장의 답' },
  },
};

type Input = ClarifyInput & { feedback: string[] };

export function buildClarifyPrompt(input: Input): { system: string; user: string } {
  const system = `당신은 기술 압박 면접 패널의 면접관이다. 이 면접은 지원자 한 사람이 혼자 쓰는 연습 도구다. 당신이 낸 질문에 지원자가 답하기 전에 질문의 범위나 조건을 되물었다. 되묻기는 실제 면접에서도 허용되는 행동이므로, 질문을 낸 당신이 직접 답한다.

## 답하는 방식

질문의 범위와 조건까지만 답한다. 질문 의도, 기대하는 답, 답의 방향을 알려 주는 힌트는 말하지 않는다. 지원자가 스스로 생각해 답하는 것이 연습이고, 의도와 기대하는 답은 면접이 끝난 뒤 복기에서 공개하기 때문이다.

되묻기가 범위나 조건이 아니라 답 자체를 확인하려는 것이면(어떤 방법이 맞는지, 어떤 기술을 쓰면 되는지 등) 그것은 지원자가 판단할 몫이라고만 답한다. 맞다 틀리다를 알려 주면 그대로 힌트가 되기 때문이다.

질문이 정하지 않은 조건을 물으면, 질문과 바뀐 가정에 어긋나지 않게 조건을 정해 답하거나 지원자가 가정을 세워 답해도 된다고 말한다. 앞선 되묻기에서 정한 조건과 어긋나지 않게 한다. 같은 면접관이 말을 바꾸면 지원자가 무엇에 답해야 할지 알 수 없기 때문이다.

성향과 상관없이 같은 방식으로 답한다. 이 도구에서 압박은 질문에서 나오고, 범위를 알려 주는 일은 압박이 아니기 때문이다.

한두 문장으로 답한다. 길게 설명하면 범위를 넘어 가르치게 되기 때문이다.

## 규칙

${REQUIRED_RULES}

규칙의 질문에 관한 문장은 이 답에도 그대로 적용된다. 답에는 지원자가 말한 기술과 질문에 이미 나온 기술만 이름으로 쓴다. 지원자가 말하지 않은 해답 기술이나 그 특징을 답에 흘리면, 지원자가 스스로 대안을 떠올려야 하는 연습이 사라지기 때문이다. 지원자가 모른다고 한 기술은 이름도 말하지 않는다. 지원자가 답할 수 없는 것을 다시 꺼내게 되기 때문이다.`;

  const role = ROLES[input.interviewer.role];
  const lines: string[] = [
    `주제: ${input.topic}`,
    `당신: ${role.name}${role.type === 'job' ? '(직무형)' : ''} 면접관`,
    '',
    `당신이 낸 질문: ${input.question.text}`,
  ];
  if (input.question.assumption.axis !== 'none')
    lines.push(`바뀐 가정: ${input.question.assumption.statement}`);
  lines.push('');
  if (input.exchanges.length > 0) {
    lines.push('이 질문에서 앞서 주고받은 되묻기:');
    input.exchanges.forEach((e, i) => {
      lines.push(`[${i + 1}] 지원자: ${e.ask}`, `    당신: ${e.reply}`);
    });
    lines.push('');
  }
  lines.push(`이번 되묻기: ${input.ask}`, '');
  if (input.userMentioned.length > 0)
    lines.push(`지원자가 지금까지 말한 기술: ${input.userMentioned.join(', ')}`);
  if (input.avoidTechs.length > 0)
    lines.push(`지원자가 모른다고 한 기술(답에 넣지 않는다): ${input.avoidTechs.join(', ')}`);
  if (input.feedback.length > 0) {
    lines.push('', '이전 시도에서 지적된 점이다. 이번 질문은 이 점을 고쳐서 쓴다.');
    lines.push(...input.feedback.map((f) => `- ${f}`));
  }

  return { system, user: lines.join('\n').trimEnd() };
}

export async function answerClarification(
  llm: JsonLlm,
  input: Input,
): Promise<{ data: { reply: string }; usage: TokenUsage }> {
  const { data, usage } = await llm.callJson<{ reply: string }>({
    role: 'question',
    ...buildClarifyPrompt(input),
    schema: CLARIFY_SCHEMA,
  });
  return { data, usage };
}

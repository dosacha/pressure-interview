// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/interview/calls/answer-key.call.spec.ts @ aeae0dd, 도구: tools/port-app-src.mjs
import { describe, it, expect, jest } from '../../../jest-shim.mjs';
import { QUESTION_INTENTS } from '../../../../skills/pressure-interview/scripts/lib/app/interview/catalog.mjs';

import { buildAnswerKeyPrompt, writeAnswerKey } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/answer-key.call.mjs';
import { ANSWER_KEY_SCHEMA, REQUIRED_RULES } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/question.call.mjs';

const input                 = {
  topic: 'Redis',
  interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
  reactionIntent: 'B9',
  defect: { type: 'wrong', axis: 'durability', note: 'AOF 설명 오류' },
  addOn: false,
  history: [{ interviewerId: 'p2', text: '앞선 질문 문장', answer: '앞선 답 문장' }],
  draft: {
    text: '인메모리 PostgreSQL이라면 Redis와 뭐가 다를까요?',
    questionIntent: 'A7',
    assumption: { axis: 'identity_swap', statement: '디스크 없이 메모리에서만 동작한다.' },
  },
};

describe('answer-key.call', () => {
  it('정답지 프롬프트는 질문 문장, 의도, 바뀐 가정을 싣고 네 필드의 뜻을 설명한다', () => {
    const { system, user } = buildAnswerKeyPrompt(input);
    expect(user).toContain(input.draft.text);
    expect(user).toContain(`A7 ${QUESTION_INTENTS.A7}`);
    expect(user).toContain('디스크 없이 메모리에서만 동작한다.');
    expect(user).toContain('identity_swap');
    for (const [key, field] of Object.entries(ANSWER_KEY_SCHEMA.properties))
      expect(system).toContain(`- ${key}: ${field.description}`);
    expect(system).toContain('가정을 바꾸지 않는 질문이면 vanishing과 remaining은 빈 배열로 둔다.');
    const none = buildAnswerKeyPrompt({
      ...input,
      draft: { ...input.draft, assumption: { axis: 'none', statement: '' } },
    });
    expect(none.user).toContain('없음(가정을 바꾸지 않는 질문)');
  });
  it('정답지 프롬프트는 확실하지 않은 사실을 넣지 말라고 한다', () => {
    const { system } = buildAnswerKeyPrompt(input);
    expect(system).toContain('확실하지 않은 사실은 정답지에 넣지 않는다');
    expect(system).toContain('정답지는 판정과 상관없이 사실대로 쓴다');
    expect(system).toContain('alternatives');
  });
  it('정답지 프롬프트는 기술 이름 규칙과 질문을 쓰라는 지시를 싣지 않는다', () => {
    const { system, user } = buildAnswerKeyPrompt({
      ...input,
      // 질문을 쓸 때만 쓰는 값이 섞여 와도 싣지 않는다.
      ...{ userMentioned: ['숨은-언급'], avoidTechs: ['숨은-모름'], feedback: ['숨은-지적'] },
    });
    for (const line of REQUIRED_RULES.split('\n')) expect(system + user).not.toContain(line);
    expect(user).not.toContain('이번 질문:');
    for (const s of ['숨은-언급', '숨은-모름', '숨은-지적']) expect(user).not.toContain(s);
  });
  it('정답지 프롬프트는 대화, 반응 의도와 결함, 덧붙이는 질문임을 싣는다', () => {
    const plain = buildAnswerKeyPrompt(input).user;
    for (const s of ['앞선 질문 문장', '앞선 답 문장', 'B9', 'AOF 설명 오류', 'DBA', '흔드는형'])
      expect(plain).toContain(s);
    expect(plain).not.toContain('덧붙이는 질문');
    const addOn = buildAnswerKeyPrompt({ ...input, addOn: true }).user;
    expect(addOn).toContain('덧붙이는 질문');
    const order = [
      '주제: Redis',
      'DBA',
      '앞선 질문 문장',
      'B9',
      '덧붙이는 질문',
      input.draft.text,
    ].map((s) => addOn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const first = buildAnswerKeyPrompt({
      ...input,
      reactionIntent: null,
      defect: null,
      history: [],
    }).user;
    expect(first).not.toContain('지금까지의 대화');
    expect(first).not.toContain('반응 의도');
  });
  it('question 역할과 정답지 스키마로 호출한다', async () => {
    const callJson = jest
      .fn()
      .mockResolvedValue({ data: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: 'm' });
    await writeAnswerKey({ callJson }, input);
    expect(callJson).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'question', schema: ANSWER_KEY_SCHEMA }),
    );
  });
});

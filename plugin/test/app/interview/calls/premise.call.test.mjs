// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/interview/calls/premise.call.spec.ts @ aeae0dd, 도구: tools/port-app-src.mjs
import { describe, it, expect, jest } from '../../../jest-shim.mjs';

import { PREMISE_SCHEMA, checkPremise } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/premise.call.mjs';

const question           = {
  text: '인메모리 PostgreSQL이라면 Redis와 뭐가 다를까요?',
  questionIntent: 'A1',
  assumption: { axis: 'identity_swap', statement: '디스크 없이 메모리에서만 동작한다.' },
  answerKey: {
    vanishing: ['숨은-사라짐'],
    remaining: ['숨은-남음'],
    alternatives: [{ name: '숨은-대안', traits: '숨은-특징' }],
    keyPoints: ['숨은-핵심'],
  },
};

async function promptOf(draft          ) {
  const callJson = jest.fn().mockResolvedValue({
    data: { premiseOk: true, problems: [] },
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'm',
  });
  await checkPremise({ callJson }, { topic: 'Redis', draft });
  const [[req]] = callJson.mock.calls     
                                                                     
   ;
  return req;
}

describe('premise.call', () => {
  it('전제 검사 프롬프트는 정답지를 싣지 않고, 바뀐 가정 자체는 오류가 아니라고 말한다', async () => {
    // 정답지가 붙은 질문이 와도 싣지 않는다.
    const { system, user } = await promptOf(question);
    for (const hidden of ['숨은-사라짐', '숨은-남음', '숨은-대안', '숨은-특징', '숨은-핵심'])
      expect(system + user).not.toContain(hidden);
    expect(user).toContain(question.text);
    expect(user).toContain('디스크 없이 메모리에서만 동작한다.');
    expect(system).toContain('현실과 달라도 오류가 아니다');
    expect(system).toContain('그 문장만 읽고 고칠 수 있게');
  });
  it('verify 역할과 전제 검사 스키마로 호출한다', async () => {
    const req = await promptOf(question);
    expect(req.role).toBe('verify');
    expect(req.schema).toBe(PREMISE_SCHEMA);
    expect(PREMISE_SCHEMA.required).toEqual(['premiseOk', 'problems']);
    expect(PREMISE_SCHEMA.properties.problems.items.properties.field.enum).toEqual([
      'text',
      'statement',
    ]);
  });
});

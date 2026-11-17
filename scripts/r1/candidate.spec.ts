import type { JsonLlm, JsonRequest } from '../../src/interview/llm/llm.service';
import { AnswerKind, CANDIDATE_SCHEMA, writeCandidateAnswer } from './candidate';

// 요청만 본다. 응답을 만들지 않으려고 거절로 끝낸다.
async function requestOf(input: Parameters<typeof writeCandidateAnswer>[1]): Promise<JsonRequest> {
  const calls: JsonRequest[] = [];
  const llm: JsonLlm = {
    callJson(req: JsonRequest) {
      calls.push(req);
      return Promise.reject(new Error('요청만 본다'));
    },
  };
  await writeCandidateAnswer(llm, input).catch(() => undefined);
  expect(calls).toHaveLength(1);
  return calls[0];
}

const base = { topic: 'Redis', questionText: '이 가정에서 무엇이 남을까요?' };
// 종류마다 그 종류의 지시에만 있는 말
const marks: Record<AnswerKind, string> = {
  good: '왜 그런지',
  vague: '일반론',
  wrong: '확신',
  unknown: '모른다고',
};

describe('writeCandidateAnswer', () => {
  it('analyze 역할과 CANDIDATE_SCHEMA로 부른다', async () => {
    const req = await requestOf({ ...base, kind: 'good' });
    expect(req.role).toBe('analyze');
    expect(req.schema).toBe(CANDIDATE_SCHEMA);
    expect(CANDIDATE_SCHEMA.required).toEqual(['answer', 'intendedFlaw']);
    expect(CANDIDATE_SCHEMA.additionalProperties).toBe(false);
  });

  it('주제, 질문 문장, 규칙이 프롬프트에 실리고, 규칙이 없으면 규칙 줄이 없다', async () => {
    const withRule = await requestOf({
      ...base,
      kind: 'good',
      rule: '다른 기술 이름은 말하지 않는다',
    });
    expect(withRule.user).toContain('주제: Redis');
    expect(withRule.user).toContain('이 가정에서 무엇이 남을까요?');
    expect(withRule.user).toContain('지켜야 할 규칙: 다른 기술 이름은 말하지 않는다');
    const noRule = await requestOf({ ...base, kind: 'good' });
    expect(noRule.user).not.toContain('지켜야 할 규칙');
  });

  it('네 종류의 프롬프트가 서로 다르고, 종류마다 그 종류의 지시가 들어 있다', async () => {
    const kinds: AnswerKind[] = ['good', 'vague', 'wrong', 'unknown'];
    const reqs = await Promise.all(kinds.map((kind) => requestOf({ ...base, kind })));
    expect(new Set(reqs.map((r) => r.system + r.user)).size).toBe(4);
    kinds.forEach((kind, i) => {
      expect(reqs[i].user).toContain(`답의 종류: ${kind}`);
      for (const other of kinds) {
        if (other === kind) expect(reqs[i].user).toContain(marks[other]);
        else expect(reqs[i].user).not.toContain(marks[other]);
      }
    });
  });
});

import { AXES, DEFECT_NAMES, DEFECT_TYPES, OWNABLE_AXES } from '../catalog';
import { Question } from '../types';
import { ANALYZE_SCHEMA, analyzeAnswer } from './analyze.call';
import { VERIFY_SCHEMA, verifyAnswerKey } from './verify.call';
import { LEAK_SCHEMA, detectTechs } from './leak.call';
import { REQUIRED_RULES } from './question.call';

const question: Question = {
  text: '인메모리 PostgreSQL이라면 Redis와 뭐가 다를까요?',
  questionIntent: 'A1',
  assumption: { axis: 'identity_swap', statement: 'PostgreSQL이 디스크 없이 동작' },
  answerKey: {
    vanishing: ['디스크 I/O'],
    remaining: ['데이터 모델'],
    alternatives: [],
    keyPoints: ['MVCC'],
  },
};
const enumAt = (schema: object, path: string[]): unknown =>
  path.reduce<Record<string, unknown>>(
    (node, key) => node[key] as Record<string, unknown>,
    schema as Record<string, unknown>,
  ).enum;

describe('analyze / verify / leak 호출', () => {
  it('스키마 enum은 카탈로그와 같다', () => {
    expect(
      enumAt(ANALYZE_SCHEMA, ['properties', 'defects', 'items', 'properties', 'type']),
    ).toEqual(DEFECT_TYPES);
    expect(
      enumAt(ANALYZE_SCHEMA, ['properties', 'defects', 'items', 'properties', 'axis']),
    ).toEqual(OWNABLE_AXES);
    expect(enumAt(ANALYZE_SCHEMA, ['properties', 'kind'])).toEqual(['answer', 'clarify']);
    expect(enumAt(LEAK_SCHEMA, ['properties', 'techs', 'items', 'properties', 'role'])).toEqual([
      'premise',
      'solution',
      'user',
    ]);
  });
  it('세 호출은 각자 역할·스키마로 부르고 입력을 프롬프트에 싣는다', async () => {
    const callJson = jest
      .fn()
      .mockResolvedValue({ data: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: 'm' });
    await analyzeAnswer({ callJson }, { topic: 'Redis', question, answer: 'MVCC 때문에...' });
    await verifyAnswerKey({ callJson }, { topic: 'Redis', question });
    await detectTechs({ callJson }, { questionText: question.text, userMentioned: ['Redis'] });
    const reqs = callJson.mock.calls.map(
      ([req]) => req as { role: string; schema: object; user: string },
    );
    expect(reqs.map((r) => r.role)).toEqual(['analyze', 'verify', 'leak']);
    expect(reqs.map((r) => r.schema)).toEqual([ANALYZE_SCHEMA, VERIFY_SCHEMA, LEAK_SCHEMA]);
    expect(reqs[0].user).toContain('MVCC 때문에');
    expect(reqs[1].user).toContain('PostgreSQL이 디스크 없이 동작');
    expect(reqs[2].user).toContain('Redis');
  });

  const promptOf = async (call: (llm: { callJson: jest.Mock }) => Promise<unknown>) => {
    const callJson = jest
      .fn()
      .mockResolvedValue({ data: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: 'm' });
    await call({ callJson });
    const [[req]] = callJson.mock.calls as [[{ system: string; user: string }]];
    return req;
  };

  it('분석 프롬프트에 결함 유형과 소유 가능한 축이 id·이름으로 모두 있다', async () => {
    const { system, user } = await promptOf((llm) =>
      analyzeAnswer(llm, { topic: 'Redis', question, answer: 'MVCC 때문에...' }),
    );
    const prompt = `${system}\n${user}`;
    for (const id of DEFECT_TYPES) expect(prompt).toContain(`${id} ${DEFECT_NAMES[id]}`);
    for (const id of OWNABLE_AXES)
      expect(prompt).toContain(`${id} ${AXES.find((a) => a.id === id)?.name}`);
  });
  it('흘림 검사 프롬프트에 REQUIRED_RULES의 O/X 예시 네 줄이 있다', async () => {
    const { system, user } = await promptOf((llm) =>
      detectTechs(llm, { questionText: question.text, userMentioned: ['Redis'] }),
    );
    const examples = REQUIRED_RULES.split('\n').filter((line) => /^- [OX]: /.test(line));
    expect(examples).toHaveLength(4);
    for (const line of examples) expect(`${system}\n${user}`).toContain(line);
  });
  it('흘림 검사의 user 프롬프트에 지원자가 말한 기술이 실린다', async () => {
    const { user } = await promptOf((llm) =>
      detectTechs(llm, { questionText: question.text, userMentioned: ['Memcached', 'Lua'] }),
    );
    expect(user).toContain('Memcached, Lua');
  });
  it('검증 프롬프트의 user에 질문 문장과 정답지 항목이 있다', async () => {
    const { user } = await promptOf((llm) => verifyAnswerKey(llm, { topic: 'Redis', question }));
    for (const s of [question.text, '디스크 I/O', 'MVCC']) expect(user).toContain(s);
  });
});

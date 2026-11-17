import { AXES, DEFECT_NAMES, DEFECT_TYPES, OWNABLE_AXES } from '../catalog';
import { Question } from '../types';
import { ANALYZE_SCHEMA, analyzeAnswer } from './analyze.call';
import { Corrections, VERIFY_SCHEMA, applyCorrections, verifyAnswerKey } from './verify.call';
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
const NO_CORRECTIONS: Corrections = { lists: [], alternatives: { changed: false, items: [] } };
// 검증 호출은 응답에 corrections가 있어야 정답지를 맞춘다. 다른 호출은 받은 그대로 돌려준다.
const ANY_REPLY = { premiseOk: true, problems: [], corrections: NO_CORRECTIONS };
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
    const callJson = jest.fn().mockResolvedValue({
      data: ANY_REPLY,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'm',
    });
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
    const callJson = jest.fn().mockResolvedValue({
      data: ANY_REPLY,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'm',
    });
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
  it('분석 스키마는 unknownTechs를 요구한다', () => {
    expect(ANALYZE_SCHEMA.required).toContain('unknownTechs');
    expect(ANALYZE_SCHEMA.properties.unknownTechs.type).toBe('array');
  });
  it('분석의 user 프롬프트에 userMentioned를 주면 싣고, 주지 않으면 그 줄이 없다', async () => {
    const withMentioned = await promptOf((llm) =>
      analyzeAnswer(llm, {
        topic: 'Redis',
        question,
        answer: '...',
        userMentioned: ['Redis', 'Lua'],
      }),
    );
    expect(withMentioned.user).toContain('지원자가 이전까지 말한 기술: Redis, Lua');
    const without = await promptOf((llm) =>
      analyzeAnswer(llm, { topic: 'Redis', question, answer: '...' }),
    );
    expect(without.user).not.toContain('지원자가 이전까지 말한 기술');
  });
  it('검증 프롬프트의 user에 질문 문장과 정답지 항목이 있다', async () => {
    const { user } = await promptOf((llm) => verifyAnswerKey(llm, { topic: 'Redis', question }));
    for (const s of [question.text, '디스크 I/O', 'MVCC']) expect(user).toContain(s);
  });
});

const verifyWith = (data: object) => {
  const callJson = jest
    .fn()
    .mockResolvedValue({ data, usage: { input_tokens: 1, output_tokens: 2 }, model: 'm' });
  return verifyAnswerKey({ callJson }, { topic: 'Redis', question });
};

describe('정답지 검증은 고친 부분만 낸다', () => {
  it('applyCorrections는 고친 필드만 바꾸고 입력을 바꾸지 않는다', () => {
    const key = {
      vanishing: ['a'],
      remaining: ['b'],
      alternatives: [{ name: 'X', traits: 't' }],
      keyPoints: ['k'],
    };
    const out = applyCorrections(key, {
      lists: [{ field: 'keyPoints', items: ['k2'] }],
      alternatives: { changed: false, items: [] },
    });
    expect(out).toEqual({ ...key, keyPoints: ['k2'] });
    expect(key.keyPoints).toEqual(['k']);
  });
  it('alternatives.changed가 true면 대안 목록을 통째로 바꾼다. 빈 목록으로도 바꾼다', () => {
    const key = question.answerKey;
    const withAlt = { ...key, alternatives: [{ name: 'X', traits: 't' }] };
    const replaced = applyCorrections(withAlt, {
      lists: [],
      alternatives: { changed: true, items: [{ name: 'Y', traits: 'u' }] },
    });
    expect(replaced.alternatives).toEqual([{ name: 'Y', traits: 'u' }]);
    const emptied = applyCorrections(withAlt, {
      lists: [],
      alternatives: { changed: true, items: [] },
    });
    expect(emptied).toEqual({ ...withAlt, alternatives: [] });
    expect(withAlt.alternatives).toEqual([{ name: 'X', traits: 't' }]);
  });
  it('같은 필드가 lists에 두 번 나오면 뒤의 것을 쓴다', () => {
    const out = applyCorrections(question.answerKey, {
      lists: [
        { field: 'vanishing', items: ['앞'] },
        { field: 'vanishing', items: ['뒤'] },
      ],
      alternatives: { changed: false, items: [] },
    });
    expect(out.vanishing).toEqual(['뒤']);
  });
  it('검증 스키마에 answerKey가 없고 corrections가 있다', () => {
    expect(VERIFY_SCHEMA.required).toEqual(['premiseOk', 'problems', 'corrections']);
    expect(VERIFY_SCHEMA.properties).not.toHaveProperty('answerKey');
    const c = VERIFY_SCHEMA.properties.corrections;
    expect(c.required).toEqual(['lists', 'alternatives']);
    expect(c.properties.lists.items.required).toEqual(['field', 'items']);
    expect(c.properties.lists.items.properties.field.enum).toEqual([
      'vanishing',
      'remaining',
      'keyPoints',
    ]);
    expect(c.properties.alternatives.required).toEqual(['changed', 'items']);
  });
  it('verifyAnswerKey는 고친 것을 반영한 정답지와 corrected를 돌려준다', async () => {
    const fixed = await verifyWith({
      premiseOk: true,
      problems: [{ field: 'keyPoints', problem: '틀림' }],
      corrections: {
        lists: [{ field: 'keyPoints', items: ['고친 핵심'] }],
        alternatives: { changed: false, items: [] },
      },
    });
    expect(fixed.corrected).toBe(true);
    expect(fixed.data).toEqual({
      premiseOk: true,
      problems: [{ field: 'keyPoints', problem: '틀림' }],
      answerKey: { ...question.answerKey, keyPoints: ['고친 핵심'] },
    });
    expect(fixed.usage).toEqual({ input_tokens: 1, output_tokens: 2 });
    const altOnly = await verifyWith({
      premiseOk: true,
      problems: [{ field: 'alternatives', problem: '틀림' }],
      corrections: {
        lists: [],
        alternatives: { changed: true, items: [{ name: 'X', traits: 't' }] },
      },
    });
    expect(altOnly.corrected).toBe(true);
    const same = await verifyWith({ premiseOk: true, problems: [], corrections: NO_CORRECTIONS });
    expect(same.corrected).toBe(false);
    expect(same.data.answerKey).toEqual(question.answerKey);
  });
  it('원래와 같은 목록을 다시 내면 corrected는 false다', async () => {
    const r = await verifyWith({
      premiseOk: true,
      problems: [],
      corrections: {
        lists: [{ field: 'keyPoints', items: [...question.answerKey.keyPoints] }],
        alternatives: { changed: false, items: [] },
      },
    });
    expect(r.corrected).toBe(false);
  });
  it('정답지 문제 없이 전제 문제만 적히면 corrected는 false다', async () => {
    const r = await verifyWith({
      premiseOk: false,
      problems: [{ field: 'text', problem: '전제 오류' }],
      corrections: NO_CORRECTIONS,
    });
    expect(r.corrected).toBe(false);
    expect(r.data.premiseOk).toBe(false);
    expect(r.data.problems).toEqual([{ field: 'text', problem: '전제 오류' }]);
    expect(r.data.answerKey).toEqual(question.answerKey);
  });
  it('검증 프롬프트는 질문을 다시 만든다고 말하지 않는다', async () => {
    const callJson = jest.fn().mockResolvedValue({
      data: ANY_REPLY,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'm',
    });
    await verifyAnswerKey({ callJson }, { topic: 'Redis', question });
    const [[{ system }]] = callJson.mock.calls as [[{ system: string }]];
    expect(system).not.toContain('다시 만들');
    expect(system).toContain('## corrections');
    expect(system).not.toContain('## answerKey');
    expect(system).toContain(
      '그 문장만 읽고 무엇이 어떤 사실과 어긋나는지 알 수 있게 구체적으로 쓴다',
    );
  });
});

// 서버판 src/interview/calls/calls.spec.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { describe, it, expect, jest } from '../../../jest-shim.mjs';
import { AXES, SCORES, DEFECT_NAMES, DEFECT_TYPES, OWNABLE_AXES } from '../../../../skills/pressure-interview/scripts/lib/app/interview/catalog.mjs';

import { ANALYZE_SCHEMA, analyzeAnswer } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/analyze.call.mjs';
import { buildAnswerKeyPrompt } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/answer-key.call.mjs';
import { buildClarifyPrompt } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/clarify.call.mjs';
import { buildJobRolePrompt } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/job-role.call.mjs';
import { checkPremise } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/premise.call.mjs';
import { buildReviewPrompt } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/review.call.mjs';
import { VERIFY_SCHEMA, applyCorrections, verifyAnswerKey } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/verify.call.mjs';
import { LEAK_SCHEMA, detectTechs } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/leak.call.mjs';
import { REQUIRED_RULES, buildQuestionPrompt } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/question.call.mjs';

const question           = {
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
const NO_CORRECTIONS              = { lists: [], alternatives: { changed: false, items: [] } };
// 검증 호출은 응답에 corrections가 있어야 정답지를 맞춘다. 다른 호출은 받은 그대로 돌려준다.
const ANY_REPLY = { premiseOk: true, problems: [], corrections: NO_CORRECTIONS };
const enumAt = (schema        , path          )          =>
  path.reduce                         (
    (node, key) => node[key]                           ,
    schema                           ,
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
      ([req]) => req                                                  ,
    );
    expect(reqs.map((r) => r.role)).toEqual(['analyze', 'verify', 'leak']);
    expect(reqs.map((r) => r.schema)).toEqual([ANALYZE_SCHEMA, VERIFY_SCHEMA, LEAK_SCHEMA]);
    expect(reqs[0].user).toContain('MVCC 때문에');
    expect(reqs[1].user).toContain('PostgreSQL이 디스크 없이 동작');
    expect(reqs[2].user).toContain('Redis');
  });

  const promptOf = async (call                                                    ) => {
    const callJson = jest.fn().mockResolvedValue({
      data: ANY_REPLY,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'm',
    });
    await call({ callJson });
    const [[req]] = callJson.mock.calls                                        ;
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
  it('분석 스키마는 selfUnknownTechs를 요구한다', () => {
    expect(ANALYZE_SCHEMA.required).toContain('selfUnknownTechs');
    expect(ANALYZE_SCHEMA.properties.selfUnknownTechs.type).toBe('array');
  });
  it('분석 스키마가 점수와 신호를 요구한다', () => {
    expect(ANALYZE_SCHEMA.required).toContain('score');
    expect(ANALYZE_SCHEMA.required).toContain('signals');
    expect(ANALYZE_SCHEMA.properties.score.anyOf[0].enum).toEqual(SCORES);
    expect(ANALYZE_SCHEMA.properties.score.anyOf[1]).toEqual({ type: 'null' });
    expect(enumAt(ANALYZE_SCHEMA, ['properties', 'signals', 'items', 'properties', 'type'])).toEqual(['practical', 'reasoning', 'selfCorrection']);
    expect(SCORES).toEqual(['solid', 'mostly', 'unclear', 'wrong']);
  });
  it('분석 프롬프트가 점수와 신호의 정의를 그대로 싣는다', async () => {
    const { system } = await promptOf((llm) => analyzeAnswer(llm, { topic: 'Redis', question, answer: '...' }));
    for (const s of ['핵심을 맞게 말했고, 왜 그런지 원리로 설명했다', '결론은 맞지만 이유가 얕거나', '맞는 말과 틀린 말이 섞였거나', '핵심이 틀렸거나 모른다고 했다',
      '구체적인 운영 상황에서 무엇을 고르고', '아는 원리로부터 그럴듯한 답에 다가갔다', '자기 답의 틀린 곳을 찾아 고쳤다',
      '답에서 그 부분을 글자 그대로 인용', '면접관이 꺼낸 전제 기술을 모른다고 한 답은 score를 null로']) expect(system).toContain(s);
  });
  it('스스로 꺼내며 모른다고 한 기술을 따로 적게 하고 까닭을 말한다', async () => {
    const { system } = await promptOf((llm) =>
      analyzeAnswer(llm, { topic: 'Redis', question, answer: '...' }),
    );
    for (const s of [
      'selfUnknownTechs에는 질문 문장에 나오지 않았는데 지원자가 이번 입력에서 스스로 이름을 꺼내면서 써 본 적이 없다거나 모른다고 밝힌 기술을 적는다.',
      'unknownTechs와 달리 selfUnknownTechs에 기술이 있어도 defects는 평소대로 적는다.',
      '아래 unknownTechs와 selfUnknownTechs에 적은 기술은 지원자가 그 이름을 입에 올렸더라도 넣지 않는다.',
      '지원자가 이전 입력에서 이미 말한 기술이나 주제 기술에 대해 모른다고 한 것은 unknownTechs에도 selfUnknownTechs에도 넣지 않고,',
    ])
      expect(system).toContain(s);
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

const verifyWith = (data        ) => {
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
    const [[{ system }]] = callJson.mock.calls                          ;
    expect(system).not.toContain('다시 만들');
    expect(system).toContain('## corrections');
    expect(system).not.toContain('## answerKey');
    expect(system).toContain(
      '그 문장만 읽고 무엇이 어떤 사실과 어긋나는지 알 수 있게 구체적으로 쓴다',
    );
  });
});

describe('시스템 프롬프트는 입력과 무관하게 고정이다(캐시 접두)', () => {
  const systemOf = async (call                                                    ) => {
    const callJson = jest.fn().mockResolvedValue({
      data: ANY_REPLY,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'm',
    });
    await call({ callJson });
    const [[req]] = callJson.mock.calls                          ;
    return req.system;
  };
  const dba              = { id: 'p1', role: 'dba', temperament: 'shaker' };
  const textbook              = { id: 'p3', role: 'textbook', temperament: 'helper' };
  const other           = {
    text: '쓰기가 읽기보다 훨씬 많아지면 무엇이 먼저 무너질까요?',
    questionIntent: 'A8',
    assumption: { axis: 'none', statement: '' },
    answerKey: {
      vanishing: [],
      remaining: [],
      alternatives: [{ name: 'X', traits: 't' }],
      keyPoints: ['k'],
    },
  };
  const history = [{ interviewerId: 'p2', text: '앞 질문', answer: '앞 답' }];
  const qBase = {
    reactionIntent: null,
    defect: null,
    targetAxis: null,
    userMentioned: [],
    feedback: [],
  };
  const review              = {
    topic: 'Redis',
    interviewer: dba,
    cause: { reactionIntent: null, defect: null },
    question,
    clarifications: [],
    answer: '답',
    analysis: { kind: 'answer', defects: [], mentionedTechs: [] },
    followUps: [],
    knownAssumptions: [],
  };
  const clarify = {
    topic: 'Redis',
    interviewer: dba,
    question,
    questionTechs: [],
    exchanges: [],
    ask: '읽기 위주인가요?',
    userMentioned: [],
    avoidTechs: [],
    feedback: [],
  };

  const pairs                                                                 = [
    [
      '질문',
      buildQuestionPrompt({ ...qBase, topic: 'Redis', interviewer: dba, history: [] }).system,
      buildQuestionPrompt({
        ...qBase,
        topic: 'NodeJS',
        interviewer: textbook,
        history,
        reactionIntent: 'B9',
        defect: { type: 'wrong', axis: 'durability', note: 'n' },
        targetAxis: 'identity_swap',
        userMentioned: ['NodeJS'],
        feedback: ['f'],
        avoidTechs: ['Lua'],
        addOn: true,
        memory: { retired: [{ axis: 'durability', statement: 's' }], reissue: [], expected: [] },
      }).system,
    ],
    [
      '정답지 작성',
      buildAnswerKeyPrompt({
        topic: 'Redis',
        interviewer: dba,
        reactionIntent: null,
        defect: null,
        history: [],
        draft: question,
      }).system,
      buildAnswerKeyPrompt({
        topic: 'NodeJS',
        interviewer: textbook,
        reactionIntent: 'B9',
        defect: { type: 'wrong', axis: 'durability', note: 'n' },
        addOn: true,
        history,
        draft: other,
      }).system,
    ],
    [
      '전제 검사',
      systemOf((llm) => checkPremise(llm, { topic: 'Redis', draft: question })),
      systemOf((llm) => checkPremise(llm, { topic: 'NodeJS', draft: other })),
    ],
    [
      '정답지 검증',
      systemOf((llm) => verifyAnswerKey(llm, { topic: 'Redis', question })),
      systemOf((llm) => verifyAnswerKey(llm, { topic: 'NodeJS', question: other })),
    ],
    [
      '흘림 검사',
      systemOf((llm) => detectTechs(llm, { questionText: question.text, userMentioned: [] })),
      systemOf((llm) => detectTechs(llm, { questionText: other.text, userMentioned: ['Lua'] })),
    ],
    [
      '답 분석',
      systemOf((llm) => analyzeAnswer(llm, { topic: 'Redis', question, answer: '답 하나' })),
      systemOf((llm) =>
        analyzeAnswer(llm, {
          topic: 'NodeJS',
          question: other,
          answer: '답 둘',
          userMentioned: ['NodeJS'],
        }),
      ),
    ],
    [
      '되묻기 응답',
      buildClarifyPrompt(clarify).system,
      buildClarifyPrompt({
        ...clarify,
        topic: 'NodeJS',
        interviewer: textbook,
        question: other,
        questionTechs: [{ name: 'NodeJS', role: 'user' }],
        exchanges: [{ ask: 'a', reply: 'r' }],
        ask: '다른 되묻기',
        userMentioned: ['NodeJS'],
        avoidTechs: ['Lua'],
        feedback: ['f'],
      }).system,
    ],
    ['직무 고르기', buildJobRolePrompt('Redis').system, buildJobRolePrompt('NodeJS').system],
    [
      '복기',
      buildReviewPrompt(review).system,
      buildReviewPrompt({
        ...review,
        topic: 'NodeJS',
        interviewer: textbook,
        cause: { reactionIntent: 'B6', defect: { type: 'vague', axis: 'scale', note: 'n' } },
        question: other,
        clarifications: [{ ask: 'a', reply: 'r' }],
        answer: '다른 답',
        analysis: {
          kind: 'answer',
          defects: [{ type: 'wrong', axis: 'durability', note: 'n' }],
          mentionedTechs: ['NodeJS'],
        },
        followUps: [
          {
            interviewerId: 'p2',
            addOn: false,
            reactionIntent: 'B8',
            defect: { type: 'wrong', axis: 'durability', note: 'n' },
            text: '후속',
          },
        ],
        knownAssumptions: [{ key: 'turn:t1', statement: '앞선 가정' }],
      }).system,
    ],
  ];

  it.each(pairs)('%s', async (_name, a, b) => {
    expect(await b).toBe(await a);
  });
});

import { join } from 'path';
import { AXES, ROLES, TEMPERAMENTS } from '../../src/interview/catalog';
import { JsonLlm, JsonRequest, RefusalError } from '../../src/interview/llm/llm.service';
import type {
  AnswerInput,
  AnswerResult,
  Pick as EnginePick,
  PreparedQuestion,
  Question,
  QuestionInput,
  Verification,
} from '../../src/interview/types';
import { AnswerKind, CANDIDATE_SCHEMA } from './candidate';
import { readScenarios, runScenarios, Scenario } from './run';

const question = (axis: Question['assumption']['axis'], text: string): Question => ({
  text,
  questionIntent: 'A1',
  assumption: { axis, statement: 's' },
  answerKey: { vanishing: [], remaining: [], alternatives: [], keyPoints: ['k'] },
});
const prepared = (axis: Question['assumption']['axis'], text: string): PreparedQuestion => ({
  question: question(axis, text),
  verification: null,
  answerKeyCorrected: false,
  flags: { leak: false, premise: false },
  attempts: [],
  usage: [{ input_tokens: 1, output_tokens: 1 }],
});
const pick: EnginePick = {
  interviewerId: 'p2',
  defect: { type: 'wrong', axis: 'durability', note: 'n' },
  reactionIntent: 'B6',
  secondary: null,
};
const answered = (p: EnginePick | null): AnswerResult => ({
  analysis: { kind: 'answer', defects: [], mentionedTechs: ['List'] },
  pick: p,
  userMentioned: ['Redis', 'List'],
  usage: [{ input_tokens: 2, output_tokens: 2 }],
  unknownTechs: [],
});
const scenario = (id: string, kinds: AnswerKind[]): Scenario => ({
  id,
  topic: 'Redis',
  panel: [
    { id: 'p1', role: 'dba', temperament: 'shaker' },
    { id: 'p2', role: 'textbook', temperament: 'persistent' },
  ],
  first: { interviewerId: 'p1', targetAxis: 'identity_swap' },
  answers: kinds.map((kind) => ({ kind })),
});
const lateVerification: Verification = {
  premiseOk: true,
  problems: [],
  answerKey: { vanishing: [], remaining: [], alternatives: [], keyPoints: ['late'] },
};

// 가짜 llm은 스키마로 지원자 답 호출과 사후 검증 호출을 가른다.
// 지원자 답 n번째 호출은 '생성된 답 n'과 '결함 n'을 돌려주고, candidateFailAt번째 호출은 던진다.
function fakes(
  opts: { verifyError?: Error; verification?: Verification; candidateFailAt?: number } = {},
) {
  const prepareQuestion = jest.fn<Promise<PreparedQuestion>, [QuestionInput]>();
  const handleAnswer = jest.fn<Promise<AnswerResult>, [AnswerInput]>();
  const verifyCalls: JsonRequest[] = [];
  const candidateCalls: JsonRequest[] = [];
  const logs: string[] = [];
  const llm: JsonLlm = {
    callJson<T>(req: JsonRequest) {
      let data: unknown;
      let usage = { input_tokens: 5, output_tokens: 5 };
      if (req.schema === CANDIDATE_SCHEMA) {
        candidateCalls.push(req);
        const n = candidateCalls.length;
        if (n === opts.candidateFailAt) return Promise.reject(new Error('답 생성 실패'));
        data = { answer: `생성된 답 ${n}`, intendedFlaw: `결함 ${n}` };
        usage = { input_tokens: 7, output_tokens: 7 };
      } else {
        verifyCalls.push(req);
        if (opts.verifyError) return Promise.reject(opts.verifyError);
        data = opts.verification ?? lateVerification;
      }
      return Promise.resolve({ data: data as T, usage, model: 'm' });
    },
  };
  const deps = { turn: { prepareQuestion, handleAnswer }, llm, log: (l: string) => logs.push(l) };
  return { deps, prepareQuestion, handleAnswer, verifyCalls, candidateCalls, logs };
}

describe('runScenarios', () => {
  it('거절로 실패한 시나리오는 error를 남기고, 다음 시나리오는 끝까지 돈다', async () => {
    const f = fakes();
    f.prepareQuestion
      .mockRejectedValueOnce(new RefusalError('cyber'))
      .mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [a, b] = await runScenarios(f.deps, [
      scenario('a', ['good']),
      scenario('b', ['good', 'vague']),
    ]);
    expect(a.error).toBe('refusal: cyber');
    expect(a.first).toBeNull();
    expect(b.error).toBeNull();
    expect(b.followUps).toHaveLength(2);
  });

  it('답 처리 중 오류가 나면 첫 질문과 끝난 후속은 남기고 error에 메시지를 넣는다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValueOnce(answered(pick)).mockRejectedValueOnce(new Error('boom'));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good', 'vague', 'wrong'])]);
    expect(r.first?.prepared.question.text).toBe('Q');
    expect(r.followUps).toHaveLength(1);
    expect(r.error).toBe('boom');
    expect(r.usage.length).toBeGreaterThan(0);
    // 첫 질문 1 + 답 1의 답 생성 1·분석 1·후속 질문 1 + 답 2의 답 생성 1. 실패한 답 2의 분석은 사용량이 없다.
    expect(r.usage).toHaveLength(5);
  });

  it('후속 질문 생성이 실패해도 그 답의 analysis와 pick은 남는다', async () => {
    const f = fakes();
    f.prepareQuestion
      .mockResolvedValueOnce(prepared('identity_swap', 'Q'))
      .mockRejectedValueOnce(new Error('후속 실패'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good', 'vague'])]);
    expect(r.error).toBe('후속 실패');
    expect(r.followUps).toHaveLength(1);
    expect(r.followUps[0].analysis.mentionedTechs).toEqual(['List']);
    expect(r.followUps[0].pick).toEqual(pick);
    expect(r.followUps[0].next).toBeNull();
  });

  it('사후 검증이 실패해도 첫 질문의 prepared는 남는다', async () => {
    const f = fakes({ verifyError: new Error('검증 실패') });
    f.prepareQuestion.mockResolvedValue(prepared('none', '기본 질문'));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good'])]);
    expect(r.error).toBe('검증 실패');
    expect(r.first?.prepared.question.text).toBe('기본 질문');
    expect(r.first?.lateVerification).toBeNull();
    expect(f.logs).toContain('[a] 첫 질문 사후 검증');
  });

  it('후속 질문의 입력을 pick과 handleAnswer 결과로 조립한다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', '첫 질문'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good'])]);
    expect(r.first?.askedBy).toBe('p1');
    expect(r.followUps[0].next?.askedBy).toBe('p2');
    expect(f.handleAnswer.mock.calls[0][0]).toMatchObject({
      history: ['p1'],
      askedBy: 'p1',
      answer: '생성된 답 1',
      userMentioned: ['Redis'],
    });
    const next = f.prepareQuestion.mock.calls[1][0];
    expect(next.interviewer).toEqual({ id: 'p2', role: 'textbook', temperament: 'persistent' });
    expect(next.reactionIntent).toBe('B6');
    expect(next.defect).toEqual(pick.defect);
    expect(next.targetAxis).toBeNull();
    expect(next.history).toEqual([{ interviewerId: 'p1', text: '첫 질문', answer: '생성된 답 1' }]);
    expect(next.userMentioned).toEqual(['Redis', 'List']);
  });

  it('후속 질문에 모른다고 한 기술을 avoidTechs로 넘긴다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', '첫 질문'));
    f.handleAnswer.mockResolvedValue({ ...answered(pick), unknownTechs: ['Memcached'] });
    await runScenarios(f.deps, [scenario('a', ['unknown'])]);
    expect(f.prepareQuestion.mock.calls[0][0].avoidTechs).toBeUndefined();
    expect(f.prepareQuestion.mock.calls[1][0].avoidTechs).toEqual(['Memcached']);
  });

  it('가정이 없는 질문에서만 lateVerification을 채운다', async () => {
    const f = fakes();
    f.prepareQuestion
      .mockResolvedValueOnce(prepared('none', '기본 질문'))
      .mockResolvedValueOnce(prepared('identity_swap', '가정 질문'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good'])]);
    expect(r.first?.lateVerification).toEqual(lateVerification);
    expect(r.followUps[0].next?.lateVerification).toBeNull();
    expect(f.verifyCalls.map((c) => c.role)).toEqual(['verify']);
    expect(r.usage).toContainEqual({ input_tokens: 5, output_tokens: 5 });
  });

  it('pick이 null이면 next가 null이고 후속 질문을 만들지 않는다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValue(answered(null));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good'])]);
    expect(r.followUps[0].next).toBeNull();
    expect(f.prepareQuestion).toHaveBeenCalledTimes(1);
  });

  it('거절의 category가 null이면 카테고리 없음으로 적는다', async () => {
    const f = fakes();
    f.prepareQuestion.mockRejectedValueOnce(new RefusalError(null));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good'])]);
    expect(r.error).toBe('refusal: 카테고리 없음');
  });

  it('지정한 축을 step에 남기고, 전체 답 수를 결과에 남긴다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good', 'vague'])]);
    expect(r.first?.targetAxis).toBe('identity_swap');
    expect(r.followUps[0].next?.targetAxis).toBeNull();
    expect(r.answerCount).toBe(2);
  });

  it('사후 검증이 정답지를 고치면 그 뒤의 handleAnswer는 고친 정답지를 받는다', async () => {
    const fixed = { vanishing: [], remaining: [], alternatives: [], keyPoints: ['고침'] };
    const corrected: Verification = {
      premiseOk: true,
      problems: [{ field: 'keyPoints', problem: '틀림' }],
      answerKey: fixed,
    };
    const f = fakes({ verification: corrected });
    const first = prepared('none', '기본 질문');
    f.prepareQuestion.mockResolvedValue(first);
    f.handleAnswer.mockResolvedValue(answered(null));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good', 'vague'])]);
    for (const [call] of f.handleAnswer.mock.calls) {
      expect(call.question.answerKey).toEqual(fixed);
      expect(call.question.text).toBe('기본 질문');
    }
    expect(f.handleAnswer).toHaveBeenCalledTimes(2);
    expect(r.first?.prepared.question.answerKey.keyPoints).toEqual(['k']);
    // 정답지가 고쳐져도 지원자에게 주는 질문 문장은 같다.
    expect(f.candidateCalls).toHaveLength(2);
    for (const c of f.candidateCalls) expect(c.user).toContain('기본 질문');
  });

  it('답마다 지원자 답을 먼저 생성하고, 그 답 문장만 엔진에 넘기며 intendedFlaw는 followUps에만 남긴다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', '첫 질문'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good', 'wrong'])]);
    expect(f.candidateCalls.map((c) => c.role)).toEqual(['analyze', 'analyze']);
    expect(f.candidateCalls[0].user).toContain('첫 질문');
    expect(f.candidateCalls[0].user).toContain('답의 종류: good');
    expect(f.candidateCalls[1].user).toContain('답의 종류: wrong');
    expect(f.logs.indexOf('[a] 답 1/2 (good) 답 생성')).toBeGreaterThanOrEqual(0);
    expect(f.logs.indexOf('[a] 답 1/2 (good) 답 생성')).toBeLessThan(
      f.logs.indexOf('[a] 답 1/2 (good) 분석'),
    );
    expect(r.followUps.map((u) => [u.answerKind, u.answer, u.intendedFlaw])).toEqual([
      ['good', '생성된 답 1', '결함 1'],
      ['wrong', '생성된 답 2', '결함 2'],
    ]);
    expect(f.handleAnswer.mock.calls.map(([c]) => c.answer)).toEqual([
      '생성된 답 1',
      '생성된 답 2',
    ]);
    expect(f.prepareQuestion.mock.calls.slice(1).map(([c]) => c.history)).toEqual([
      [{ interviewerId: 'p1', text: '첫 질문', answer: '생성된 답 1' }],
      [{ interviewerId: 'p1', text: '첫 질문', answer: '생성된 답 2' }],
    ]);
    const engineInputs = JSON.stringify([f.handleAnswer.mock.calls, f.prepareQuestion.mock.calls]);
    expect(engineInputs).not.toContain('결함 1');
    expect(engineInputs).not.toContain('결함 2');
    expect(r.usage).toContainEqual({ input_tokens: 7, output_tokens: 7 });
    // 첫 질문 1 + 답마다 답 생성 1·분석 1·후속 질문 1
    expect(r.usage).toHaveLength(7);
  });

  it('candidateRule을 지원자 답 호출에 넘기고, 없으면 넘기지 않는다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValue(answered(null));
    await runScenarios(f.deps, [
      { ...scenario('a', ['good']), candidateRule: '다른 기술 이름은 말하지 않는다' },
      scenario('b', ['good']),
    ]);
    expect(f.candidateCalls[0].user).toContain('다른 기술 이름은 말하지 않는다');
    expect(f.candidateCalls[1].user).not.toContain('다른 기술 이름은 말하지 않는다');
  });

  it('지원자 답 호출이 던지면 first와 끝난 followUps를 남기고 error를 채운다', async () => {
    const f = fakes({ candidateFailAt: 2 });
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['good', 'vague', 'wrong'])]);
    expect(r.first?.prepared.question.text).toBe('Q');
    expect(r.followUps).toHaveLength(1);
    expect(r.followUps[0].answer).toBe('생성된 답 1');
    expect(r.error).toBe('답 생성 실패');
    expect(f.handleAnswer).toHaveBeenCalledTimes(1);
  });
});

describe('scenarios.json', () => {
  const scenarios = readScenarios(join(__dirname, 'scenarios.json'));
  // 계획 표: 패널(직무/성향), 첫 질문자 직무와 축, 답 종류
  const expected: Record<string, { panel: string[]; first: string; answers: string[] }> = {
    'redis-identity': {
      panel: ['dba/shaker', 'textbook/persistent', 'scenario/helper'],
      first: 'dba/identity_swap',
      answers: ['good', 'vague', 'wrong', 'unknown'],
    },
    'redis-queue': {
      panel: ['architect/persistent', 'dba/helper', 'scenario/shaker'],
      first: 'architect/tech_swap',
      answers: ['good', 'vague'],
    },
    'node-premise': {
      panel: ['textbook/shaker', 'scenario/persistent', 'security/helper'],
      first: 'textbook/cs_premise',
      answers: ['good', 'wrong'],
    },
  };

  const topics: Record<string, string> = {
    'redis-identity': 'Redis',
    'redis-queue': 'Redis',
    'node-premise': 'NodeJS',
  };

  it('표와 맞는다', () => {
    expect(scenarios.map((s) => s.id)).toEqual(Object.keys(expected));
    for (const s of scenarios) {
      expect(s.panel.map((m) => m.id)).toEqual(['p1', 'p2', 'p3']);
      for (const m of s.panel) {
        expect(Object.keys(ROLES)).toContain(m.role);
        expect(Object.keys(TEMPERAMENTS)).toContain(m.temperament);
      }
      expect(s.panel.map((m) => `${m.role}/${m.temperament}`)).toEqual(expected[s.id].panel);
      const asker = s.panel.find((m) => m.id === s.first.interviewerId);
      expect(asker).toBeDefined();
      expect(AXES.map((a) => a.id)).toContain(s.first.targetAxis);
      expect(`${asker?.role}/${s.first.targetAxis}`).toBe(expected[s.id].first);
      expect(s.answers.map((a) => a.kind)).toEqual(expected[s.id].answers);
      expect(s.topic).toBe(topics[s.id]);
      // 답 문장은 실행 때 만든다. 시나리오에는 종류만 둔다.
      for (const a of s.answers) expect(Object.keys(a)).toEqual(['kind']);
    }
  });

  it('candidateRule은 redis-queue에만 있다', () => {
    expect(scenarios.filter((s) => s.candidateRule !== undefined).map((s) => s.id)).toEqual([
      'redis-queue',
    ]);
    expect(scenarios.find((s) => s.id === 'redis-queue')?.candidateRule?.length).toBeGreaterThan(0);
  });
});

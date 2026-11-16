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
});
const scenario = (id: string, answers: string[]): Scenario => ({
  id,
  topic: 'Redis',
  panel: [
    { id: 'p1', role: 'dba', temperament: 'shaker' },
    { id: 'p2', role: 'textbook', temperament: 'persistent' },
  ],
  first: { interviewerId: 'p1', targetAxis: 'identity_swap' },
  answers: answers.map((text) => ({ kind: 'good', text })),
});
const lateVerification: Verification = {
  premiseOk: true,
  problems: [],
  answerKey: { vanishing: [], remaining: [], alternatives: [], keyPoints: ['late'] },
};

function fakes(verifyError?: Error) {
  const prepareQuestion = jest.fn<Promise<PreparedQuestion>, [QuestionInput]>();
  const handleAnswer = jest.fn<Promise<AnswerResult>, [AnswerInput]>();
  const verifyCalls: JsonRequest[] = [];
  const logs: string[] = [];
  const llm: JsonLlm = {
    callJson<T>(req: JsonRequest) {
      verifyCalls.push(req);
      if (verifyError) return Promise.reject(verifyError);
      const data: unknown = lateVerification;
      return Promise.resolve({
        data: data as T,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'm',
      });
    },
  };
  const deps = { turn: { prepareQuestion, handleAnswer }, llm, log: (l: string) => logs.push(l) };
  return { deps, prepareQuestion, handleAnswer, verifyCalls, logs };
}

describe('runScenarios', () => {
  it('거절로 실패한 시나리오는 error를 남기고, 다음 시나리오는 끝까지 돈다', async () => {
    const f = fakes();
    f.prepareQuestion
      .mockRejectedValueOnce(new RefusalError('cyber'))
      .mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [a, b] = await runScenarios(f.deps, [scenario('a', ['x']), scenario('b', ['x', 'y'])]);
    expect(a.error).toBe('refusal: cyber');
    expect(a.first).toBeNull();
    expect(b.error).toBeNull();
    expect(b.followUps).toHaveLength(2);
  });

  it('답 처리 중 오류가 나면 첫 질문과 끝난 후속은 남기고 error에 메시지를 넣는다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValueOnce(answered(pick)).mockRejectedValueOnce(new Error('boom'));
    const [r] = await runScenarios(f.deps, [scenario('a', ['x', 'y', 'z'])]);
    expect(r.first?.prepared.question.text).toBe('Q');
    expect(r.followUps).toHaveLength(1);
    expect(r.error).toBe('boom');
    expect(r.usage.length).toBeGreaterThan(0);
  });

  it('후속 질문 생성이 실패해도 그 답의 analysis와 pick은 남는다', async () => {
    const f = fakes();
    f.prepareQuestion
      .mockResolvedValueOnce(prepared('identity_swap', 'Q'))
      .mockRejectedValueOnce(new Error('후속 실패'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['x', 'y'])]);
    expect(r.error).toBe('후속 실패');
    expect(r.followUps).toHaveLength(1);
    expect(r.followUps[0].analysis.mentionedTechs).toEqual(['List']);
    expect(r.followUps[0].pick).toEqual(pick);
    expect(r.followUps[0].next).toBeNull();
  });

  it('사후 검증이 실패해도 첫 질문의 prepared는 남는다', async () => {
    const f = fakes(new Error('검증 실패'));
    f.prepareQuestion.mockResolvedValue(prepared('none', '기본 질문'));
    const [r] = await runScenarios(f.deps, [scenario('a', ['x'])]);
    expect(r.error).toBe('검증 실패');
    expect(r.first?.prepared.question.text).toBe('기본 질문');
    expect(r.first?.lateVerification).toBeNull();
    expect(f.logs).toContain('[a] 첫 질문 사후 검증');
  });

  it('후속 질문의 입력을 pick과 handleAnswer 결과로 조립한다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', '첫 질문'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['지원자 답'])]);
    expect(r.first?.askedBy).toBe('p1');
    expect(r.followUps[0].next?.askedBy).toBe('p2');
    expect(f.handleAnswer.mock.calls[0][0]).toMatchObject({
      history: ['p1'],
      askedBy: 'p1',
      answer: '지원자 답',
      userMentioned: ['Redis'],
    });
    const next = f.prepareQuestion.mock.calls[1][0];
    expect(next.interviewer).toEqual({ id: 'p2', role: 'textbook', temperament: 'persistent' });
    expect(next.reactionIntent).toBe('B6');
    expect(next.defect).toEqual(pick.defect);
    expect(next.targetAxis).toBeNull();
    expect(next.history).toEqual([{ interviewerId: 'p1', text: '첫 질문', answer: '지원자 답' }]);
    expect(next.userMentioned).toEqual(['Redis', 'List']);
  });

  it('가정이 없는 질문에서만 lateVerification을 채운다', async () => {
    const f = fakes();
    f.prepareQuestion
      .mockResolvedValueOnce(prepared('none', '기본 질문'))
      .mockResolvedValueOnce(prepared('identity_swap', '가정 질문'));
    f.handleAnswer.mockResolvedValue(answered(pick));
    const [r] = await runScenarios(f.deps, [scenario('a', ['x'])]);
    expect(r.first?.lateVerification).toEqual(lateVerification);
    expect(r.followUps[0].next?.lateVerification).toBeNull();
    expect(f.verifyCalls.map((c) => c.role)).toEqual(['verify']);
    expect(r.usage).toContainEqual({ input_tokens: 5, output_tokens: 5 });
  });

  it('pick이 null이면 next가 null이고 후속 질문을 만들지 않는다', async () => {
    const f = fakes();
    f.prepareQuestion.mockResolvedValue(prepared('identity_swap', 'Q'));
    f.handleAnswer.mockResolvedValue(answered(null));
    const [r] = await runScenarios(f.deps, [scenario('a', ['x'])]);
    expect(r.followUps[0].next).toBeNull();
    expect(f.prepareQuestion).toHaveBeenCalledTimes(1);
  });
});

describe('scenarios.json', () => {
  const scenarios = readScenarios(join(__dirname, 'scenarios.json'));
  // 계획 표: 패널(직무/성향), 첫 질문자 직무와 축, 답 종류
  const expected: Record<string, { panel: string[]; first: string; answers: string[] }> = {
    'redis-identity': {
      panel: ['dba/shaker', 'textbook/persistent', 'scenario/helper'],
      first: 'dba/identity_swap',
      answers: ['good', 'vague', 'wrong'],
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
      for (const a of s.answers) expect(a.text.length).toBeGreaterThan(0);
    }
  });
});

import { Test } from '@nestjs/testing';
import { engineConfig, readEngineConfig } from '../config/engine.config';
import { LlmService } from './llm/llm.service';
import { TurnService } from './turn.service';
import {
  AnswerKey,
  AnswerKeyInput,
  ClarifyInput,
  PanelMember,
  Question,
  QuestionDraft,
  QuestionInput,
  ReviewInput,
  TurnReview,
} from './types';

// 같은 역할을 쓰는 호출은 스키마 required로 가른다(되묻기 응답과 정답지는 question, 직무 고르기는 analyze,
// 전제 검사는 verify 역할). 검증의 required에도 premiseOk가 있으므로 corrections를 먼저 본다.
const KIND_BY_REQUIRED: [string, string][] = [
  ['reply', 'clarify'],
  ['role', 'jobRole'],
  ['keyPoints', 'answerKey'],
  ['corrections', 'verify'],
  ['premiseOk', 'premise'],
];
type Req = { role: string; user: string; schema: { required?: string[] } };

// 호출 종류별 응답 큐를 차례로 돌려주는 가짜 LlmService
function fakeLlm(queues: Record<string, unknown[]>) {
  const calls: (Req & { kind: string })[] = [];
  const callJson = (req: Req) => {
    const kind =
      KIND_BY_REQUIRED.find(([key]) => req.schema.required?.includes(key))?.[1] ?? req.role;
    calls.push({ ...req, kind });
    return Promise.resolve({
      data: queues[kind].shift(),
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'm',
    });
  };
  return { calls, llm: { callJson } };
}
async function service(queues: Record<string, unknown[]>) {
  const fake = fakeLlm(queues);
  const mod = await Test.createTestingModule({
    providers: [
      TurnService,
      { provide: LlmService, useValue: fake.llm },
      { provide: engineConfig.KEY, useValue: readEngineConfig({}) },
    ],
  }).compile();
  return { turn: mod.get(TurnService), calls: fake.calls };
}
const key = (keyPoints: string[] = ['k']): AnswerKey => ({
  vanishing: [],
  remaining: [],
  alternatives: [],
  keyPoints,
});
const d = (axis: QuestionDraft['assumption']['axis'], text = 'Q'): QuestionDraft => ({
  text,
  questionIntent: 'A1',
  assumption: { axis, statement: 's' },
});
const q = (axis: Question['assumption']['axis'], text = 'Q'): Question => ({
  ...d(axis, text),
  answerKey: key(),
});
const OK = { premiseOk: true, problems: [] };
const NO_CORRECTIONS = { lists: [], alternatives: { changed: false, items: [] } };
const base: QuestionInput = {
  topic: 'Redis',
  interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
  reactionIntent: null,
  defect: null,
  targetAxis: null,
  history: [],
  userMentioned: ['Redis'],
  feedback: [],
};
const panel: PanelMember[] = [
  { id: 'p1', role: 'dba', temperament: 'shaker' },
  { id: 'p2', role: 'textbook', temperament: 'persistent' },
];

describe('TurnService.prepareDraft', () => {
  it('이름 위반이면 피드백을 붙여 한 번 다시 만든다', async () => {
    const { turn, calls } = await service({
      question: [d('none', 'Kafka는요?'), d('none', '다른 대안은요?')],
      leak: [{ techs: [{ name: 'Kafka', role: 'solution' }] }, { techs: [] }],
    });
    const r = await turn.prepareDraft(base);
    expect(r.draft.text).toBe('다른 대안은요?');
    expect(calls[2].user).toContain('Kafka');
    expect(r.flags.leak).toBe(false);
  });
  it('이름 위반이 끝까지 남으면 flags.leak이고, 걸린 시도는 전제를 검사하지 않는다', async () => {
    const leaked = { techs: [{ name: 'Kafka', role: 'solution' }] };
    const { turn, calls } = await service({
      question: [d('identity_swap', 'Kafka는요?'), d('identity_swap', 'Kafka는요?')],
      leak: [leaked, leaked],
    });
    const r = await turn.prepareDraft(base);
    expect(r.flags.leak).toBe(true);
    expect(r.premise).toBeNull();
    expect(calls.map((c) => c.kind)).toEqual(['question', 'leak', 'question', 'leak']);
    expect(r.attempts).toHaveLength(2);
  });
  it('prepareDraft는 가정을 바꾼 질문에서만 전제를 검사한다', async () => {
    const none = await service({ question: [d('none')], leak: [{ techs: [] }] });
    const r = await none.turn.prepareDraft(base);
    expect(none.calls.filter((c) => c.kind === 'premise')).toHaveLength(0);
    expect(r.premise).toBeNull();
    expect(r.attempts[0].premise).toBeNull();
    expect(r.flags.premise).toBe(false);

    const swap = await service({
      question: [d('identity_swap')],
      leak: [{ techs: [] }],
      premise: [OK],
    });
    const s = await swap.turn.prepareDraft(base);
    expect(swap.calls.map((c) => c.kind)).toEqual(['question', 'leak', 'premise']);
    expect(swap.calls[2].role).toBe('verify');
    expect(s.premise).toEqual(OK);
    expect(s.draft).toEqual(d('identity_swap'));
  });
  it('prepareDraft는 전제가 틀리면 그 문제를 피드백으로 다시 만든다', async () => {
    const bad = { premiseOk: false, problems: [{ field: 'text', problem: '전제 오류 문장' }] };
    const { turn, calls } = await service({
      question: [d('identity_swap', '첫 시도'), d('identity_swap', '둘째 시도')],
      leak: [{ techs: [] }, { techs: [] }],
      premise: [bad, OK],
    });
    const r = await turn.prepareDraft(base);
    const questionCalls = calls.filter((c) => c.kind === 'question');
    expect(questionCalls[1].user).toContain('전제 오류 문장');
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts.map((a) => a.premise)).toEqual([bad, OK]);
    expect(r.draft.text).toBe('둘째 시도');
    expect(r.flags.premise).toBe(false);
  });
  it('전제가 끝까지 틀리면 flags.premise', async () => {
    const bad = { premiseOk: false, problems: [{ field: 'text', problem: '전제 오류' }] };
    const { turn, calls } = await service({
      question: [d('identity_swap'), d('identity_swap')],
      leak: [{ techs: [] }, { techs: [] }],
      premise: [bad, bad],
    });
    const r = await turn.prepareDraft(base);
    expect(calls[3].user).toContain('전제 오류');
    expect(r.flags.premise).toBe(true);
    expect(r.premise).toEqual(bad);
  });
  it('prepareDraft는 이름 위반이면 전제를 검사하지 않고 다시 만든다', async () => {
    const { turn, calls } = await service({
      question: [d('identity_swap', 'Kafka라면요?'), d('identity_swap', '재시작하면요?')],
      leak: [{ techs: [{ name: 'Kafka', role: 'solution' }] }, { techs: [] }],
      premise: [OK],
    });
    const r = await turn.prepareDraft(base);
    expect(calls.map((c) => c.kind)).toEqual(['question', 'leak', 'question', 'leak', 'premise']);
    expect(r.attempts.map((a) => a.premise)).toEqual([null, OK]);
  });
  it('prepareDraft는 정답지 호출과 검증 호출을 하지 않는다', async () => {
    const { turn, calls } = await service({
      question: [d('identity_swap'), d('none')],
      leak: [{ techs: [] }, { techs: [] }],
      premise: [OK],
    });
    await turn.prepareDraft(base);
    await turn.prepareDraft(base);
    const kinds = calls.map((c) => c.kind);
    expect(kinds).toEqual(['question', 'leak', 'premise', 'question', 'leak']);
    expect(kinds).not.toContain('answerKey');
    expect(kinds).not.toContain('verify');
  });
  it('가정 없는 질문에서 premise로 붙은, 지원자가 말하지 않은 기술은 위반이라 다시 만든다', async () => {
    const { turn, calls } = await service({
      question: [d('none', 'Kafka와 비교하면요?'), d('none', '다른 대안은요?')],
      leak: [{ techs: [{ name: 'Kafka', role: 'premise' }] }, { techs: [] }],
    });
    const r = await turn.prepareDraft(base);
    expect(r.attempts[0].naming).toEqual({ ok: false, violations: ['Kafka'], avoided: [] });
    expect(calls[2].user).toContain('Kafka');
    expect(r.draft.text).toBe('다른 대안은요?');
  });
  it('가정이 있는 질문에서는 premise가 그대로 허용된다', async () => {
    const { turn } = await service({
      question: [d('identity_swap', '인메모리 PostgreSQL이라면요?')],
      leak: [{ techs: [{ name: 'PostgreSQL', role: 'premise' }] }],
      premise: [OK],
    });
    const r = await turn.prepareDraft(base);
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].naming.ok).toBe(true);
  });
  it('시도마다 흘림 검사가 돌려준 기술과 역할을 바꾸기 전 그대로 남긴다', async () => {
    const first = [
      { name: 'Kafka', role: 'premise' },
      { name: 'Redis', role: 'user' },
    ];
    const { turn } = await service({
      question: [d('none', 'Kafka와 비교하면요?'), d('none', '다른 대안은요?')],
      leak: [{ techs: first }, { techs: [] }],
    });
    const r = await turn.prepareDraft(base);
    expect(r.attempts.map((a) => a.techs)).toEqual([first, []]);
  });
  it('usage는 호출마다 하나씩이고, attempts에 시도마다의 초안이 남는다', async () => {
    const { turn, calls } = await service({
      question: [d('identity_swap', '첫 시도'), d('identity_swap', '둘째 시도')],
      leak: [{ techs: [{ name: 'Kafka', role: 'solution' }] }, { techs: [] }],
      premise: [OK],
    });
    const r = await turn.prepareDraft(base);
    expect(r.usage).toHaveLength(calls.length);
    expect(r.attempts.map((a) => a.draft.text)).toEqual(['첫 시도', '둘째 시도']);
  });
  it('입력의 feedback은 재시도에서도 맨 앞에 남는다', async () => {
    const { turn, calls } = await service({
      question: [d('none', 'Kafka는요?'), d('none', '다른 대안은요?')],
      leak: [{ techs: [{ name: 'Kafka', role: 'solution' }] }, { techs: [] }],
    });
    await turn.prepareDraft({ ...base, feedback: ['처음 지적'] });
    const retry = calls[2].user;
    expect(retry.indexOf('- 처음 지적')).toBeGreaterThan(-1);
    expect(retry.indexOf('- 처음 지적')).toBeLessThan(retry.indexOf('- 해답으로 꺼내면'));
  });
  it('모른다고 한 기술이 전제로 나오면 버리고, 모름용 피드백으로 다시 만든다', async () => {
    const { turn, calls } = await service({
      question: [d('durability', 'Memcached라면요?'), d('durability', '재시작하면요?')],
      leak: [{ techs: [{ name: 'Memcached', role: 'premise' }] }, { techs: [] }],
      premise: [OK],
    });
    const r = await turn.prepareDraft({ ...base, avoidTechs: ['Memcached'] });
    expect(r.attempts).toHaveLength(2);
    const secondQuestionCall = calls.filter((c) => c.kind === 'question')[1];
    expect(secondQuestionCall.user).toContain(
      '지원자가 모른다고 해서 질문에 다시 넣으면 안 되는 기술: Memcached',
    );
    expect(secondQuestionCall.user).not.toContain('해답으로 꺼내면 안 되는 기술');
  });
  it('모름 위반과 해답 위반이 함께 나오면 해답 문장 먼저, 이름은 한 문장에만 넣는다', async () => {
    const { turn, calls } = await service({
      question: [d('none', 'Q1'), d('none', 'Q2')],
      leak: [
        {
          techs: [
            { name: 'Memcached', role: 'solution' },
            { name: 'Kafka', role: 'solution' },
          ],
        },
        { techs: [] },
      ],
    });
    await turn.prepareDraft({ ...base, avoidTechs: ['Memcached'] });
    const retry = calls.filter((c) => c.kind === 'question')[1].user;
    expect(retry).toContain('- 해답으로 꺼내면 안 되는 기술: Kafka\n');
    expect(retry).toContain('- 지원자가 모른다고 해서 질문에 다시 넣으면 안 되는 기술: Memcached');
    expect(retry.indexOf('해답으로 꺼내면')).toBeLessThan(retry.indexOf('모른다고 해서'));
  });
});

describe('TurnService.completeQuestion', () => {
  const input: AnswerKeyInput = {
    topic: 'Redis',
    interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
    reactionIntent: null,
    defect: null,
    addOn: false,
    history: [],
    draft: d('none', '보인 질문'),
  };
  it('completeQuestion은 정답지를 쓰고 검증해 고친 정답지를 돌려준다', async () => {
    const problems = [{ field: 'keyPoints', problem: '틀림' }];
    const { turn, calls } = await service({
      answerKey: [key(['쓴-핵심'])],
      verify: [
        {
          premiseOk: true,
          problems,
          corrections: { ...NO_CORRECTIONS, lists: [{ field: 'keyPoints', items: ['고침'] }] },
        },
      ],
    });
    const r = await turn.completeQuestion(input);
    expect(calls.map((c) => c.kind)).toEqual(['answerKey', 'verify']);
    expect(calls[0].user).toContain('보인 질문');
    expect(calls[1].user).toContain('쓴-핵심');
    expect(r.question).toEqual({ ...input.draft, answerKey: key(['고침']) });
    expect(r.verification).toEqual({ premiseOk: true, problems, answerKey: key(['고침']) });
    expect(r.answerKeyCorrected).toBe(true);
    expect(r.usage).toHaveLength(2);
  });
  it('검증이 고치지 않으면 쓴 정답지를 그대로 쓰고 answerKeyCorrected는 false다', async () => {
    const { turn } = await service({
      answerKey: [key(['쓴-핵심'])],
      verify: [{ ...OK, corrections: NO_CORRECTIONS }],
    });
    const r = await turn.completeQuestion(input);
    expect(r.question.answerKey).toEqual(key(['쓴-핵심']));
    expect(r.answerKeyCorrected).toBe(false);
  });
  it('completeQuestion은 검증에서 전제가 틀렸다고 나와도 질문을 다시 만들지 않는다', async () => {
    const problems = [{ field: 'text', problem: '전제 오류' }];
    const { turn, calls } = await service({
      answerKey: [key()],
      verify: [{ premiseOk: false, problems, corrections: NO_CORRECTIONS }],
    });
    const r = await turn.completeQuestion(input);
    expect(calls.map((c) => c.kind)).toEqual(['answerKey', 'verify']);
    expect(r.verification.premiseOk).toBe(false);
    expect(r.verification.problems).toEqual(problems);
    expect(r.question.text).toBe('보인 질문');
    expect(r.answerKeyCorrected).toBe(false);
  });
});

describe('TurnService.replyToClarification', () => {
  const clarify: ClarifyInput = {
    topic: 'Redis',
    interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
    question: d('durability', 'Memcached라면 재시작 뒤에 무엇이 남을까요?'),
    questionTechs: [{ name: 'Memcached', role: 'premise' }],
    exchanges: [],
    ask: '읽기 위주인가요?',
    userMentioned: ['Redis'],
    avoidTechs: [],
  };
  it('되묻기 응답이 질문에 나온 전제 기술을 다시 말해도 통과한다', async () => {
    const { turn, calls } = await service({
      clarify: [{ reply: 'Memcached는 한 대로 둡니다.' }],
      leak: [{ techs: [{ name: 'Memcached', role: 'premise' }] }],
    });
    expect((await turn.replyToClarification(clarify)).leak).toBe(false);
    expect(calls.map((c) => c.kind)).toEqual(['clarify', 'leak']);
    expect(calls[1].user).toContain('Redis, Memcached');
  });
  it('되묻기 응답이 새 기술을 꺼내면 다시 만들고, 끝까지 남으면 leak true', async () => {
    const leaked = { techs: [{ name: 'Kafka', role: 'solution' }] };
    const { turn, calls } = await service({
      clarify: [{ reply: 'Kafka를 쓴다고 보세요.' }, { reply: 'Kafka를 쓴다고 보세요.' }],
      leak: [leaked, leaked],
    });
    const r = await turn.replyToClarification(clarify);
    expect(calls.filter((c) => c.kind === 'clarify')).toHaveLength(2);
    expect(calls[2].user).toContain('해답으로 꺼내면 안 되는 기술: Kafka');
    expect(r.leak).toBe(true);
    expect(r.reply).toBe('Kafka를 쓴다고 보세요.');
    expect(r.usage).toHaveLength(calls.length);
  });
  it('되묻기 응답이 모른다고 한 기술을 말하면 위반이다', async () => {
    const { turn, calls } = await service({
      clarify: [{ reply: 'Memcached는 한 대입니다.' }, { reply: '서버는 한 대입니다.' }],
      leak: [{ techs: [{ name: 'Memcached', role: 'premise' }] }, { techs: [] }],
    });
    const r = await turn.replyToClarification({ ...clarify, avoidTechs: ['Memcached'] });
    const retry = calls.filter((c) => c.kind === 'clarify')[1].user;
    expect(retry).toContain('지원자가 모른다고 해서 질문에 다시 넣으면 안 되는 기술: Memcached');
    expect(retry).not.toContain('해답으로 꺼내면 안 되는 기술');
    expect(r).toMatchObject({ reply: '서버는 한 대입니다.', leak: false });
  });
});

describe('TurnService.pickJobRole', () => {
  it('직무와 사용량을 돌려준다', async () => {
    const { turn, calls } = await service({ jobRole: [{ role: 'security' }] });
    expect(await turn.pickJobRole('JWT')).toEqual({
      role: 'security',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(calls.map((c) => c.role)).toEqual(['analyze']);
  });
});

describe('TurnService.reviewTurn', () => {
  const defect = { type: 'wrong' as const, axis: 'durability' as const, note: 'n' };
  const input: ReviewInput = {
    topic: 'Redis',
    interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
    cause: { reactionIntent: null, defect: null },
    question: q('durability'),
    clarifications: [],
    answer: '...',
    analysis: { kind: 'answer', defects: [defect], mentionedTechs: [] },
    followUps: [{ interviewerId: 'p2', addOn: false, reactionIntent: 'B6', defect, text: 'F' }],
    knownAssumptions: [{ key: 'turn:t1', statement: 's' }],
  };
  const reply = (over: Partial<TurnReview> = {}): TurnReview => ({
    intent: { aimed: true, note: '' },
    defects: [],
    reactions: [],
    assumption: { result: 'well', note: '', sameAs: 'turn:t1' },
    keyProblems: [],
    ...over,
  });
  it('reviewTurn은 준 적 없는 sameAs를 null로 바꾼다', async () => {
    const given = await service({ review: [reply()] });
    expect((await given.turn.reviewTurn(input)).review.assumption.sameAs).toBe('turn:t1');
    const { turn, calls } = await service({
      review: [reply({ assumption: { result: 'well', note: '', sameAs: 'turn:없음' } })],
    });
    const r = await turn.reviewTurn(input);
    expect(r.review.assumption).toEqual({ result: 'well', note: '', sameAs: null });
    expect(calls.map((c) => c.role)).toEqual(['review']);
    expect(r.usage).toEqual({ input_tokens: 1, output_tokens: 1 });
  });
  it('reviewTurn은 범위 밖 index의 defects와 reactions를 버린다', async () => {
    const { turn } = await service({
      review: [
        reply({
          defects: [
            { index: 0, verdict: 'valid', note: 'd0' },
            { index: 5, verdict: 'misjudged', note: 'd5' },
          ],
          reactions: [
            { index: 5, verdict: 'misjudgment', note: 'r5' },
            { index: 0, verdict: 'valid_point', note: 'r0' },
          ],
        }),
      ],
    });
    const r = await turn.reviewTurn(input);
    expect(r.review.defects).toEqual([{ index: 0, verdict: 'valid', note: 'd0' }]);
    expect(r.review.reactions).toEqual([{ index: 0, verdict: 'valid_point', note: 'r0' }]);
  });
  it('reviewTurn은 같은 index가 두 번 오면 처음 것만 남긴다', async () => {
    const { turn } = await service({
      review: [
        reply({
          defects: [
            { index: 0, verdict: 'valid', note: 'first' },
            { index: 0, verdict: 'misjudged', note: 'second' },
          ],
          reactions: [
            { index: 0, verdict: 'valid_point', note: 'first' },
            { index: 0, verdict: 'misjudgment', note: 'second' },
          ],
        }),
      ],
    });
    const r = await turn.reviewTurn(input);
    expect(r.review.defects).toEqual([{ index: 0, verdict: 'valid', note: 'first' }]);
    expect(r.review.reactions).toEqual([{ index: 0, verdict: 'valid_point', note: 'first' }]);
  });
});

describe('TurnService.handleAnswer', () => {
  it('handleAnswer는 걸러 낸 unknownTechs를 돌려준다', async () => {
    const ask = async (userMentioned: string[], kind = 'answer') => {
      const { turn } = await service({
        analyze: [{ kind, defects: [], mentionedTechs: [], unknownTechs: ['Memcached'] }],
      });
      return turn.handleAnswer({
        topic: 'Redis',
        panel,
        history: ['p1'],
        askedBy: 'p1',
        question: q('durability'),
        answer: 'Memcached는 모르겠습니다.',
        userMentioned,
      });
    };
    expect((await ask(['Redis'])).unknownTechs).toEqual(['Memcached']);
    expect((await ask(['Redis', 'Memcached'])).unknownTechs).toEqual([]);
    expect((await ask(['Redis'], 'clarify')).unknownTechs).toEqual(['Memcached']);
  });
  it('되묻기면 질문자를 바꾸지 않고 언급 기술은 합친다', async () => {
    const { turn } = await service({
      analyze: [{ kind: 'clarify', defects: [], mentionedTechs: ['Redis', 'Lua'] }],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p1'],
      askedBy: 'p1',
      question: q('durability'),
      answer: '영속성 관점에서 여쭤보시는 건가요?',
      userMentioned: ['Redis'],
    });
    expect(r.pick).toBeNull();
    expect(r.userMentioned).toEqual(['Redis', 'Lua']);
  });
  it('결함이 비면 질문 축(공유 축이면 질문자의 첫 축)의 결함 없음으로 본다', async () => {
    const { turn } = await service({
      analyze: [{ kind: 'answer', defects: [], mentionedTechs: [] }],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p2'],
      askedBy: 'p2',
      question: q('identity_swap'),
      answer: '...',
      userMentioned: [],
    });
    expect(r.pick?.defect).toEqual({ type: 'none', axis: 'resource_limit', note: '' });
  });
  it('결함이 있으면 규칙이 고른 면접관과 반응 의도를 돌려준다', async () => {
    const { turn } = await service({
      analyze: [
        {
          kind: 'answer',
          defects: [{ type: 'wrong', axis: 'durability', note: 'n' }],
          mentionedTechs: [],
        },
      ],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p2'],
      askedBy: 'p2',
      question: q('durability'),
      answer: '...',
      userMentioned: [],
    });
    expect(r.pick?.interviewerId).toBe('p1');
    expect(r.pick?.reactionIntent).toBe('B9');
  });
  it('analysis는 받은 그대로 돌려준다(결함 없음 보충은 pick에만)', async () => {
    const analysis = { kind: 'answer', defects: [], mentionedTechs: ['Lua'] };
    const { turn } = await service({ analyze: [analysis] });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p2'],
      askedBy: 'p2',
      question: q('identity_swap'),
      answer: '...',
      userMentioned: [],
    });
    expect(r.analysis).toEqual({ kind: 'answer', defects: [], mentionedTechs: ['Lua'] });
  });
  it('모른다고 한 기술이 있으면 질문한 면접관이 B11로 넘어가고, 그 기술은 userMentioned에 없다', async () => {
    // 규칙대로라면 durability 결함은 p1(DBA)이 맡는다. 질문자는 p2다.
    const { turn } = await service({
      analyze: [
        {
          kind: 'answer',
          defects: [{ type: 'wrong', axis: 'durability', note: 'n' }],
          mentionedTechs: ['Memcached', 'Lua'],
          unknownTechs: ['Memcached'],
        },
      ],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p2'],
      askedBy: 'p2',
      question: q('durability'),
      answer: 'Memcached가 무엇인지 모르겠습니다.',
      userMentioned: ['Redis'],
    });
    expect(r.pick?.interviewerId).toBe('p2');
    expect(r.pick?.reactionIntent).toBe('B11');
    expect(r.pick?.secondary).toBeNull();
    expect(r.pick?.defect.type).toBe('none');
    expect(r.pick?.defect.note).toContain('Memcached');
    expect(r.pick?.defect.axis).toBe('durability');
    expect(r.userMentioned).toEqual(['Redis', 'Lua']);
  });
  it('모른다고 한 경로에서 질문 축이 공유 축이면 질문자 역할의 첫 축을 쓴다', async () => {
    const { turn } = await service({
      analyze: [{ kind: 'answer', defects: [], mentionedTechs: [], unknownTechs: ['Memcached'] }],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p2'],
      askedBy: 'p2',
      question: q('identity_swap'),
      answer: 'Memcached는 잘 모르겠습니다.',
      userMentioned: ['Redis'],
    });
    expect(r.pick?.reactionIntent).toBe('B11');
    expect(r.pick?.defect.axis).toBe('resource_limit');
  });
  it('분석이 이미 말한 기술을 모른다고 넣으면 넘어가지 않고 규칙이 다음 질문자를 고른다', async () => {
    const { turn } = await service({
      analyze: [
        {
          kind: 'answer',
          defects: [{ type: 'wrong', axis: 'durability', note: 'n' }],
          mentionedTechs: ['Redis'],
          unknownTechs: ['Redis'],
        },
      ],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p2'],
      askedBy: 'p2',
      question: q('durability'),
      answer: 'Redis의 AOF는 잘 모르겠습니다.',
      userMentioned: ['Redis'],
    });
    expect(r.pick?.interviewerId).toBe('p1');
    expect(r.pick?.reactionIntent).toBe('B9');
    expect(r.userMentioned).toEqual(['Redis']);
  });
  it('되묻기면 모른다고 한 기술이 있어도 pick이 null이다', async () => {
    const { turn } = await service({
      analyze: [{ kind: 'clarify', defects: [], mentionedTechs: [], unknownTechs: ['Memcached'] }],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p1'],
      askedBy: 'p1',
      question: q('identity_swap'),
      answer: 'Memcached를 말씀하시는 건가요?',
      userMentioned: ['Redis'],
    });
    expect(r.pick).toBeNull();
  });
  it('분석 호출에 입력의 userMentioned를 넘긴다', async () => {
    const { turn, calls } = await service({
      analyze: [{ kind: 'answer', defects: [], mentionedTechs: [] }],
    });
    await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p1'],
      askedBy: 'p1',
      question: q('identity_swap'),
      answer: '...',
      userMentioned: ['Redis', 'Lua'],
    });
    expect(calls[0].user).toContain('Redis, Lua');
  });
  it('askedBy가 패널에 없으면 던진다', async () => {
    const { turn, calls } = await service({ analyze: [] });
    await expect(
      turn.handleAnswer({
        topic: 'Redis',
        panel,
        history: [],
        askedBy: 'p9',
        question: q('none'),
        answer: '...',
        userMentioned: [],
      }),
    ).rejects.toThrow('패널에 없는 면접관');
    expect(calls).toHaveLength(0);
  });
});

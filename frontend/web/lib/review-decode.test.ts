import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeReviewView, decodeStats, decodeTopics } from './review-decode.ts';

const intent = { id: 'A1', name: '원리 확인', group: '깊이' };
const turn = {
  id: 't1',
  seq: 1,
  addOn: false,
  interviewer: { id: 'p1', roleName: '백엔드 면접관', temperamentName: '집요함' },
  text: '질문',
  clarifications: [{ ask: '범위는?', reply: '한 대입니다.', leak: true }],
  answer: '답',
  answerStartMs: 1200,
  questionIntent: intent,
  cause: {
    reactionIntent: { id: 'B8', name: '확신 시험', group: '반박' },
    defect: { typeName: '모호함', axisName: '규모', note: '근거 없음' },
  },
  assumption: { axisName: '규모', statement: '트래픽이 열 배로 늘어난다' },
  answerKey: {
    vanishing: ['v'],
    remaining: ['r'],
    alternatives: [{ name: '대안', traits: '특징' }],
    keyPoints: ['k1'],
  },
  answerKeyCorrected: true,
  leakFlag: false,
  premiseFlag: true,
  analysis: [{ typeName: '모호함', axisName: '규모', note: '근거 없음' }],
  followUps: [{ seq: 2, addOn: false, roleName: 'DBA 면접관', reactionIntent: intent }],
  review: {
    intent: { aimed: true, note: '향함' },
    defects: [{ index: 0, verdict: 'valid', note: '맞음' }],
    reactions: [{ index: 0, verdict: 'intended_test', note: '흔듦' }],
    assumption: { result: 'wobbly', note: '일부', sameAs: null, userResult: 'well' },
    keyProblems: ['문제'],
  },
  surprise: 'unexpected',
};
const view = {
  id: 'i1',
  topic: 'Redis',
  createdAt: '2026-11-17T00:00:00.000Z',
  status: 'ready',
  progress: { done: 1, total: 1 },
  error: null,
  turns: [turn],
  skippedAnswers: 1,
  assumptions: [
    { axisName: '규모', statement: '트래픽이 열 배로 늘어난다', result: 'well', turnSeq: 1 },
  ],
  usage: [
    {
      role: 'review',
      model: 'fake-model',
      inputTokens: 10,
      cacheCreationTokens: 2,
      cacheReadTokens: 3,
      outputTokens: 5,
      calls: 1,
      fallbacks: 0,
    },
  ],
};

void test('복기 뷰를 통과시킨다', () => {
  assert.deepEqual(decodeReviewView(view), view);
});

void test('사용량의 캐시 토큰을 읽고, 하나가 빠지면 던진다', () => {
  const [u] = decodeReviewView(view).usage;
  assert.equal(u.cacheCreationTokens, 2);
  assert.equal(u.cacheReadTokens, 3);
  for (const key of ['cacheCreationTokens', 'cacheReadTokens']) {
    const missing: Record<string, unknown> = { ...view.usage[0] };
    delete missing[key];
    assert.throws(() => decodeReviewView({ ...view, usage: [missing] }), new RegExp(key));
  }
});

void test('verdict가 목록 밖이면 던진다', () => {
  const review = { ...turn.review, defects: [{ index: 0, verdict: 'maybe', note: '' }] };
  assert.throws(() => decodeReviewView({ ...view, turns: [{ ...turn, review }] }));
  const reactions = [{ index: 0, verdict: 'valid', note: '' }];
  assert.throws(() =>
    decodeReviewView({ ...view, turns: [{ ...turn, review: { ...turn.review, reactions } }] }),
  );
});

void test('이 답에서 나온 질문의 판정 deepening을 읽는다', () => {
  const reactions = [{ index: 0, verdict: 'deepening', note: '더 물음' }];
  const decoded = decodeReviewView({
    ...view,
    turns: [{ ...turn, review: { ...turn.review, reactions } }],
  });
  assert.equal(decoded.turns[0].review?.reactions[0].verdict, 'deepening');
});

void test('review가 null인 턴도 받는다', () => {
  const pending = {
    ...view,
    status: 'pending',
    progress: { done: 0, total: 1 },
    turns: [
      { ...turn, review: null, surprise: null, cause: { reactionIntent: null, defect: null } },
    ],
  };
  assert.deepEqual(decodeReviewView(pending), pending);
});

void test('추이와 주제 목록을 읽고 모양이 다르면 던진다', () => {
  const stats = {
    improved: 2,
    sessions: [
      { id: 'i1', topic: 'Redis', date: 'x', medianAnswerStartMs: null, unexpectedRatio: 0.5 },
    ],
  };
  assert.deepEqual(decodeStats(stats), stats);
  assert.throws(() => decodeStats({ ...stats, improved: '2' }));
  assert.deepEqual(decodeTopics({ topics: ['Redis'] }), ['Redis']);
  assert.throws(() => decodeTopics({ topics: [1] }));
});

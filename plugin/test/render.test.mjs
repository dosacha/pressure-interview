import assert from 'node:assert/strict';
import test from 'node:test';

import { toReviewView } from '../skills/pressure-interview/scripts/lib/app/review/review.view.mjs';
import {
  renderReview,
  renderStats,
  sayClarify,
  sayQuestion,
  summarizeCalls,
} from '../skills/pressure-interview/scripts/lib/render.mjs';
import { analysis, key, panel, review } from './helpers.mjs';

test('sayQuestion과 sayClarify의 꼴', () => {
  const view = { open: { seq: 2, roleName: 'DBA', text: '왜 그렇게 했나요?' } };
  assert.equal(sayQuestion(view), '**질문 2 · DBA 면접관**\n\n왜 그렇게 했나요?');
  assert.equal(sayClarify(view, '한 대의 서버입니다.'), '**DBA 면접관**\n\n한 대의 서버입니다.');
});

const ROWS = [
  { at: 'a', kind: 'question', model: 'opus', input_tokens: 10, cache_creation_input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3, duration_ms: 900, wall_ms: 1000, ok: true },
  { at: 'b', kind: 'question', model: 'opus', input_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 4, output_tokens: 5, duration_ms: 1900, wall_ms: 2000, ok: true },
  { at: 'c', kind: 'question', model: 'sonnet', input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1, duration_ms: 100, wall_ms: 300, ok: true },
  { at: 'd', kind: 'analyze', model: 'opus', input_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 2, duration_ms: 0, wall_ms: 500, ok: false, code: 'timeout' },
  { type: 'wait', seq: 1, wall_ms: 4200 },
];

test('summarizeCalls는 종류와 모델로 묶고 wait 줄은 뺀다', () => {
  assert.deepEqual(summarizeCalls(ROWS), [
    { kind: 'analyze', model: 'opus', calls: 1, inputTokens: 7, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 2, durationMs: 500 },
    { kind: 'question', model: 'opus', calls: 2, inputTokens: 30, cacheCreationTokens: 1, cacheReadTokens: 6, outputTokens: 8, durationMs: 3000 },
    { kind: 'question', model: 'sonnet', calls: 1, inputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 1, durationMs: 300 },
  ]);
});

// 앱의 복기 화면이 받던 값을 toReviewView로 만든다. 턴 1은 표시가 모두 붙은 가정 변경 질문, 턴 2는 턴 1에서 나온 질문이다.
function sampleView() {
  const session = {
    id: 's1',
    topic: 'Redis',
    panel: panel(),
    createdAt: new Date('2026-11-18T05:32:00.000Z'),
    reviewedAt: new Date('2026-11-18T06:00:00.000Z'),
  };
  const base = {
    sessionId: 's1',
    addOn: false,
    clarifications: [],
    answerStartMs: 4321,
    answeredAt: new Date('2026-11-18T05:40:00.000Z'),
    pick: null,
    verification: { premiseOk: true, problems: [] },
  };
  const t1 = {
    ...base,
    id: '01',
    seq: 1,
    interviewerId: 'i1',
    causeTurnId: null,
    reactionIntent: null,
    defect: null,
    question: {
      text: '인메모리 PostgreSQL이라면?',
      questionIntent: 'A1',
      assumption: { axis: 'scale', statement: '요청이 열 배로 는다' },
      answerKey: key({ vanishing: ['사라짐-1'], remaining: ['남음-1'], alternatives: [{ name: 'Memcached', traits: '대안-특징' }], keyPoints: ['핵심-1'] }),
    },
    prepared: { flags: { leak: true, premise: false }, attempts: [], answerKeyCorrected: true },
    verification: { premiseOk: false, problems: [] },
    clarifications: [{ ask: '읽기 위주인가요?', reply: '네, 읽기 위주입니다.', leak: true }],
    answer: '내-답-본문',
    analysis: analysis({
      defects: [
        { type: 'wrong', axis: 'durability', note: '분석-메모-1' },
        { type: 'vague', axis: 'scale', note: '분석-메모-2' },
      ],
    }),
    review: review({
      intent: { aimed: false, note: '의도-메모' },
      defects: [
        { index: 0, verdict: 'valid', note: '' },
        { index: 1, verdict: 'misjudged', note: '' },
      ],
      reactions: [{ index: 0, verdict: 'deepening', note: '' }],
      assumption: { result: 'wobbly', note: '가정-메모', sameAs: null },
      keyProblems: ['정답지-문제-1'],
    }),
    surprise: 'unexpected',
  };
  const t2 = {
    ...base,
    id: '02',
    seq: 2,
    interviewerId: 'i3',
    causeTurnId: '01',
    reactionIntent: 'B1',
    defect: { type: 'none', axis: 'scale', note: '결함-메모' },
    question: { text: '둘째-질문', questionIntent: 'A1', assumption: { axis: 'none', statement: '' }, answerKey: key() },
    prepared: { flags: { leak: false, premise: false }, attempts: [], answerKeyCorrected: false },
    answer: '둘째-답',
    analysis: analysis(),
    review: review({ intent: { aimed: true, note: '' } }),
    surprise: null,
  };
  const turns = [t1, t2];
  const folded = [{ recordId: null, axis: 'scale', statement: '요청이 열 배로 는다', result: 'wobbly', surprise: 'unexpected', turnIds: ['01'], at: '2026-11-18T05:40:00.000Z' }];
  const usage = summarizeCalls(ROWS);
  return { view: toReviewView(session, turns, { running: false, error: null, folded, usage }), usage };
}

function sampleDoc() {
  const { view, usage } = sampleView();
  return renderReview(view, { usage, waits: [{ seq: 1, wall_ms: 4200 }] });
}

test('review.md에 설계 7.1의 항목이 있다', () => {
  const doc = sampleDoc();
  for (const piece of [
    '가정별 결과',
    '| 규모 | 요청이 열 배로 는다 | 흔들림 | 1 |',
    '인메모리 PostgreSQL이라면?',
    'DBA',
    '집요형',
    '읽기 위주인가요?',
    '네, 읽기 위주입니다.',
    '내-답-본문',
    '깊이 · 원리 이해',
    '상향 심화',
    '결함-메모',
    '빗나감',
    '향했음',
    '맞는 판정',
    '오판',
    '더 깊이 물음',
    '요청이 열 배로 는다',
    '흔들림',
    '사라짐-1',
    '남음-1',
    'Memcached: 대안-특징',
    '핵심-1',
    '정답지 수정됨',
    '정답지-문제-1',
    '흘림 표시',
    '전제 표시',
    '예상 밖',
    '표시 없음',
    '| question | opus | 2 |',
    '| analyze |',
    '답 뒤 대기',
    '| 1 | 4.2 |',
  ]) {
    assert.ok(doc.includes(piece), `빠졌다: ${piece}`);
  }
  // 분석된 답만 넣은 예이므로 빠진 답 줄이 없다.
  assert.equal(doc.includes('복기에서 빠진 답'), false);
});

test('review.md에 답 시작 시간이 없다', () => {
  const doc = sampleDoc();
  assert.equal(doc.includes('답 시작'), false);
  assert.equal(doc.includes('4321'), false);
  assert.equal(doc.includes('4.3'), false);
});

test('stats.md의 꼴', () => {
  const doc = renderStats({
    improved: 2,
    sessions: [
      { id: 'b', topic: 'Kafka', date: '2026-11-18T12:00:00.000Z', unexpectedRatio: 0.5 },
      { id: 'a', topic: 'Redis', date: '2026-11-17T12:00:00.000Z', unexpectedRatio: null },
    ],
    pendingTopics: ['Redis'],
  });
  assert.match(doc, /잘 답함으로 바뀐 가정: 2개/);
  assert.ok(doc.includes('| 2026-11-18 | Kafka | 50% |'));
  assert.ok(doc.includes('| 2026-11-17 | Redis | 표시 없음 |'));
  assert.match(doc, /다시 연습할 주제[\s\S]*- Redis/);
});

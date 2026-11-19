import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULTS } from '../skills/pressure-interview/scripts/lib/config.mjs';
import { createInterviewService } from '../skills/pressure-interview/scripts/lib/interview.mjs';
import { createReviewService, syncMemory } from '../skills/pressure-interview/scripts/lib/review.mjs';
import { openStore } from '../skills/pressure-interview/scripts/lib/store.mjs';
import { analysis, draft, fakeLlm, judgment, key, review, topicMap } from './helpers.mjs';

const plain = (text = '기본 질문입니다.') => draft({ text, assumption: { axis: 'none', statement: '' } });
const swap = (text, statement = 'PostgreSQL이 디스크 없이 동작') => draft({ text, assumption: { axis: 'identity_swap', statement } });
const result = (r, sameAs = null) => review({ assumption: { result: r, note: '', sameAs } });
const NO_CORRECTIONS = { premiseOk: true, problems: [], corrections: { lists: [], alternatives: { changed: false, items: [] } } };
const WITH_DEFECT = analysis({ score: 'unclear', defects: [{ type: 'wrong', axis: 'durability', note: 'n1' }] });
const DEFAULT_REPLIES = {
  jobRole: { role: 'dba' },
  question: plain(),
  leak: { techs: [] },
  premise: { premiseOk: true, problems: [] },
  answerKey: key(),
  verify: NO_CORRECTIONS,
  analyze: analysis(),
  clarify: { reply: '범위는 한 대의 서버입니다.' },
  review: review(),
  topicMap: topicMap(),
  endJudge: judgment(),
};
const NOW = new Date('2030-01-01T00:00:00.000Z');

// 한 데이터 폴더를 두 서비스가 함께 쓴다. 종류마다 앞에 둔 응답을 먼저 쓰고, 그 뒤로는 기본 응답을 쓴다.
function setup({ now = () => NOW } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '면접 기록 '));
  const store = openStore(dataDir);
  const config = { ...DEFAULTS, dataDir, pollMs: 10 };
  const queues = {};
  const fake = fakeLlm(
    new Proxy(queues, {
      get: (q, kind) => (q[kind]?.length ? q[kind] : [DEFAULT_REPLIES[kind]]),
    }),
  );
  const llmFor = () => fake.llm;
  const interviews = createInterviewService({ store, config, llmFor, rng: () => 0, launchCompletion: () => {} });
  const reviews = createReviewService({ store, config, llmFor, now });
  const queue = (kind, ...values) => (queues[kind] = [...(queues[kind] ?? []), ...values]);
  const callsOf = (kind) => fake.calls.filter((c) => c.kind === kind);
  return { dataDir, store, config, fake, interviews, reviews, queue, callsOf };
}

// 질문 count개에 모두 답하고 끝낸다. 상한을 count로 두어 그 뒤 질문을 만들지 않게 한다.
async function play(w, { topic = 'Redis', count = 2 } = {}) {
  w.config.questionCap = count;
  const { id } = await w.interviews.start({ topic });
  for (let i = 0; i < count; i++) await w.interviews.submitAnswer(id, `답-${i + 1}`);
  assert.equal(w.store.readSession(id).capPending, true);
  await w.interviews.finish(id);
  assert.equal(w.store.readTurns(id).length, count);
  return id;
}

const reviewOf = (w, id, seq) => w.store.readTurns(id).find((t) => t.seq === seq);

test('진행 중인 면접의 run은 not_finished', async () => {
  const w = setup();
  const { id } = await w.interviews.start({ topic: 'Redis' });
  await assert.rejects(w.reviews.run(id), { code: 'not_finished' });
  assert.equal(w.callsOf('review').length, 0);
});

test('끝난 면접을 run하면 대상 턴마다 복기 호출이 한 번씩 돈다', async () => {
  const w = setup();
  const id = await play(w);
  const out = await w.reviews.run(id);
  assert.equal(w.callsOf('review').length, 2);
  assert.deepEqual(out, { done: 2, total: 2, failed: 0, ready: true });
  assert.deepEqual(w.store.readSession(id).reviewedAt, NOW);
  const paths = w.reviews.paths(id);
  assert.equal(paths.review, path.join(w.dataDir, 'interviews', id, 'review.md'));
  assert.equal(paths.stats, path.join(w.dataDir, 'stats.md'));
  assert.ok(fs.existsSync(paths.review));
  assert.ok(fs.existsSync(paths.stats));
  assert.equal(w.reviews.latestFinished(), id);
});

test('run을 두 번 불러도 복기 호출은 턴마다 한 번이다', async () => {
  const w = setup();
  const id = await play(w);
  await w.reviews.run(id);
  const again = await w.reviews.run(id);
  assert.equal(w.callsOf('review').length, 2);
  assert.equal(again.ready, true);
});

test('일부 턴이 실패하면 문서를 쓰지 않고, 다시 부르면 그 턴만 한다', async () => {
  const w = setup();
  const id = await play(w);
  w.queue('review', review(), new Error('boom'));
  const first = await w.reviews.run(id);
  assert.deepEqual(first, { done: 1, total: 2, failed: 1, ready: false });
  assert.equal(fs.existsSync(w.reviews.paths(id).review), false);
  assert.equal(w.store.readSession(id).reviewedAt, null);
  assert.match(fs.readFileSync(path.join(w.dataDir, 'interviews', id, 'hidden', 'errors.log'), 'utf8'), /boom/);
  const second = await w.reviews.run(id);
  assert.equal(w.callsOf('review').length, 3);
  assert.equal(second.ready, true);
  assert.ok(fs.existsSync(w.reviews.paths(id).review));
});

test('분석 없이 남은 답은 대상이 아니다', async () => {
  const w = setup();
  const { id } = await w.interviews.start({ topic: 'Redis' });
  await w.interviews.submitAnswer(id, '답-1');
  w.queue('analyze', new Error('boom'));
  await assert.rejects(w.interviews.submitAnswer(id, '답-2'), /boom/);
  await w.interviews.finish(id);
  const out = await w.reviews.run(id);
  assert.equal(w.callsOf('review').length, 1);
  assert.deepEqual(out, { done: 1, total: 1, failed: 0, ready: true });
  assert.match(fs.readFileSync(w.reviews.paths(id).review, 'utf8'), /복기에서 빠진 답 1개/);
});

test('같은 축의 앞선 가정을 알려 준다', async () => {
  const w = setup();
  w.queue('question', swap('가정질문-1', '첫 가정'), swap('가정질문-2', '둘째 가정'));
  const id = await play(w);
  await w.reviews.run(id);
  const calls = w.callsOf('review');
  const second = calls.find((c) => c.user.includes('질문 문장: 가정질문-2'));
  const first = calls.find((c) => c.user.includes('질문 문장: 가정질문-1'));
  assert.ok(second.user.includes('- key turn:01: 첫 가정'));
  assert.equal(first.user.includes('key turn:'), false);
});

test('꼬리질문을 여는 질문의 턴으로 짝짓고, 다음 줄기의 여는 질문은 후속 질문이 아니다', async () => {
  const w = setup();
  w.queue('question', plain('질문-1-끝'), plain('질문-2-끝'), plain('질문-3-끝'));
  w.queue('analyze', WITH_DEFECT);
  const id = await play(w, { count: 3 });
  const turns = w.store.readTurns(id);
  assert.deepEqual(turns.map((t) => [t.seq, t.thread.role, t.causeTurnId]), [
    [1, 'open', null],
    [2, 'follow', '01'],
    [3, 'open', null],
  ]);
  await w.reviews.run(id);
  const calls = w.callsOf('review');
  const cause = calls.find((c) => c.user.includes('질문 문장: 질문-1-끝'));
  assert.ok(cause.user.includes('질문-2-끝'));
  assert.equal(cause.user.includes('질문-3-끝'), false);
  const middle = calls.find((c) => c.user.includes('질문 문장: 질문-2-끝'));
  assert.equal(middle.user.includes('질문-3-끝'), false);
});

test('복기가 끝나면 가정이 기억에 들어간다', async () => {
  const w = setup();
  w.queue('question', swap('가정질문-1'));
  w.queue('review', result('wobbly'));
  const id = await play(w);
  await w.reviews.run(id);
  const records = w.store.readMemory();
  assert.equal(records.length, 1);
  const [r] = records;
  assert.equal(r.status, 'wobbly');
  assert.equal(r.axis, 'identity_swap');
  assert.equal(r.statement, 'PostgreSQL이 디스크 없이 동작');
  assert.deepEqual(r.createdAt, NOW);
  assert.equal(r.encounters.length, 1);
  assert.equal(r.encounters[0].sessionId, id);
  assert.equal(r.encounters[0].turnId, '01');
  assert.equal(r.encounters[0].topic, 'Redis');
  assert.deepEqual(r.lastSeenAt, new Date(r.encounters[0].at));
});

test('기억 맞추기는 여러 번 해도 같다', async () => {
  const w = setup();
  w.queue('question', swap('가정질문-1', '첫 가정'), swap('가정질문-2', '둘째 가정'));
  w.queue('review', result('wobbly'), result('well'));
  const id = await play(w);
  await w.reviews.run(id);
  const before = w.store.readMemory();
  syncMemory(w.store, id, new Date('2031-01-01T00:00:00.000Z'));
  syncMemory(w.store, id, new Date('2032-01-01T00:00:00.000Z'));
  assert.equal(before.length, 2);
  assert.deepEqual(w.store.readMemory(), before);
});

test('두 면접이 같은 가정에 합류하면 기록은 하나이고 만남은 시각 순이다', async () => {
  const w = setup();
  w.queue('question', swap('가정질문-1'));
  w.queue('review', result('wobbly'));
  const first = await play(w);
  await w.reviews.run(first);
  const [r] = w.store.readMemory();
  w.queue('question', swap('가정질문-2', '같은 뜻의 다른 문장'));
  w.queue('review', result('well', r.id));
  const second = await play(w, { topic: 'Kafka' });
  await w.reviews.run(second);
  const records = w.store.readMemory();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, r.id);
  assert.deepEqual(records[0].createdAt, r.createdAt);
  assert.deepEqual(records[0].encounters.map((e) => e.sessionId), [first, second]);
  assert.equal(records[0].status, 'well');
  assert.equal(records[0].statement, 'PostgreSQL이 디스크 없이 동작');
});

test('한 면접 안의 같은 가정은 묶이고 마지막 답의 결과를 쓴다', async () => {
  const w = setup();
  w.queue('question', plain('질문-1'), swap('가정질문-2'), swap('가정질문-3', '같은 뜻'));
  w.queue('review', review(), result('wobbly'), result('well', 'turn:02'));
  const id = await play(w, { count: 3 });
  await w.reviews.run(id);
  const records = w.store.readMemory();
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'well');
  assert.equal(records[0].statement, 'PostgreSQL이 디스크 없이 동작');
  assert.deepEqual(records[0].encounters.map((e) => e.turnId), ['03']);
});

test('가정 결과를 고치면 기억이 따라 바뀐다', async () => {
  const w = setup();
  w.queue('question', plain('질문-1'), swap('가정질문-2'));
  w.queue('review', review(), result('wobbly'));
  const id = await play(w);
  await w.reviews.run(id);
  const [before] = w.store.readMemory();
  assert.deepEqual(w.reviews.mark(id, 2, { result: 'well' }), { ready: true });
  assert.equal(reviewOf(w, id, 2).review.assumption.userResult, 'well');
  const [after] = w.store.readMemory();
  assert.equal(after.status, 'well');
  assert.equal(after.id, before.id);
  assert.match(fs.readFileSync(w.reviews.paths(id).review, 'utf8'), /잘 답함/);
});

test('복기가 해당 없음으로 준 턴도 고친 결과는 기억에 들어간다', async () => {
  const w = setup();
  w.queue('question', swap('가정질문-1'));
  w.queue('review', result('none'));
  const id = await play(w);
  await w.reviews.run(id);
  assert.deepEqual(w.store.readMemory(), []);
  w.reviews.mark(id, 1, { result: 'wrong' });
  const records = w.store.readMemory();
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'wrong');
});

test('가정을 바꾸지 않은 질문의 결과를 고치려 하면 not_reviewable. 예상 표시는 된다', async () => {
  const w = setup();
  const id = await play(w);
  await w.reviews.run(id);
  assert.throws(() => w.reviews.mark(id, 1, { result: 'well' }), { code: 'not_reviewable' });
  // 함께 보낸 표시도 저장되지 않는다.
  assert.throws(() => w.reviews.mark(id, 1, { result: 'well', surprise: 'expected' }), { code: 'not_reviewable' });
  assert.equal(reviewOf(w, id, 1).surprise, null);
  assert.deepEqual(w.reviews.mark(id, 1, { surprise: 'unexpected' }), { ready: true });
  assert.equal(reviewOf(w, id, 1).surprise, 'unexpected');
  assert.match(fs.readFileSync(w.reviews.paths(id).review, 'utf8'), /예상 밖/);
  assert.throws(() => w.reviews.mark(id, 9, { surprise: 'expected' }), { code: 'not_reviewable' });
});

test('복기 전의 면접에 mark는 not_reviewed, 끝나지 않은 면접에는 not_finished', async () => {
  const w = setup();
  const done = await play(w);
  assert.throws(() => w.reviews.mark(done, 1, { surprise: 'expected' }), { code: 'not_reviewed' });
  const { id } = await w.interviews.start({ topic: 'Kafka' });
  assert.throws(() => w.reviews.mark(id, 1, { surprise: 'expected' }), { code: 'not_finished' });
  assert.equal(reviewOf(w, done, 1).surprise, null);
});

// store.writeMemory가 다음 한 번만 던지게 한다.
function failWriteOnce(store) {
  const real = store.writeMemory;
  store.writeMemory = () => {
    store.writeMemory = real;
    throw new Error('disk full');
  };
}

test('기억 맞추기가 실패하면 reviewedAt이 없고, 다시 run하면 맞춘다', async () => {
  const w = setup();
  w.queue('question', swap('가정질문-1'));
  w.queue('review', result('wobbly'));
  const id = await play(w);
  failWriteOnce(w.store);
  await assert.rejects(w.reviews.run(id), { code: 'memory_sync_failed' });
  assert.equal(w.store.readSession(id).reviewedAt, null);
  assert.deepEqual(w.store.readMemory(), []);
  assert.equal(fs.existsSync(w.reviews.paths(id).review), false);
  const again = await w.reviews.run(id);
  assert.equal(again.ready, true);
  assert.equal(w.callsOf('review').length, 2);
  assert.equal(w.store.readMemory().length, 1);
});

test('mark 뒤 기억 맞추기가 실패하면 고친 값은 남고 reviewedAt이 지워진다', async () => {
  const w = setup();
  w.queue('question', plain('질문-1'), swap('가정질문-2'));
  w.queue('review', review(), result('wobbly'));
  const id = await play(w);
  await w.reviews.run(id);
  failWriteOnce(w.store);
  assert.throws(() => w.reviews.mark(id, 2, { result: 'well' }), { code: 'memory_sync_failed' });
  assert.equal(reviewOf(w, id, 2).review.assumption.userResult, 'well');
  assert.equal(w.store.readSession(id).reviewedAt, null);
  assert.equal(w.store.readMemory()[0].status, 'wobbly');
  const again = await w.reviews.run(id);
  assert.equal(again.ready, true);
  assert.equal(w.callsOf('review').length, 2);
  assert.equal(w.store.readMemory()[0].status, 'well');
});

test('stats: 흔들림에서 잘 답함으로 바뀐 가정을 세고, 예상 밖 비율과 다시 연습할 주제를 준다', async () => {
  // 다시 내기 간격(24시간)이 지난 시각에서 본다.
  const w = setup({ now: () => new Date(Date.now() + 48 * 3600_000) });
  w.queue('question', swap('가정질문-1', '첫 가정'), swap('가정질문-2', '둘째 가정'));
  w.queue('review', result('wobbly'), result('wrong'));
  const first = await play(w);
  await w.reviews.run(first);
  const r = w.store.readMemory().find((x) => x.statement === '첫 가정');
  w.queue('question', swap('가정질문-3', '첫 가정의 다른 말'));
  w.queue('review', result('well', r.id));
  const second = await play(w, { topic: 'Kafka' });
  await w.reviews.run(second);
  w.reviews.mark(second, 1, { surprise: 'unexpected' });
  w.reviews.mark(second, 2, { surprise: 'expected' });

  const s = w.reviews.stats();
  assert.equal(s.improved, 1);
  assert.deepEqual(s.sessions.map((x) => [x.id, x.topic, x.unexpectedRatio]), [
    [second, 'Kafka', 0.5],
    [first, 'Redis', null],
  ]);
  assert.equal(s.sessions.some((x) => 'medianAnswerStartMs' in x), false);
  assert.deepEqual(s.pendingTopics, ['Redis']);
  const doc = fs.readFileSync(w.reviews.paths(second).stats, 'utf8');
  assert.match(doc, /Kafka/);
  assert.match(doc, /50%/);
});

test('복기: replaced로 끝난 면접을 나중에 복기하면 끝낸 까닭이 "새 면접을 시작하며 끝냄"', async () => {
  const w = setup();
  const { id } = await w.interviews.start({ topic: 'Redis' });
  await w.interviews.submitAnswer(id, '답-1');
  await w.interviews.start({ topic: 'Kafka', replace: true });
  assert.equal(w.store.readSession(id).end.by, 'replaced');
  const out = await w.reviews.run(id);
  assert.equal(out.ready, true);
  const doc = fs.readFileSync(w.reviews.paths(id).review, 'utf8');
  assert.match(doc, /## 끝낸 까닭\n\n새 면접을 시작하며 끝냄/);
  assert.match(doc, /## 영역별/);
});

test('복기가 시간 예산을 넘기면 새 묶음을 시작하지 않고 부분 결과를 돌려준다', async () => {
  let t = 0;
  const w = setup();
  w.config.reviewConcurrency = 1;
  const reviews = createReviewService({
    store: w.store, config: w.config, llmFor: () => w.fake.llm, now: () => NOW, budgetMs: 100, clock: () => t,
  });
  const id = await play(w, { count: 3 });
  // 첫 묶음이 끝나면 예산을 넘긴 것으로 본다.
  w.queue('review', () => { t = 1000; return review(); });
  const out = await reviews.run(id);
  assert.deepEqual(out, { done: 1, total: 3, failed: 0, ready: false });
  assert.equal(w.callsOf('review').length, 1);
  assert.equal(w.store.readSession(id).reviewedAt, null);
  // 다시 돌리면 남은 턴만 복기한다.
  t = 0;
  const again = await reviews.run(id);
  assert.deepEqual(again, { done: 3, total: 3, failed: 0, ready: true });
  assert.equal(w.callsOf('review').length, 3);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openStore, slugify } from '../skills/pressure-interview/scripts/lib/store.mjs';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '면접 기록 '));
  const store = openStore(dir);
  const id = store.createInterview('Redis', new Date(2026, 10, 18, 9, 5));
  return { dir, store, id };
}

const session = (id) => ({
  id,
  topic: 'C++ / "move"?',
  panel: [],
  questionLimit: 6,
  status: 'in_progress',
  userMentioned: [],
  unknownTechs: [],
  memory: {},
  createdAt: new Date(2026, 10, 18, 9, 5),
  finishedAt: null,
  reviewedAt: null,
});

const question = (extra = {}) => ({
  interviewerId: 'tech',
  addOn: false,
  causeTurnId: null,
  reactionIntent: null,
  defect: null,
  targetAxis: 'depth',
  draft: { text: '질문' },
  prepared: { flags: [], attempts: 1 },
  pendingSecondary: null,
  createdAt: new Date(2026, 10, 18, 9, 6),
  ...extra,
});

const lockPath = (dir, id, seq) => path.join(dir, 'interviews', id, 'hidden', 'turns', String(seq).padStart(2, '0'), 'key.lock');

test('slugify', () => {
  assert.equal(slugify('C++ / "move"?'), 'C-move');
  assert.equal(slugify('레디스 Redis'), '레디스-Redis');
  assert.equal(slugify('가'.repeat(200)).length, 40);
  assert.equal(slugify('???'), 'interview');
});

test('같은 분에 같은 주제로 두 번 만들면 번호가 붙는다', () => {
  const { store, id } = setup();
  assert.match(id, /^2026-11-18-0905-Redis$/);
  assert.equal(store.createInterview('Redis', new Date(2026, 10, 18, 9, 5)), `${id}-2`);
  assert.ok(store.createInterview('Redis', new Date(2026, 10, 18, 9, 5)).endsWith('-3'));
});

test('세션을 쓰고 읽으면 날짜가 Date이고 주제가 그대로다', () => {
  const { store, id } = setup();
  store.writeSession(id, session(id));
  const s = store.readSession(id);
  assert.equal(s.topic, 'C++ / "move"?');
  assert.ok(s.createdAt instanceof Date);
  assert.equal(s.finishedAt, null);
  assert.equal(store.listInterviews().length, 1);
  assert.equal(store.listInterviews()[0].questionCount, 0);
});

test('턴을 파일들에서 합친다', () => {
  const { store, id } = setup();
  store.writeQuestion(id, 1, question({ reactionIntent: 'probe', pendingSecondary: { x: 1 } }));
  let [t] = store.readTurns(id);
  assert.equal(t.seq, 1);
  assert.equal(t.id, '01');
  assert.equal(t.sessionId, id);
  assert.equal(t.question.answerKey, null);
  assert.equal(t.prepared.answerKeyCorrected, false);
  assert.equal(t.answer, null);
  assert.equal(t.review, null);
  assert.equal(t.verification, null);
  assert.deepEqual(t.clarifications, []);
  assert.equal(t.answerStartMs, null);
  assert.equal(t.interviewerId, 'tech');
  assert.equal(t.addOn, false);
  assert.equal(t.causeTurnId, null);
  assert.equal(t.reactionIntent, 'probe');
  assert.equal(t.defect, null);
  assert.equal(t.targetAxis, 'depth');
  assert.deepEqual(t.pendingSecondary, { x: 1 });

  store.writeKey(id, 1, { answerKey: { points: ['a'] }, verification: { ok: true }, answerKeyCorrected: true });
  [t] = store.readTurns(id);
  assert.deepEqual(t.question.answerKey, { points: ['a'] });
  assert.deepEqual(t.verification, { ok: true });
  assert.equal(t.prepared.answerKeyCorrected, true);

  store.writeAnswer(id, 1, { answer: '답', answeredAt: new Date(), clarifications: [], analysis: null, pick: null });
  [t] = store.readTurns(id);
  assert.ok(t.answeredAt instanceof Date);
  assert.equal(t.answer, '답');
});

test('쓰다 만 임시 파일은 읽지 않는다', () => {
  const { dir, store, id } = setup();
  const turn = path.join(dir, 'interviews', id, 'hidden', 'turns', '01');
  fs.mkdirSync(turn, { recursive: true });
  fs.writeFileSync(path.join(turn, 'question.json.tmp-123'), '{');
  assert.deepEqual(store.readTurns(id), []);
});

test('잠금은 한쪽만 잡는다', () => {
  const { store, id } = setup();
  const release = store.acquireKeyLock(id, 1, 60000);
  assert.equal(typeof release, 'function');
  assert.equal(store.acquireKeyLock(id, 1, 60000), null);
  release();
  assert.equal(typeof store.acquireKeyLock(id, 1, 60000), 'function');
});

test('죽은 프로세스의 잠금은 치우고 잡는다', () => {
  const { dir, store, id } = setup();
  store.acquireKeyLock(id, 1, 60000);
  fs.writeFileSync(lockPath(dir, id, 1), JSON.stringify({ pid: 999999, at: Date.now() }));
  assert.equal(typeof store.acquireKeyLock(id, 1, 60000), 'function');
});

test('오래된 잠금은 치우고 잡는다', () => {
  const { dir, store, id } = setup();
  store.acquireKeyLock(id, 1, 60000);
  fs.writeFileSync(lockPath(dir, id, 1), JSON.stringify({ pid: process.pid, at: Date.now() - 3600000 }));
  assert.equal(typeof store.acquireKeyLock(id, 1, 1000), 'function');
});

test('방금 만든 빈 잠금은 쓰는 중이므로 잡지 않는다', () => {
  const { dir, store, id } = setup();
  store.acquireKeyLock(id, 1, 60000);
  fs.writeFileSync(lockPath(dir, id, 1), '');
  assert.equal(store.acquireKeyLock(id, 1, 60000), null);
  assert.ok(fs.existsSync(lockPath(dir, id, 1)));
});

test('오래된 빈 잠금은 치우고 잡는다', () => {
  const { dir, store, id } = setup();
  store.acquireKeyLock(id, 1, 60000);
  fs.writeFileSync(lockPath(dir, id, 1), '');
  const old = new Date(Date.now() - 3600000);
  fs.utimesSync(lockPath(dir, id, 1), old, old);
  assert.equal(typeof store.acquireKeyLock(id, 1, 60000), 'function');
});

test('푸는 함수는 남의 잠금을 지우지 않는다', () => {
  const { dir, store, id } = setup();
  const release = store.acquireKeyLock(id, 1, 60000);
  fs.writeFileSync(lockPath(dir, id, 1), JSON.stringify({ pid: 1, at: 12345 }));
  release();
  assert.ok(fs.existsSync(lockPath(dir, id, 1)));
});

test('답 파일: BOM과 CRLF를 고치고, 지우지 않는다', () => {
  const { store, id } = setup();
  const file = store.answerFile(id, 3, 1);
  assert.ok(file.endsWith('/answers/03-1.txt'));
  assert.ok(!file.includes('\\'));
  fs.writeFileSync(file, '\uFEFF가\r\n나');
  assert.equal(store.readAnswerFile(file), '가\n나');
  assert.ok(fs.existsSync(file));
  store.removeAnswerFile(file);
  assert.ok(!fs.existsSync(file));
  assert.doesNotThrow(() => store.removeAnswerFile(file));
});

test('답 파일: 없거나 공백뿐이면 null', () => {
  const { store, id } = setup();
  const file = store.answerFile(id, 1, 1);
  assert.equal(store.readAnswerFile(file), null);
  fs.writeFileSync(file, ' \r\n\t ');
  assert.equal(store.readAnswerFile(file), null);
});

test('답 파일: 2만 자와 "끝"을 그대로 돌려준다', () => {
  const { store, id } = setup();
  const file = store.answerFile(id, 1, 1);
  const text = `${'가'.repeat(20000)}끝`;
  fs.writeFileSync(file, text);
  assert.equal(store.readAnswerFile(file), text);
  assert.ok(store.readAnswerFile(file).endsWith('끝'));
});

test('호출 기록은 붙여 쓴다', () => {
  const { store, id } = setup();
  store.appendCall(id, { kind: 'question' });
  store.appendCall(id, { kind: 'leak' });
  assert.equal(store.readCalls(id).length, 2);
});

test('기억 파일이 없으면 빈 목록, 쓰고 읽으면 lastSeenAt과 createdAt이 Date', () => {
  const { store } = setup();
  assert.deepEqual(store.readMemory(), []);
  store.writeMemory([{ id: 'a', lastSeenAt: new Date(), createdAt: new Date() }]);
  const [r] = store.readMemory();
  assert.ok(r.lastSeenAt instanceof Date);
  assert.ok(r.createdAt instanceof Date);
});

test('없는 면접은 not_found', () => {
  const { store } = setup();
  assert.throws(() => store.readSession('없음'), (e) => e.code === 'not_found');
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CLOSING_TEXT } from '../skills/pressure-interview/scripts/lib/app/session/session-rules.mjs';
import { DEFAULTS } from '../skills/pressure-interview/scripts/lib/config.mjs';
import { createInterviewService } from '../skills/pressure-interview/scripts/lib/interview.mjs';
import { openStore } from '../skills/pressure-interview/scripts/lib/store.mjs';
import { analysis, draft, fakeLlm, key } from './helpers.mjs';

const plain = (text = '기본 질문입니다.') => draft({ text, assumption: { axis: 'none', statement: '' } });
const NO_CORRECTIONS = { premiseOk: true, problems: [], corrections: { lists: [], alternatives: { changed: false, items: [] } } };
const CORRECTING_VERIFY = {
  premiseOk: true,
  problems: [{ field: 'keyPoints', problem: 'p' }],
  corrections: { lists: [{ field: 'keyPoints', items: ['고친 핵심'] }], alternatives: { changed: false, items: [] } },
};
const WITH_SECONDARY = analysis({
  defects: [
    { type: 'wrong', axis: 'durability', note: 'n1' },
    { type: 'missing_axis', axis: 'scale', note: 'n2' },
  ],
});
const CLARIFY = analysis({ kind: 'clarify' });
const REPLY = '범위는 한 대의 서버입니다.';
const DEFAULT_REPLIES = {
  jobRole: { role: 'dba' },
  question: plain(),
  leak: { techs: [] },
  premise: { premiseOk: true, problems: [] },
  answerKey: key(),
  verify: NO_CORRECTIONS,
  analyze: analysis(),
  clarify: { reply: REPLY },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond) {
  for (let i = 0; i < 500 && !cond(); i++) await sleep(5);
  assert.ok(cond(), '조건이 오지 않았다');
}

// 종류마다 앞에 둔 응답을 먼저 쓰고, 그 뒤로는 기본 응답을 쓴다.
function setup({ queues = {}, launch, configPatch = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '면접 기록 '));
  const store = openStore(dataDir);
  const config = { ...DEFAULTS, dataDir, pollMs: 10, ...configPatch };
  const filled = Object.fromEntries(
    Object.entries(DEFAULT_REPLIES).map(([kind, value]) => [kind, [...(queues[kind] ?? []), ...Array(30).fill(value)]]),
  );
  const fake = fakeLlm(filled);
  const launched = [];
  const svc = createInterviewService({
    store,
    config,
    llmFor: () => fake.llm,
    rng: () => 0,
    launchCompletion: launch ?? ((id, seq) => launched.push([id, seq])),
  });
  const callsOf = (kind) => fake.calls.filter((c) => c.kind === kind);
  const kinds = () => fake.calls.map((c) => c.kind);
  const turnDir = (id, seq) => path.join(dataDir, 'interviews', id, 'hidden', 'turns', String(seq).padStart(2, '0'));
  return { dataDir, store, config, fake, launched, svc, callsOf, kinds, turnDir };
}

async function begin(w, over = {}) {
  const v = await w.svc.start({ topic: 'Redis', ...over });
  return v.id;
}
const answer = (w, id, text = '답입니다.') => w.svc.submitAnswer(id, text);

test('시작하면 직무를 고르고 첫 질문을 만든다', async () => {
  const w = setup();
  const v = await w.svc.start({ topic: 'Redis' });
  assert.deepEqual(w.kinds(), ['jobRole', 'question', 'leak']);
  const s = w.store.readSession(v.id);
  assert.equal(s.panel.length, 3);
  assert.deepEqual(s.panel.map((m) => m.role), ['dba', 'textbook', 'scenario']);
  assert.deepEqual(s.userMentioned, ['Redis']);
  assert.equal(s.status, 'in_progress');
  const [t] = w.store.readTurns(v.id);
  assert.equal(t.question.answerKey, null);
  assert.equal(t.pendingSecondary, null);
  assert.equal(v.open.seq, 1);
  assert.equal(v.open.inputNo, 1);
  assert.equal(v.open.addOn, false);
  assert.equal(v.open.text, '기본 질문입니다.');
  assert.equal(v.open.roleName, 'DBA');
  assert.deepEqual(v.open.clarifications, []);
  assert.equal(v.pending, 'answer');
  assert.equal(v.status, 'in_progress');
  assert.equal(v.turnCount, 1);
  assert.equal(v.closing, null);
  assert.deepEqual(w.launched, [[v.id, 1]]);
  assert.equal(w.svc.current(), v.id);
});

test('주제의 글자는 세션에 그대로 남는다', async () => {
  const w = setup();
  const v = await w.svc.start({ topic: 'C++ / "move"?' });
  assert.equal(w.store.readSession(v.id).topic, 'C++ / "move"?');
  assert.equal(v.topic, 'C++ / "move"?');
  assert.ok(v.id.includes('C-move'));
});

test('진행 중인 면접이 있으면 start는 interview_open', async () => {
  const w = setup();
  await begin(w);
  await assert.rejects(w.svc.start({ topic: 'Kafka' }), { code: 'interview_open' });
  assert.equal(w.store.listInterviews().length, 1);
});

test('시작이 실패하면 면접이 남지 않는다', async () => {
  const w = setup({ queues: { question: [new Error('boom')] } });
  await assert.rejects(w.svc.start({ topic: 'Redis' }), /boom/);
  assert.deepEqual(w.store.listInterviews(), []);
  assert.equal(w.svc.current(), null);
});

test('답하면 분석하고 다음 질문을 만든다', async () => {
  const w = setup();
  const id = await begin(w);
  const v = await answer(w, id);
  assert.equal(v.turnCount, 2);
  assert.equal(v.open.seq, 2);
  const [first, second] = w.store.readTurns(id);
  assert.equal(first.answer, '답입니다.');
  assert.notEqual(first.analysis, null);
  assert.equal(second.causeTurnId, '01');
  assert.equal(second.interviewerId, first.pick.interviewerId);
  assert.equal(second.reactionIntent, first.pick.reactionIntent);
  assert.deepEqual(second.defect, first.pick.defect);
  assert.deepEqual(second.defect, { type: 'none', axis: 'durability', note: '' });
  assert.deepEqual(w.launched, [[id, 1], [id, 2]]);
});

test('세션을 쓰고 answer.json을 쓰기 전에 죽어도 다시 분석한 결과가 같다', async () => {
  const told = analysis({ mentionedTechs: ['Sentinel'], unknownTechs: ['Raft'] });
  const w = setup({ queues: { analyze: [told, told] } });
  const id = await begin(w);
  const write = w.store.writeAnswer;
  let failed = false;
  w.store.writeAnswer = (sid, seq, a) => {
    if (!failed && a.analysis !== null) {
      failed = true;
      throw new Error('분석을 저장하기 전에 죽었다');
    }
    return write(sid, seq, a);
  };
  await assert.rejects(answer(w, id), /죽었다/);
  assert.ok(w.store.readSession(id).unknownTechs.includes('Raft'), '세션은 먼저 쓰였어야 한다');
  const v = await w.svc.resume(id);
  assert.equal(v.turnCount, 2);
  assert.equal(w.callsOf('analyze').length, 2);
  const s = w.store.readSession(id);
  assert.deepEqual(s.userMentioned, [...new Set(s.userMentioned)]);
  assert.deepEqual(s.unknownTechs, [...new Set(s.unknownTechs)]);
  assert.ok(s.userMentioned.includes('Sentinel'));
  assert.deepEqual(s.unknownTechs, ['Raft']);
});

test('둘째 질문의 user 메시지에 기억과 말한 기술이 실린다', async () => {
  const w = setup({ queues: { analyze: [analysis({ mentionedTechs: ['Sentinel'] })] } });
  const at = new Date();
  w.store.writeMemory([
    { id: 'm1', axis: 'scale', statement: '요청이 백 배로 는다.', status: 'well', lastSeenAt: at, createdAt: at, encounters: [] },
  ]);
  const id = await begin(w);
  await answer(w, id);
  const user = w.callsOf('question')[1].user;
  assert.ok(user.includes('다시 내지 않는 가정'));
  assert.ok(user.includes('요청이 백 배로 는다.'));
  assert.ok(user.includes('Sentinel'));
});

test('되묻기면 같은 턴에 응답을 붙이고 답을 다시 기다린다', async () => {
  const w = setup({ queues: { analyze: [CLARIFY] } });
  const id = await begin(w);
  const v = await answer(w, id, '읽기 위주인가요?');
  assert.equal(v.open.seq, 1);
  assert.equal(v.open.inputNo, 2);
  assert.deepEqual(v.open.clarifications, [{ ask: '읽기 위주인가요?', reply: REPLY }]);
  assert.equal(v.pending, 'answer');
  const [t] = w.store.readTurns(id);
  assert.equal(t.answer, null);
  assert.equal(t.analysis, null);
});

test('되묻기 기록은 다음 질문과 정답지의 대화에 앱과 같은 꼴로 실린다', async () => {
  const w = setup({ queues: { analyze: [CLARIFY], question: [plain('첫 질문'), plain('둘째 질문')] } });
  const id = await begin(w);
  await answer(w, id, '읽기 위주인가요?');
  await answer(w, id, '답입니다.');
  const line = `첫 질문\n(되묻기) 지원자: 읽기 위주인가요? / 면접관: ${REPLY}`;
  assert.ok(w.callsOf('question')[1].user.includes(line));
  await w.svc.complete(id, 2);
  const keyUser = w.callsOf('answerKey').at(-1).user;
  assert.ok(keyUser.includes(line));
  assert.ok(keyUser.includes('답입니다.'));
  assert.equal(keyUser.split('둘째 질문').length - 1, 1);
  assert.ok(keyUser.includes('질문 문장: 둘째 질문'));
});

test('되묻기 응답이 실패한 뒤 resume은 분석을 다시 하지 않는다', async () => {
  const w = setup({ queues: { analyze: [CLARIFY], clarify: [new Error('boom')] } });
  const id = await begin(w);
  await assert.rejects(answer(w, id, '읽기 위주인가요?'), /boom/);
  assert.equal(w.svc.view(id).pending, 'retry');
  const v = await w.svc.resume(id);
  assert.equal(w.callsOf('analyze').length, 1);
  assert.equal(v.open.clarifications.length, 1);
  assert.equal(v.pending, 'answer');
});

test('분석이 실패하면 답은 남고 resume이 이어 간다', async () => {
  const w = setup({ queues: { analyze: [new Error('boom')] } });
  const id = await begin(w);
  await assert.rejects(answer(w, id), /boom/);
  const v = w.svc.view(id);
  assert.equal(v.pending, 'retry');
  assert.equal(v.open, null);
  assert.equal(w.store.readTurns(id)[0].answer, '답입니다.');
  const after = await w.svc.resume(id);
  assert.equal(after.turnCount, 2);
  assert.equal(w.callsOf('analyze').length, 2);
});

test('질문 생성이 실패한 뒤 resume은 분석을 다시 하지 않고, 말한 기술과 모른다고 한 기술이 한 번만 들어가 있다', async () => {
  const w = setup({
    queues: {
      question: [plain(), new Error('boom')],
      analyze: [analysis({ mentionedTechs: ['Sentinel'], unknownTechs: ['Memcached'] })],
    },
  });
  const id = await begin(w);
  await assert.rejects(answer(w, id), /boom/);
  assert.notEqual(w.store.readTurns(id)[0].analysis, null);
  const v = await w.svc.resume(id);
  assert.equal(v.turnCount, 2);
  assert.equal(w.callsOf('analyze').length, 1);
  const s = w.store.readSession(id);
  assert.deepEqual(s.userMentioned, ['Redis', 'Sentinel']);
  assert.deepEqual(s.unknownTechs, ['Memcached']);
});

test('secondary가 있는 답 뒤에 질문 생성이 한 번 실패해도, 다시 하면 primary가 먼저 묻는다', async () => {
  const w = setup({ queues: { analyze: [WITH_SECONDARY], question: [plain(), new Error('boom')] } });
  const id = await begin(w);
  await assert.rejects(answer(w, id), /boom/);
  assert.equal(w.store.readTurns(id).length, 1);
  assert.equal(w.store.readTurns(id).at(-1).pendingSecondary, null);
  await w.svc.resume(id);
  const second = w.store.readTurns(id)[1];
  assert.equal(second.addOn, false);
  assert.equal(second.interviewerId, 'p1');
  assert.equal(second.pendingSecondary.causeTurnId, '01');
  assert.equal(second.pendingSecondary.choice.interviewerId, 'p3');
});

test('답이 저장된 턴에 submitAnswer를 다시 부르면 답을 바꾸지 않고 이어 간다', async () => {
  const w = setup({ queues: { analyze: [new Error('boom')] } });
  const id = await begin(w);
  await assert.rejects(answer(w, id), /boom/);
  const v = await w.svc.submitAnswer(id, '다른 글');
  assert.equal(w.store.readTurns(id)[0].answer, '답입니다.');
  assert.equal(v.turnCount, 2);
});

test('답 파일은 답이 저장된 뒤에 지운다', async () => {
  const w = setup({ queues: { analyze: [new Error('boom')] } });
  const id = await begin(w);
  const file = w.store.answerFile(id, 1, 1);
  fs.writeFileSync(file, '답입니다.');
  await assert.rejects(w.svc.submitAnswer(id, '답입니다.', file), /boom/);
  assert.equal(fs.existsSync(file), false);
  // 답이 이미 저장된 턴에 불러도 지운다
  fs.writeFileSync(file, '다른 글');
  await w.svc.submitAnswer(id, '다른 글', file);
  assert.equal(fs.existsSync(file), false);

  const w2 = setup();
  const id2 = await begin(w2);
  const file2 = w2.store.answerFile(id2, 1, 1);
  fs.writeFileSync(file2, '답입니다.');
  w2.store.writeAnswer = () => {
    throw new Error('disk full');
  };
  await assert.rejects(w2.svc.submitAnswer(id2, '답입니다.', file2), /disk full/);
  assert.equal(fs.existsSync(file2), true);
});

test('정답지 뒤 작업이 돌고 있으면 기다렸다가 분석한다. 정답지 호출은 한 번이다', async () => {
  let release;
  const held = new Promise((r) => (release = () => r(key({ keyPoints: ['k1', '늦은-핵심'] }))));
  const w = setup({ queues: { answerKey: [() => held] } });
  const id = await begin(w);
  const completing = w.svc.complete(id, 1);
  await until(() => w.callsOf('answerKey').length === 1);
  const submitting = answer(w, id);
  await sleep(50);
  assert.equal(w.callsOf('analyze').length, 0);
  release();
  await Promise.all([completing, submitting]);
  const kinds = w.kinds();
  const beforeAnalyze = kinds.slice(0, kinds.indexOf('analyze'));
  assert.equal(beforeAnalyze.filter((k) => k === 'answerKey').length, 1);
  assert.equal(beforeAnalyze.filter((k) => k === 'verify').length, 1);
  assert.ok(kinds.indexOf('analyze') > kinds.indexOf('verify'));
  assert.ok(w.callsOf('analyze')[0].user.includes('늦은-핵심'));
});

test('뒤 작업이 없으면 답이 왔을 때 그 자리에서 정답지를 만든다', async () => {
  const w = setup({ launch: () => {} });
  const id = await begin(w);
  assert.equal(w.callsOf('answerKey').length, 0);
  const v = await answer(w, id);
  assert.equal(v.turnCount, 2);
  assert.equal(w.callsOf('answerKey').length, 1);
  assert.deepEqual(w.store.readKey(id, 1).answerKey, key());
  assert.equal(fs.existsSync(path.join(w.turnDir(id, 1), 'key.lock')), false);
});

test('뒤 작업이 실패하면 로그만 남기고, 답이 왔을 때 다시 만든다', async () => {
  const w = setup({ queues: { answerKey: [new Error('뒤 작업 실패')] } });
  const id = await begin(w);
  await w.svc.complete(id, 1);
  const log = path.join(w.dataDir, 'interviews', id, 'hidden', 'errors.log');
  assert.ok(fs.readFileSync(log, 'utf8').includes('뒤 작업 실패'));
  assert.equal(w.store.readKey(id, 1), null);
  assert.equal(fs.existsSync(path.join(w.turnDir(id, 1), 'key.lock')), false);
  const v = await answer(w, id);
  assert.equal(v.turnCount, 2);
  assert.equal(w.callsOf('answerKey').length, 2);
});

test('같은 턴에 complete를 동시에 두 번 불러도 정답지 호출은 한 번이다', async () => {
  const w = setup();
  const id = await begin(w);
  await Promise.all([w.svc.complete(id, 1), w.svc.complete(id, 1)]);
  assert.equal(w.callsOf('answerKey').length, 1);
  assert.equal(w.callsOf('verify').length, 1);
  assert.deepEqual(w.store.readKey(id, 1).answerKey, key());
  await w.svc.complete(id, 1);
  assert.equal(w.callsOf('answerKey').length, 1);
});

test('잠금을 잡은 사이에 정답지가 쓰였으면 다시 만들지 않는다', async () => {
  const planted = { answerKey: key({ keyPoints: ['심은 핵심'] }), verification: { premiseOk: true, problems: [] }, answerKeyCorrected: false };
  const plant = (w) => {
    const acquire = w.store.acquireKeyLock;
    w.store.acquireKeyLock = (id, seq, staleMs) => {
      w.store.writeKey(id, seq, planted);
      return acquire(id, seq, staleMs);
    };
  };

  const a = setup();
  const idA = await begin(a);
  plant(a);
  await a.svc.complete(idA, 1);
  assert.equal(a.callsOf('answerKey').length, 0);
  assert.deepEqual(a.store.readKey(idA, 1), planted);
  assert.equal(fs.existsSync(path.join(a.turnDir(idA, 1), 'key.lock')), false);

  const b = setup();
  const idB = await begin(b);
  plant(b);
  const v = await answer(b, idB);
  assert.equal(v.turnCount, 2);
  assert.equal(b.callsOf('answerKey').length, 0);
  assert.deepEqual(b.store.readKey(idB, 1), planted);
  assert.ok(b.callsOf('analyze')[0].user.includes('심은 핵심'));
});

test('죽은 잠금만 남아 있어도 답이 오면 치우고 정답지를 만든다', async () => {
  const w = setup();
  const id = await begin(w);
  fs.writeFileSync(path.join(w.turnDir(id, 1), 'key.lock'), JSON.stringify({ pid: 999999, at: Date.now() }));
  const v = await answer(w, id);
  assert.equal(v.turnCount, 2);
  assert.equal(w.callsOf('answerKey').length, 1);
  assert.equal(fs.existsSync(path.join(w.turnDir(id, 1), 'key.lock')), false);
});

test('resume은 정답지도 잠금도 없으면 뒤 작업을 다시 띄우고, 살아 있는 잠금이 있으면 띄우지 않는다', async () => {
  const w = setup();
  const id = await begin(w);
  w.launched.length = 0;
  await w.svc.resume(id);
  assert.deepEqual(w.launched, [[id, 1]]);
  const lock = path.join(w.turnDir(id, 1), 'key.lock');
  assert.equal(fs.existsSync(lock), false);

  w.launched.length = 0;
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  await w.svc.resume(id);
  assert.deepEqual(w.launched, []);
  assert.equal(fs.existsSync(lock), true);

  // 정답지가 있으면 띄우지 않는다
  fs.rmSync(lock);
  await w.svc.complete(id, 1);
  await w.svc.resume(id);
  assert.deepEqual(w.launched, []);
});

test('검증이 정답지를 고치면 분석은 고친 정답지를 받는다', async () => {
  const w = setup({ queues: { verify: [CORRECTING_VERIFY] } });
  const id = await begin(w);
  await answer(w, id);
  assert.ok(w.callsOf('analyze')[0].user.includes('고친 핵심'));
  const k = w.store.readKey(id, 1);
  assert.equal(k.answerKeyCorrected, true);
  assert.deepEqual(k.answerKey.keyPoints, ['고친 핵심']);
  assert.equal(w.store.readTurns(id)[0].prepared.answerKeyCorrected, true);
});

test('덧붙이기: secondary가 있으면 다음 질문 뒤에 다른 면접관이 addOn으로 묻는다', async () => {
  const w = setup({ queues: { analyze: [WITH_SECONDARY] } });
  const id = await begin(w);
  const second = await answer(w, id);
  assert.equal(second.open.addOn, false);
  const third = await answer(w, id);
  assert.equal(third.open.seq, 3);
  assert.equal(third.open.addOn, true);
  assert.equal(third.open.roleName, '시나리오형');
  const t3 = w.store.readTurns(id)[2];
  assert.equal(t3.addOn, true);
  assert.equal(t3.interviewerId, 'p3');
  assert.equal(t3.causeTurnId, '01');
  assert.equal(t3.pendingSecondary, null);
  assert.ok(!w.callsOf('question').at(-1).user.includes('덧붙이는 질문'));
});

test('덧붙이기가 기다리는데 지원자가 모른다고 하면 덧붙이기를 버리고 같은 면접관이 넘어간다', async () => {
  const w = setup({ queues: { analyze: [WITH_SECONDARY, analysis({ unknownTechs: ['Memcached'] })] } });
  const id = await begin(w);
  await answer(w, id);
  await answer(w, id, 'Memcached는 모르겠습니다.');
  const [, t2, t3] = w.store.readTurns(id);
  assert.equal(t3.addOn, false);
  assert.equal(t3.interviewerId, t2.interviewerId);
  assert.equal(t3.reactionIntent, 'B11');
  assert.equal(t3.causeTurnId, '02');
  assert.equal(t3.pendingSecondary, null);
});

test('모른다고 한 기술은 쌓여 이후 질문에 실린다. 스스로 꺼낸 모름도 쌓이고 말한 기술에는 들어가지 않는다', async () => {
  const w = setup({
    queues: {
      analyze: [
        analysis({ unknownTechs: ['Memcached'] }),
        analysis({ mentionedTechs: ['Patroni'], selfUnknownTechs: ['Patroni'] }),
      ],
    },
  });
  const id = await begin(w);
  await answer(w, id, '잘 모르겠습니다.');
  const line = '지원자가 모른다고 한 기술(질문에 다시 넣지 않는다. 전제로도 쓰지 않는다)';
  assert.ok(w.callsOf('question').at(-1).user.includes(`${line}: Memcached`));
  assert.deepEqual(w.store.readSession(id).unknownTechs, ['Memcached']);
  await answer(w, id, 'Patroni 같은 도구는 써 본 적이 없어서 모릅니다.');
  const s = w.store.readSession(id);
  assert.deepEqual(s.unknownTechs, ['Memcached', 'Patroni']);
  assert.ok(!s.userMentioned.includes('Patroni'));
  assert.ok(w.callsOf('question').at(-1).user.includes(`${line}: Memcached, Patroni`));
});

test('절반을 넘도록 가정 변경이 없으면 정체성 비교 축을 지정한다', async () => {
  const w = setup();
  const id = await begin(w, { questionLimit: 4 });
  await answer(w, id);
  assert.ok(!w.callsOf('question').at(-1).user.includes('identity_swap'));
  await answer(w, id);
  assert.ok(w.callsOf('question').at(-1).user.includes('새 영역: '));
  assert.equal(w.store.readTurns(id)[2].targetAxis, 'identity_swap');
});

test('질문 수에 닿으면 마지막 답을 분석하고 끝낸다', async () => {
  const w = setup();
  const id = await begin(w, { questionLimit: 2 });
  await answer(w, id);
  const v = await answer(w, id);
  assert.equal(v.status, 'finished');
  assert.equal(v.closing, CLOSING_TEXT);
  assert.equal(v.open, null);
  assert.equal(v.pending, null);
  assert.equal(v.turnCount, 2);
  assert.equal(w.callsOf('analyze').length, 2);
  assert.notEqual(w.store.readTurns(id)[1].analysis, null);
  const s = w.store.readSession(id);
  assert.equal(s.status, 'finished');
  assert.ok(s.finishedAt instanceof Date);
  assert.equal(w.svc.current(), null);
});

test('끝난 면접에 온 답은 finished 오류', async () => {
  const w = setup();
  const id = await begin(w);
  await w.svc.finish(id);
  await assert.rejects(answer(w, id), { code: 'finished' });
  assert.equal(w.store.readTurns(id)[0].answer, null);
});

test('finish는 답이 없는 턴이 있어도 끝낸다', async () => {
  const w = setup();
  const id = await begin(w);
  const v = await w.svc.finish(id);
  assert.equal(v.status, 'finished');
  assert.equal(v.closing, CLOSING_TEXT);
  assert.equal(v.open, null);
  assert.equal(w.store.readTurns(id)[0].answer, null);
  const finishedAt = w.store.readSession(id).finishedAt;
  assert.ok(finishedAt instanceof Date);
  assert.equal((await w.svc.finish(id)).status, 'finished');
  assert.deepEqual(w.store.readSession(id).finishedAt, finishedAt);
  assert.equal(w.svc.current(), null);
});

test('할 일이 없으면 resume은 모델 호출 없이 view를 준다', async () => {
  const w = setup();
  const id = await begin(w);
  const before = w.fake.calls.length;
  const v = await w.svc.resume(id);
  assert.equal(w.fake.calls.length, before);
  assert.deepEqual(v, w.svc.view(id));
  assert.equal(v.pending, 'answer');
});

test('submitAnswer는 걸린 시간을 남긴다', async () => {
  const w = setup();
  const id = await begin(w);
  await answer(w, id);
  const wait = w.store.readCalls(id).find((r) => r.type === 'wait');
  assert.equal(wait.seq, 1);
  assert.equal(typeof wait.wall_ms, 'number');
});

test('view에 숨길 값이 없다', async () => {
  const w = setup({
    queues: {
      question: [draft()],
      answerKey: [key({ keyPoints: ['비밀-핵심'] })],
      analyze: [analysis({ defects: [{ type: 'vague', axis: 'durability', note: '결함-메모-비밀' }] })],
    },
  });
  const id = await begin(w);
  const hidden = ['PostgreSQL이 디스크 없이 동작', '결함-메모-비밀', '비밀-핵심', '디스크 I/O', '데이터 모델', '집요형', '조력형', '흔드는형'];
  const views = [w.svc.view(id), await answer(w, id), await w.svc.finish(id)];
  for (const v of views) {
    const json = JSON.stringify(v);
    for (const h of hidden) assert.ok(!json.includes(h), `${h}가 view에 있다`);
  }
  assert.deepEqual(Object.keys(views[1]).sort(), ['closing', 'id', 'open', 'pending', 'questionLimit', 'status', 'topic', 'turnCount']);
  assert.deepEqual(Object.keys(views[1].open).sort(), ['addOn', 'clarifications', 'inputNo', 'roleName', 'seq', 'text']);
});

// 설계 10장의 숨김 누출 검사. 숨길 필드마다 표식을 심고, 면접이 끝나기 전의 어떤 출력에도 나오지 않는지 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  axisName, DEFECT_NAMES, QUESTION_INTENTS, REACTION_INTENTS, REACTION_TABLE, TEMPERAMENTS,
} from '../skills/pressure-interview/scripts/lib/app/interview/catalog.mjs';
import { analysis, answer, draft, judgment, key, makeWorld, push, replies, review, run, stock, topicMap } from './helpers.mjs';

const M = '@@HIDDEN@@';
// 카탈로그 값이라 표식을 심을 수 없는 숨김 필드는 이 흐름에서 생기는 화면 이름으로 본다.
const SECRETS = [
  M, ...Object.values(TEMPERAMENTS),
  QUESTION_INTENTS.A1,
  ...Object.values(REACTION_TABLE.wrong).map((b) => REACTION_INTENTS[b]),
  DEFECT_NAMES.wrong,
  axisName('identity_swap'), axisName('durability'),
];

// 질문 문장과 되묻기 응답에는 심지 않는다. 그것은 화면에 나간다.
const marked = () =>
  replies({
    question: draft({ assumption: { axis: 'identity_swap', statement: `PostgreSQL이 디스크 없이 동작 ${M}` } }),
    premise: { premiseOk: true, problems: [{ field: 'statement', problem: M }] },
    answerKey: key({ vanishing: [M], remaining: [M], alternatives: [{ name: M, traits: M }], keyPoints: [M] }),
    verify: {
      premiseOk: true,
      problems: [{ field: 'keyPoints', problem: M }],
      corrections: { lists: [{ field: 'keyPoints', items: [`${M} 고친 핵심`] }], alternatives: { changed: false, items: [] } },
    },
    analyze: analysis({ defects: [{ type: 'wrong', axis: 'durability', note: M }], signals: [{ type: 'practical', quote: M }] }),
    topicMap: { areas: topicMap().areas.map((a) => ({ ...a, name: `${a.name} ${M}`, why: M, angles: [M] })) },
    endJudge: judgment({ candidates: [{ question: M, verdict: 'repeat', why: M }], note: M, direction: M }),
    review: review({
      intent: { aimed: true, note: M },
      defects: [{ index: 0, verdict: 'valid', note: M }],
      reactions: [{ index: 0, verdict: 'valid_point', note: M }],
      assumption: { result: 'wobbly', note: M, sameAs: null },
      keyProblems: [M],
    }),
  });

function clean(r, label) {
  const all = r.stdout + r.stderr;
  for (const s of SECRETS) assert.ok(!all.includes(s), `${label}: ${s}\n${all}`);
  return r;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 5000) {
  for (const end = Date.now() + ms; !cond() && Date.now() < end; ) await sleep(100);
  return cond();
}
const errorsLog = (w, id) => {
  const file = path.join(w.dataDir, 'interviews', id, 'hidden', 'errors.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

test('면접이 끝나기 전의 어떤 출력에도 표식이 없다', () => {
  const w = makeWorld();
  push(w.fakeDir, 'analyze', { data: analysis({ kind: 'clarify' }) });
  stock(w.fakeDir, marked());
  clean(run(w, ['status']), 'status');
  const s = clean(run(w, ['start', '--topic', 'Redis']), 'start');
  const c = clean(answer(w, s.json, '범위가 어디까지인가요?'), 'answer(되묻기)');
  assert.equal(c.json.kind, 'clarify');
  const q = clean(answer(w, c.json, '답입니다.'), 'answer');
  assert.equal(q.json.kind, 'question');
  clean(run(w, ['resume']), 'resume');
  assert.equal(clean(run(w, ['start', '--topic', 'Kafka']), 'start(진행 중)').json.kind, 'confirm_replace');
  clean(run(w, ['status']), 'status');
  for (const args of [['review'], ['mark', '1', 'well'], ['surprise', '1', 'expected']]) {
    assert.equal(clean(run(w, args), args[0]).json.code, 'not_finished');
  }
  clean(run(w, ['stats']), 'stats');
});

test('실패할 때도 표식이 없다', () => {
  for (const bad of [{ raw: `{"structured_output": "${M} 깨진` }, { raw: M, exit: 1, stderr: M }]) {
    const w = makeWorld();
    push(w.fakeDir, 'analyze', bad);
    stock(w.fakeDir, marked());
    const s = clean(run(w, ['start', '--topic', 'Redis']), 'start');
    const r = clean(answer(w, s.json, '답입니다.'), 'answer');
    assert.equal(r.json.ok, false);
    assert.ok(errorsLog(w, s.json.interview).includes(M));
  }
});

test('뒤 작업이 실패해도 앞 명령의 출력에 표식이 없다', async () => {
  const w = makeWorld();
  push(w.fakeDir, 'answerKey', { raw: M, exit: 1 });
  stock(w.fakeDir, marked());
  const s = clean(run(w, ['start', '--topic', 'Redis']), 'start');
  assert.ok(await waitFor(() => errorsLog(w, s.json.interview).includes(M)), '뒤 작업의 실패가 기록되지 않았다');
  const r = clean(answer(w, s.json, '답입니다.'), 'answer');
  assert.equal(r.json.kind, 'question');
});

test('끝난 뒤에는 review.md에 표식이 있다', () => {
  const w = makeWorld();
  stock(w.fakeDir, marked());
  const s = run(w, ['start', '--topic', 'Redis']);
  const a1 = answer(w, s.json, '첫 답');
  answer(w, a1.json, '끝');
  const rv = run(w, ['review']);
  assert.equal(rv.json.kind, 'review_ready', rv.stdout);
  assert.ok(fs.readFileSync(rv.json.paths.review, 'utf8').includes(M));
});

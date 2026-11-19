import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CLOSING_TEXT } from '../skills/pressure-interview/scripts/lib/app/session/session-rules.mjs';
import { analysis, answer, fakeCalls, judgment, makeWorld, push, replies, run, stock } from './helpers.mjs';

const TAIL = 'hidden 폴더와 errors.log를 읽지 않는다.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 5000) {
  for (const end = Date.now() + ms; !cond() && Date.now() < end; ) await sleep(100);
  return cond();
}
const modelCalls = (w) => fakeCalls(w.fakeDir).filter((c) => c.kind !== 'auth' && c.kind !== 'version');
const CLI_MISSING = 'claude 명령을 찾지 못했습니다. Claude Code가 설치돼 있는지, 설정의 claudeCommand가 맞는지 확인해 주세요.';
const turnFile = (w, id, seq, name) =>
  path.join(w.dataDir, 'interviews', id, 'hidden', 'turns', String(seq).padStart(2, '0'), name);
const savedAnswer = (w, id, seq) => JSON.parse(fs.readFileSync(turnFile(w, id, seq, 'answer.json'), 'utf8')).answer;
const dropConfig = (w) => fs.rmSync(path.join(w.home, '.pressure-interview'), { recursive: true, force: true });

function world(patch) {
  const w = makeWorld(patch);
  stock(w.fakeDir, replies());
  return w;
}
const start = (w, topic = 'Redis') => run(w, ['start', '--topic', topic]);

test('설정이 없으면 어느 명령이든 setup_needed', () => {
  const w = world();
  dropConfig(w);
  for (const args of [['status'], ['start', '--topic', 'Redis'], ['answer'], ['review']]) {
    const r = run(w, args);
    assert.equal(r.status, 0, args.join(' '));
    assert.equal(r.stderr, '');
    assert.equal(r.json.kind, 'setup_needed');
    assert.ok(r.json.next.includes('setup --data-dir'));
  }
  assert.deepEqual(fakeCalls(w.fakeDir), []);
});

test('setup 뒤 status', () => {
  const w = world();
  dropConfig(w);
  const dir = path.join(w.home, '새 면접 폴더');
  const s = run(w, ['setup', '--data-dir', dir]);
  assert.equal(s.json.kind, 'status');
  assert.ok(s.json.say.includes(dir), s.json.say);
  assert.equal(s.json.next, '처음 받은 명령이 있었으면 그 명령을 다시 실행하고, 없었으면 사용자에게 면접 주제를 묻는다.');
  assert.ok(fs.existsSync(dir));
  assert.equal(run(w, ['status']).json.kind, 'status');
  fs.rmSync(dir, { recursive: true });
  assert.equal(run(w, ['status']).json.kind, 'setup_needed');
});

test('setup은 앞의 ~를 홈으로 푼다', () => {
  for (const arg of ['~', '~/면접 기록', '~\\면접 기록']) {
    const w = world();
    dropConfig(w);
    // 자식의 홈을 임시 폴더로 돌린다. 실제 홈을 건드리지 않는다.
    const homeWorld = { ...w, env: { ...w.env, USERPROFILE: w.home, HOME: w.home } };
    const want = arg === '~' ? w.home : path.join(w.home, '면접 기록');
    const s = run(homeWorld, ['setup', '--data-dir', arg]);
    assert.equal(s.json.kind, 'status', arg);
    assert.ok(s.json.say.includes(want), s.json.say);
    assert.ok(fs.existsSync(want), arg);
    assert.equal(fs.existsSync(path.resolve('~')), false);
  }
});

test('setup은 상대 경로를 bad_args로 거절하고 아무것도 만들지 않는다', () => {
  const w = world();
  dropConfig(w);
  const rel = 'pi 상대 경로 면접';
  const r = run(w, ['setup', '--data-dir', rel]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, '');
  assert.equal(r.json.code, 'bad_args');
  assert.equal(fs.existsSync(path.resolve(rel)), false);
  assert.equal(run(w, ['status']).json.kind, 'setup_needed');
});

test('start는 질문을 낸다', () => {
  const w = world();
  const r = start(w);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, `${JSON.stringify(r.json)}\n`);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.kind, 'question');
  assert.ok(r.json.say.includes('**질문 1 · '), r.json.say);
  assert.ok(r.json.answerFile.endsWith('/answers/01-1.txt'), r.json.answerFile);
  assert.equal(typeof r.json.interview, 'string');
});

test('떼어 낸 뒤 작업이 정답지를 남긴다', async () => {
  const w = world();
  const { json } = start(w);
  assert.ok(await waitFor(() => fs.existsSync(turnFile(w, json.interview, 1, 'key.json'))));
});

test('답 파일 없이 answer는 no_answer', () => {
  const w = world();
  const s = start(w);
  const r = run(w, ['answer']);
  assert.equal(r.status, 1);
  assert.equal(r.json.code, 'no_answer');
  assert.equal(r.json.answerFile, s.json.answerFile);
  assert.ok(r.json.next.endsWith(TAIL));
});

test('답은 글자 그대로 저장된다', () => {
  const w = world();
  const s = start(w);
  const id = s.json.interview;
  // 정확히 "끝"이 아니면 답이다
  const a1 = answer(w, s.json, '끝내 주세요');
  assert.equal(a1.json.kind, 'question');
  assert.ok(a1.json.say.startsWith('**질문 2 · '));
  assert.equal(savedAnswer(w, id, 1), '끝내 주세요');
  assert.equal(fs.existsSync(s.json.answerFile), false);
  const a2 = answer(w, a1.json, '가\r\n나');
  assert.equal(a2.json.kind, 'question');
  assert.equal(savedAnswer(w, id, 2), '가\n나');
  assert.equal(fs.existsSync(a1.json.answerFile), false);
});

test('resume은 열린 질문과 같은 answerFile을 다시 준다', async () => {
  const w = world();
  const s = start(w);
  assert.ok(await waitFor(() => fs.existsSync(turnFile(w, s.json.interview, 1, 'key.json'))));
  const before = modelCalls(w).length;
  const r = run(w, ['resume']);
  assert.equal(r.json.kind, 'question');
  assert.equal(r.json.say, s.json.say);
  assert.equal(r.json.answerFile, s.json.answerFile);
  assert.equal(modelCalls(w).length, before);
});

test('한 판: 답 하나, 끝, 복기, 고침, 표시, 추이', async () => {
  const w = world();
  const s = start(w);
  const id = s.json.interview;
  const a1 = answer(w, s.json, '첫 답입니다.');
  assert.equal(a1.json.kind, 'question');
  const a2 = answer(w, a1.json, '끝');
  // 답하지 않은 둘째 질문의 정답지 뒤 작업이 끝나야 호출 수가 멈춘다
  assert.ok(await waitFor(() => fs.existsSync(turnFile(w, id, 2, 'key.json'))));
  assert.equal(a2.json.kind, 'review_ready', a2.stdout);
  assert.ok(a2.json.say.startsWith(CLOSING_TEXT), a2.json.say);
  assert.equal(a2.json.answerFile, undefined);
  assert.ok(fs.existsSync(a2.json.paths.review));

  const rv = run(w, ['review']);
  assert.equal(rv.json.kind, 'review_ready', rv.stdout);
  assert.equal(rv.json.interview, id);
  assert.ok(fs.existsSync(rv.json.paths.review));
  assert.equal(run(w, ['mark', '1', 'well']).json.kind, 'marked');
  assert.equal(run(w, ['surprise', '1', 'unexpected', id]).json.kind, 'marked');
  const st = run(w, ['stats']);
  assert.equal(st.json.kind, 'stats');
  assert.ok(fs.existsSync(st.json.paths.stats));

  const rows = fs
    .readFileSync(path.join(w.dataDir, 'interviews', id, 'hidden', 'calls.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assert.equal(rows.filter((r) => r.type === undefined).length, modelCalls(w).length);
});

test('끝내는 명령에서 복기가 일부 실패하면 마무리 문장과 review 안내를 내고, resume도 복기를 이어 한다', async () => {
  const w = makeWorld();
  push(w.fakeDir, 'review', { raw: '{"api_error_status":429,"is_error":true}' });
  stock(w.fakeDir, replies());
  const s = start(w);
  const done = answer(w, answer(w, s.json, '첫 답').json, '끝');
  assert.ok(await waitFor(() => fs.existsSync(turnFile(w, s.json.interview, 2, 'key.json'))));
  assert.equal(done.json.kind, 'review_partial', done.stdout);
  assert.ok(done.json.say.startsWith(`${CLOSING_TEXT}\n\n`));
  assert.ok(done.json.next.includes('review를 실행한다'));
  const r = run(w, ['resume']);
  assert.equal(r.json.kind, 'review_ready', r.stdout);
  assert.ok(r.json.say.startsWith(CLOSING_TEXT));
  assert.equal(run(w, ['resume']).json.code, 'no_interview');
});

test('진행 중 면접이 있으면 start는 confirm_replace, --replace면 새 면접이 시작된다', () => {
  const w = world();
  const first = start(w);
  const before = modelCalls(w).length;
  const again = start(w, 'Kafka');
  assert.equal(again.status, 0);
  assert.equal(again.json.ok, true);
  assert.equal(again.json.kind, 'confirm_replace');
  assert.equal(again.json.say, '진행 중인 면접이 있습니다(Redis). 하던 면접을 끝내고 새로 시작할까요?');
  assert.ok(again.json.next.includes("start --topic '<주제>' --replace"));
  assert.equal(modelCalls(w).length, before);
  const r = run(w, ['start', '--topic', 'Kafka', '--replace']);
  assert.equal(r.json.kind, 'question', r.stdout);
  assert.notEqual(r.json.interview, first.json.interview);
  const old = JSON.parse(fs.readFileSync(path.join(w.dataDir, 'interviews', first.json.interview, 'hidden', 'session.json'), 'utf8'));
  assert.equal(old.end.by, 'replaced');
  assert.equal(run(w, ['status']).json.interview, r.json.interview);
});

test('첫 질문 say의 첫 줄이 시작 안내이고 질문 머리에 분모가 없다', () => {
  const w = world();
  const s = start(w);
  const [first, blank, head] = s.json.say.split('\n');
  assert.equal(first, "끝내고 싶으면 언제든 '끝'이라고 하세요. 바로 끝내고 복기를 시작합니다.");
  assert.equal(blank, '');
  assert.match(head, /^\*\*질문 1 · .+ 면접관\*\*$/);
  assert.ok(!s.json.say.includes('/6'));
  assert.ok(answer(w, s.json, '답').json.say.startsWith('**질문 2 · '));
});

test('답이 "끝"이면 review_ready이고 say가 마무리 문장으로 시작한다', () => {
  const w = world();
  const s = start(w);
  const r = answer(w, s.json, '끝');
  assert.equal(r.json.kind, 'review_ready', r.stdout);
  assert.ok(r.json.say.startsWith(`${CLOSING_TEXT}\n\n`), r.json.say);
  assert.equal(run(w, ['resume']).json.code, 'no_interview');
});

test('Claude가 끝내면 say가 Claude의 마무리 문장으로 시작하고 review.md가 생긴다', () => {
  const signals = (...types) => types.map((type) => ({ type, quote: `${type} 인용` }));
  const enough = judgment({ decision: 'enough', evidence: { knows: [1, 2], applies: [1, 2], learns: [1] }, nextArea: '', direction: '' });
  const w = makeWorld();
  for (const a of [
    analysis({ score: 'solid', signals: signals('practical', 'reasoning') }),
    analysis(),
    analysis({ score: 'solid', signals: signals('practical') }),
    analysis(),
  ]) push(w.fakeDir, 'analyze', { data: a });
  for (const j of [judgment(), enough]) push(w.fakeDir, 'endJudge', { data: j });
  stock(w.fakeDir, replies());
  let out = start(w).json;
  for (let i = 0; i < 4; i++) out = answer(w, out, `답 ${i}`).json;
  assert.equal(out.kind, 'review_ready', JSON.stringify(out));
  assert.ok(out.say.startsWith('이 주제로 준비한 면접은 여기까지입니다. 수고하셨습니다.\n\n'), out.say);
  assert.ok(fs.existsSync(out.paths.review));
});

test('상한에 닿으면 cap, answer와 resume도 cap이고 답 파일을 건드리지 않는다, continue면 question', () => {
  const w = makeWorld({ questionCap: 2 });
  push(w.fakeDir, 'endJudge', { data: judgment() });
  push(w.fakeDir, 'endJudge', { data: judgment({ nextArea: 'price' }) });
  stock(w.fakeDir, replies());
  let out = start(w).json;
  out = answer(w, out, 'a').json;
  const cap = answer(w, out, 'b');
  assert.equal(cap.json.kind, 'cap', cap.stdout);
  assert.equal(cap.json.ok, true);
  assert.equal(cap.json.say, "질문이 2개가 됐습니다. 이어 하려면 '계속', 끝내려면 '끝'이라고 하세요.");
  assert.equal(cap.json.answerFile, undefined);
  assert.ok(cap.json.next.includes('continue'));
  const file = path.join(w.dataDir, 'interviews', cap.json.interview, 'answers', '03-1.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '끝');
  const before = modelCalls(w).length;
  assert.equal(run(w, ['answer']).json.kind, 'cap');
  assert.equal(fs.readFileSync(file, 'utf8'), '끝');
  assert.equal(run(w, ['resume']).json.kind, 'cap');
  assert.equal(modelCalls(w).length, before);
  const next = run(w, ['continue']);
  assert.equal(next.json.kind, 'question', next.stdout);
  assert.ok(next.json.say.includes('**질문 3 · '));
});

test('cap 뒤 finish면 review_ready이고 마무리 문장으로 시작한다', () => {
  const w = makeWorld({ questionCap: 1 });
  stock(w.fakeDir, replies());
  const out = answer(w, start(w).json, 'a');
  assert.equal(out.json.kind, 'cap');
  const r = run(w, ['finish']);
  assert.equal(r.json.kind, 'review_ready', r.stdout);
  assert.ok(r.json.say.startsWith(CLOSING_TEXT));
  const session = JSON.parse(fs.readFileSync(path.join(w.dataDir, 'interviews', out.json.interview, 'hidden', 'session.json'), 'utf8'));
  assert.equal(session.end.by, 'cap');
});

test('예전 면접에 answer는 legacy_interview이고 finish는 복기까지 간다', () => {
  const w = world();
  const s = start(w);
  const file = path.join(w.dataDir, 'interviews', s.json.interview, 'hidden', 'session.json');
  const { topicMap: _drop, ...legacy } = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(legacy));
  const r = answer(w, s.json, '답');
  assert.equal(r.status, 1);
  assert.equal(r.json.code, 'legacy_interview');
  assert.equal(r.json.say, "예전 방식의 면접이라 이어 할 수 없습니다. '끝'으로 끝내고 새로 시작해 주세요.");
  assert.equal(r.json.next, `사용자가 '끝'이라고 하면 finish를 실행한다. ${TAIL}`);
  assert.equal(run(w, ['resume']).json.code, 'legacy_interview');
  const done = run(w, ['finish']);
  assert.equal(done.json.kind, 'review_ready', done.stdout);
});

test('진행 중이면 interview_open, 끝난 면접이 없으면 not_finished, 면접이 없으면 no_interview', () => {
  const w = world();
  start(w);
  const again = start(w, 'Kafka');
  assert.equal(again.json.kind, 'confirm_replace');
  for (const args of [['review'], ['mark', '1', 'well'], ['surprise', '1', 'expected']]) {
    assert.equal(run(w, args).json.code, 'not_finished', args.join(' '));
  }

  const empty = world();
  for (const args of [['review'], ['mark', '1', 'well'], ['surprise', '1', 'expected'], ['resume'], ['finish'], ['answer']]) {
    const r = run(empty, args);
    assert.equal(r.status, 1);
    assert.equal(r.json.code, 'no_interview', args.join(' '));
  }
});

test('실패 코드', async () => {
  const question = (response) => (w) => push(w.fakeDir, 'question', response);
  const cases = [
    ['usage_limit', {}, question({ raw: '{"api_error_status":429,"is_error":true}' })],
    ['refused', {}, question({ raw: '{"stop_reason":"refusal","is_error":false}' })],
    ['schema_failed', {}, question({ raw: '{"is_error":false}' })],
    ['other', {}, question({ raw: 'not json' })],
    ['other', {}, question({ raw: '', exit: 2 })],
    ['timeout', { callTimeoutMs: 300 }, question({ hang: true })],
    ['cli_missing', { claudeCommand: ['pi-no-such-command-xyz'] }, () => {}],
    ['not_logged_in', {}, (w) => fs.writeFileSync(path.join(w.fakeDir, 'auth.json'), '{"loggedIn":false}')],
  ];
  for (const [code, patch, arrange] of cases) {
    const w = makeWorld(patch);
    arrange(w);
    stock(w.fakeDir, replies());
    const r = start(w);
    assert.equal(r.status, 1, code);
    assert.equal(r.stderr, '');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.kind, 'error');
    assert.equal(r.json.code, code);
    assert.ok(r.json.next.endsWith(TAIL), r.json.next);
    if (!['cli_missing', 'not_logged_in'].includes(code)) {
      assert.equal(modelCalls(w).filter((c) => c.kind === 'question').length, 1, code);
      assert.equal(
        r.json.next,
        code === 'usage_limit'
          ? `다시 시도하지 않는다. 한도가 풀린 뒤 사용자가 같은 주제로 다시 시작하면 start를 실행한다. ${TAIL}`
          : `사용자가 다시 하겠다고 하면 같은 주제로 start를 다시 실행한다. ${TAIL}`,
      );
    }
    if (code === 'timeout') {
      const pid = Number(fs.readFileSync(path.join(w.fakeDir, 'hang.pid'), 'utf8'));
      const alive = () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      assert.ok(await waitFor(() => !alive()), '멈춘 가짜 실행기가 남았다');
    }
  }
});

test('실패한 start 뒤 resume은 no_interview이고 start를 안내한다', () => {
  const w = makeWorld();
  push(w.fakeDir, 'question', { raw: 'not json' });
  stock(w.fakeDir, replies());
  assert.equal(start(w).json.ok, false);
  const r = run(w, ['resume']);
  assert.equal(r.json.code, 'no_interview');
  assert.equal(r.json.next, `사용자가 주제를 주면 start를 실행한다. ${TAIL}`);
});

test('실패한 뒤 resume이 이어 간다', () => {
  const w = makeWorld();
  push(w.fakeDir, 'analyze', { raw: 'x', exit: 1 });
  stock(w.fakeDir, replies());
  const s = start(w);
  const id = s.json.interview;
  const a = answer(w, s.json, '한 번만 넣는 답');
  assert.equal(a.status, 1);
  assert.equal(a.json.code, 'other');
  assert.ok(a.json.next.includes('resume을 실행한다'), a.json.next);
  const r = run(w, ['resume']);
  assert.equal(r.json.kind, 'question');
  assert.ok(r.json.say.startsWith('**질문 2 · '));
  assert.equal(savedAnswer(w, id, 1), '한 번만 넣는 답');
  assert.equal(modelCalls(w).filter((c) => c.kind === 'analyze').length, 2);
});

test('안에서 난 오류도 코드만 낸다', async () => {
  const w = world();
  const s = start(w);
  const hidden = path.join(w.dataDir, 'interviews', s.json.interview, 'hidden');
  assert.ok(await waitFor(() => fs.existsSync(turnFile(w, s.json.interview, 1, 'key.json'))));
  fs.writeFileSync(path.join(hidden, 'session.json'), '{ 깨진');
  fs.writeFileSync(s.json.answerFile, '답');
  const r = run(w, ['answer']);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, '');
  assert.equal(r.json.code, 'other');
  assert.ok(!r.stdout.includes('SyntaxError'));
  assert.ok(!r.stdout.includes('    at '));
  // 세션을 읽지 못해 면접을 가리지 못했으므로 면접 폴더의 errors.log에 쓴다.
  const log = fs.readFileSync(path.join(w.dataDir, 'errors.log'), 'utf8');
  assert.ok(log.includes('SyntaxError'));
  assert.ok(log.includes('    at '));
});

test('셸 없이 띄울 수 없는 .cmd는 cli_missing', { skip: process.platform !== 'win32' }, () => {
  const probe = makeWorld();
  const cmd = path.join(probe.fakeDir, 'claude.cmd');
  fs.writeFileSync(cmd, '@echo off\r\n');
  const w = world({ claudeCommand: [cmd] });
  const r = start(w);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, '');
  assert.equal(r.json.code, 'cli_missing');
  const d = run(w, ['doctor']);
  assert.equal(d.json.kind, 'doctor');
  assert.equal(d.stderr, '');
  assert.ok(d.json.say.includes(`claude 점검: ${CLI_MISSING}`), d.json.say);
  assert.ok(d.json.say.includes(`claude 버전: ${CLI_MISSING}`), d.json.say);
});

test('doctor', () => {
  const w = world();
  const r = run(w, ['doctor']);
  assert.equal(r.status, 0);
  assert.equal(r.json.kind, 'doctor');
  assert.ok(r.json.say.includes('claude 버전: 0.0.0-fake'), r.json.say);
  assert.ok(r.json.say.includes('claude 점검: 통과'), r.json.say);
  assert.deepEqual(fakeCalls(w.fakeDir).map((c) => c.kind).sort(), ['auth', 'version']);
  assert.equal(run(w, ['doctor', '--call']).json.kind, 'doctor');
  assert.deepEqual(modelCalls(w).map((c) => c.kind), ['jobRole']);
});

test('잘못된 명령은 bad_args', () => {
  const w = world();
  for (const args of [['nope'], [], ['start'], ['mark', 'x', 'well'], ['mark', '1', 'great'], ['surprise', '1', 'maybe']]) {
    const r = run(w, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stderr, '');
    assert.equal(r.json.code, 'bad_args', args.join(' '));
  }
});

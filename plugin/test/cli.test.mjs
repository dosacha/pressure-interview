import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CLOSING_TEXT } from '../skills/pressure-interview/scripts/lib/app/session/session-rules.mjs';
import { answer, fakeCalls, makeWorld, push, replies, run, stock } from './helpers.mjs';

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
  assert.ok(r.json.say.startsWith('**질문 1/6 · '), r.json.say);
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
  const a1 = answer(w, s.json, '끝');
  assert.equal(a1.json.kind, 'question');
  assert.ok(a1.json.say.startsWith('**질문 2/6 · '));
  assert.equal(savedAnswer(w, id, 1), '끝');
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

test('한 판: 질문 둘, 끝, 복기, 고침, 표시, 추이', () => {
  const w = world({ questionLimit: 2 });
  const s = start(w);
  const id = s.json.interview;
  const a1 = answer(w, s.json, '첫 답입니다.');
  assert.equal(a1.json.kind, 'question');
  const a2 = answer(w, a1.json, '둘째 답입니다.');
  assert.equal(a2.json.kind, 'finished');
  assert.ok(a2.json.say.includes(CLOSING_TEXT));
  assert.equal(a2.json.answerFile, undefined);

  const rv = run(w, ['review']);
  assert.equal(rv.json.kind, 'review_ready', rv.stdout);
  assert.equal(rv.json.interview, id);
  assert.ok(fs.existsSync(rv.json.paths.review));
  assert.equal(run(w, ['mark', '2', 'well']).json.kind, 'marked');
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

test('끝난 뒤 복기 전의 resume은 끝낼 때의 출력을 다시 준다', () => {
  const w = world({ questionLimit: 2 });
  const s = start(w);
  const done = answer(w, answer(w, s.json, '첫 답').json, '마지막 답');
  assert.equal(done.json.kind, 'finished');
  const before = fakeCalls(w.fakeDir).length;
  const r = run(w, ['resume']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(r.json, done.json);
  assert.equal(fakeCalls(w.fakeDir).length, before);
  assert.equal(run(w, ['review']).json.kind, 'review_ready');
  assert.equal(run(w, ['resume']).json.code, 'no_interview');
});

test('진행 중이면 interview_open, 끝난 면접이 없으면 not_finished, 면접이 없으면 no_interview', () => {
  const w = world();
  start(w);
  const again = start(w, 'Kafka');
  assert.equal(again.status, 1);
  assert.equal(again.json.code, 'interview_open');
  assert.ok(again.json.next.startsWith('사용자가 정하는 대로 resume으로 이어 가거나 finish로 끝낸다.'));
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
  assert.ok(r.json.say.startsWith('**질문 2/6 · '));
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

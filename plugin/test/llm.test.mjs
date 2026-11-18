import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { EngineError } from '../skills/pressure-interview/scripts/lib/errors.mjs';
import { buildArgs, checkClaude, childEnv, classify, createLlm } from '../skills/pressure-interview/scripts/lib/llm.mjs';
import { JOB_ROLE_SCHEMA } from '../skills/pressure-interview/scripts/lib/app/interview/calls/job-role.call.mjs';
import { analyzeAnswer } from '../skills/pressure-interview/scripts/lib/app/interview/calls/analyze.call.mjs';
import { writeAnswerKey } from '../skills/pressure-interview/scripts/lib/app/interview/calls/answer-key.call.mjs';
import { answerClarification } from '../skills/pressure-interview/scripts/lib/app/interview/calls/clarify.call.mjs';
import { pickJobRole } from '../skills/pressure-interview/scripts/lib/app/interview/calls/job-role.call.mjs';
import { detectTechs } from '../skills/pressure-interview/scripts/lib/app/interview/calls/leak.call.mjs';
import { checkPremise } from '../skills/pressure-interview/scripts/lib/app/interview/calls/premise.call.mjs';
import { generateQuestion } from '../skills/pressure-interview/scripts/lib/app/interview/calls/question.call.mjs';
import { reviewTurn } from '../skills/pressure-interview/scripts/lib/app/interview/calls/review.call.mjs';
import { verifyAnswerKey } from '../skills/pressure-interview/scripts/lib/app/interview/calls/verify.call.mjs';
import { analysis, draft, fakeCalls, fakeLlm, key, makeWorld, panel, push, review } from './helpers.mjs';

const REQ = { kind: 'jobRole', system: '시스템', user: '주제: Redis', schema: JOB_ROLE_SCHEMA };

test('buildArgs의 꼴', () => {
  const schema = { type: 'object' };
  const args = buildArgs({ model: 'opus', effort: 'high', system: 'S', schema });
  assert.deepEqual(args, [
    '-p', '--model', 'opus', '--effort', 'high', '--system-prompt', 'S',
    '--json-schema', JSON.stringify(schema), '--output-format', 'json',
    '--tools', '', '--safe-mode', '--no-session-persistence', '--strict-mcp-config',
  ]);
  assert.equal(args[args.indexOf('--tools') + 1], '');
});

test('childEnv', () => {
  const env = {
    PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', ANTHROPIC_API_KEY: 'k',
    ANTHROPIC_BASE_URL: 'u', CLAUDE_CONFIG_DIR: 'c', KEEP_ME: 'y',
  };
  assert.deepEqual(childEnv(env), { PATH: 'p', CLAUDE_CONFIG_DIR: 'c', KEEP_ME: 'y' });
  assert.deepEqual(childEnv(env, ['ANTHROPIC_BASE_URL']), {
    PATH: 'p', ANTHROPIC_BASE_URL: 'u', CLAUDE_CONFIG_DIR: 'c', KEEP_ME: 'y',
  });
});

test('classify', () => {
  const code = (input) => classify({ exitCode: 0, ...input });
  assert.deepEqual(code({ spawnError: { code: 'ENOENT' } }), { ok: false, code: 'cli_missing' });
  assert.deepEqual(code({ timedOut: true }), { ok: false, code: 'timeout' });
  assert.deepEqual(code({ stdout: 'not json' }), { ok: false, code: 'other' });
  assert.deepEqual(code({ stdout: '{"api_error_status":429,"is_error":true}' }), { ok: false, code: 'usage_limit' });
  assert.deepEqual(code({ stdout: '{"stop_reason":"refusal","is_error":false}' }), { ok: false, code: 'refused' });
  assert.deepEqual(code({ stdout: '{"is_error":true}' }), { ok: false, code: 'other' });
  assert.deepEqual(code({ exitCode: 1, stdout: '{"is_error":false,"structured_output":{}}' }), { ok: false, code: 'other' });
  assert.deepEqual(code({ stdout: '{"is_error":false}' }), { ok: false, code: 'schema_failed' });
  assert.deepEqual(code({ stdout: '{"is_error":false,"structured_output":{"a":1}}' }), {
    ok: true,
    result: { is_error: false, structured_output: { a: 1 } },
  });
});

test('가짜 실행기로 한 번 부른다', async () => {
  const world = makeWorld();
  push(world.fakeDir, 'jobRole', { data: { role: 'dba' } });
  const system = '시스템 "따옴표" $x `백틱`\n둘째 줄';
  const { data, usage, model } = await createLlm({ config: world.config, record() {}, env: world.env })
    .callJson({ ...REQ, system });
  assert.deepEqual(data, { role: 'dba' });
  assert.deepEqual(usage, { input_tokens: 1, output_tokens: 4, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 });
  assert.equal(model, 'fake-model');
  const [call] = fakeCalls(world.fakeDir);
  assert.equal(call.system, system);
  assert.equal(call.user, '주제: Redis');
  assert.ok(call.args.includes('sonnet') && call.args.includes('medium'));
});

test('자식은 세션의 변수와 API 키를 받지 않는다', async () => {
  const world = makeWorld();
  push(world.fakeDir, 'jobRole', { data: { role: 'dba' } });
  const env = { ...world.env, ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_ENTRYPOINT: 'x' };
  await createLlm({ config: world.config, record() {}, env }).callJson(REQ);
  assert.deepEqual(fakeCalls(world.fakeDir)[0].envNames, ['CLAUDE_CODE_MAX_OUTPUT_TOKENS']);
});

test('자식은 출력 상한 16000을 받는다', async () => {
  const world = makeWorld();
  push(world.fakeDir, 'jobRole', { data: { role: 'dba' } });
  const env = { ...world.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '5' };
  await createLlm({ config: world.config, record() {}, env }).callJson(REQ);
  assert.equal(fakeCalls(world.fakeDir)[0].maxOutputTokens, '16000');
});

test('실패해도 한 번만 띄운다', async () => {
  const world = makeWorld();
  push(world.fakeDir, 'jobRole', { raw: 'x', exit: 1 });
  await assert.rejects(createLlm({ config: world.config, record() {}, env: world.env }).callJson(REQ));
  assert.equal(fakeCalls(world.fakeDir).length, 1);
});

test('record는 성공과 실패에 한 번씩 불린다', async () => {
  const world = makeWorld();
  const lines = [];
  const llm = createLlm({ config: world.config, record: (l) => lines.push(l), env: world.env });
  push(world.fakeDir, 'jobRole', { data: { role: 'dba' } });
  await llm.callJson(REQ);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].ok, true);
  assert.equal(lines[0].kind, 'jobRole');
  assert.equal(lines[0].model, 'fake-model');
  assert.equal(lines[0].effort, 'medium');
  assert.deepEqual(
    [lines[0].input_tokens, lines[0].output_tokens, lines[0].cache_creation_input_tokens, lines[0].cache_read_input_tokens],
    [1, 4, 2, 3],
  );
  assert.equal(typeof lines[0].wall_ms, 'number');

  push(world.fakeDir, 'jobRole', { raw: 'x', exit: 1 });
  await assert.rejects(llm.callJson(REQ), (e) => {
    assert.ok(e instanceof EngineError);
    assert.equal(e.code, 'other');
    assert.ok(e.detail.includes('x'));
    return true;
  });
  assert.equal(lines.length, 2);
  assert.equal(lines[1].ok, false);
  assert.equal(lines[1].code, 'other');
  // 실패해도 한 번만 띄운다
  assert.equal(fakeCalls(world.fakeDir).length, 2);
});

test('시간 상한을 넘기면 timeout이고 자식이 죽는다', async () => {
  const world = makeWorld({ callTimeoutMs: 300 });
  push(world.fakeDir, 'jobRole', { hang: true });
  await assert.rejects(
    createLlm({ config: world.config, record() {}, env: world.env }).callJson(REQ),
    (e) => e.code === 'timeout',
  );
  const pid = Number(fs.readFileSync(path.join(world.fakeDir, 'hang.pid'), 'utf8'));
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 50 && alive(); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(), false);
});

test('명령을 못 찾으면 cli_missing', async () => {
  const world = makeWorld({ claudeCommand: ['pi-no-such-command-xyz'] });
  await assert.rejects(
    createLlm({ config: world.config, record() {}, env: world.env }).callJson(REQ),
    (e) => e.code === 'cli_missing',
  );
});

test('checkClaude', async () => {
  const world = makeWorld();
  await checkClaude(world.config, world.env);
  const auth = path.join(world.fakeDir, 'auth.json');
  fs.writeFileSync(auth, '{"loggedIn":false}');
  await assert.rejects(checkClaude(world.config, world.env), (e) => e.code === 'not_logged_in');
  fs.writeFileSync(auth, '{"loggedIn":true,"authMethod":"apiKey"}');
  await assert.rejects(checkClaude(world.config, world.env), (e) => e.code === 'not_logged_in');
  const missing = makeWorld({ claudeCommand: ['pi-no-such-command-xyz'] });
  await assert.rejects(checkClaude(missing.config, missing.env), (e) => e.code === 'cli_missing');
});

test('가장 긴 명령줄도 한계 아래다', async () => {
  const member = panel()[0];
  const question = { ...draft(), answerKey: key() };
  const defect = { type: 'vague', axis: 'scale', note: '메모' };
  const ok = { premiseOk: true, problems: [], corrections: { lists: [], alternatives: { changed: false, items: [] } } };
  const { llm, calls } = fakeLlm({
    jobRole: [{ role: 'dba' }],
    question: [draft()],
    leak: [{ techs: [] }],
    premise: [ok],
    answerKey: [key()],
    verify: [ok],
    analyze: [analysis()],
    clarify: [{ reply: '네' }],
    review: [review()],
  });
  await pickJobRole(llm, 'Redis');
  await generateQuestion(llm, {
    topic: 'Redis', interviewer: member, reactionIntent: null, defect: null, targetAxis: null,
    history: [], userMentioned: [], feedback: [],
  });
  await detectTechs(llm, { questionText: question.text, userMentioned: [] });
  await checkPremise(llm, { topic: 'Redis', draft: draft() });
  await writeAnswerKey(llm, { topic: 'Redis', interviewer: member, reactionIntent: null, defect: null, history: [], draft: draft() });
  await verifyAnswerKey(llm, { topic: 'Redis', question });
  await analyzeAnswer(llm, { topic: 'Redis', question, answer: '답' });
  await answerClarification(llm, {
    topic: 'Redis', interviewer: member, question: draft(), questionTechs: [], exchanges: [], ask: '무슨 뜻이죠?',
    userMentioned: [], avoidTechs: [], feedback: [],
  });
  await reviewTurn(llm, {
    topic: 'Redis', interviewer: member, cause: { reactionIntent: null, defect: null }, question,
    clarifications: [], answer: '답', analysis: analysis({ defects: [defect] }), followUps: [], knownAssumptions: [],
  });
  assert.equal(calls.length, 9);
  assert.deepEqual(new Set(calls.map((c) => c.kind)).size, 9);
  for (const { system, schema, kind } of calls) {
    const length = buildArgs({ model: 'opus', effort: 'medium', system, schema }).join(' ').length;
    assert.ok(length < 30000, `${kind}: ${length}`);
  }
});

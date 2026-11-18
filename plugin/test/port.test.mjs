import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const hasRef = spawnSync('git', ['cat-file', '-e', 'aeae0dd^{commit}']).status === 0;

test('생성물이 원본에서 다시 만든 것과 같다', { skip: !hasRef }, () => {
  const r = spawnSync(process.execPath, ['--no-warnings', 'tools/port-app-src.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});
test('생성된 파일의 첫 줄이 원본과 도구를 밝힌다', () => {
  const first = readFileSync('plugin/skills/pressure-interview/scripts/lib/app/interview/rules.mjs', 'utf8').split('\n')[0];
  assert.equal(first, '// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/interview/rules.ts @ aeae0dd, 도구: tools/port-app-src.mjs');
});
test('질문 시스템 프롬프트가 앱과 같은 길이다', async () => {
  const { buildQuestionPrompt } = await import('../skills/pressure-interview/scripts/lib/app/interview/calls/question.call.mjs');
  const { system } = buildQuestionPrompt({ topic: 'Redis', interviewer: { id: 'p1', role: 'dba', temperament: 'persistent' }, reactionIntent: null, defect: null, targetAxis: null, history: [], userMentioned: ['Redis'], feedback: [] });
  assert.equal(system.length, 5721);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { configPath, loadConfig, saveConfig } from '../skills/pressure-interview/scripts/lib/config.mjs';

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '면접 기록 '));
  return { tmp, env: { PRESSURE_INTERVIEW_HOME: tmp } };
}

function writeRaw(env, text) {
  const file = configPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
}

test('설정 파일이 없으면 null', () => {
  const { env } = setup();
  assert.equal(loadConfig(env), null);
});

test('저장한 값에 기본값이 합쳐진다', () => {
  const { env } = setup();
  const saved = saveConfig({ dataDir: 'D:/x', calls: { leak: { model: 'haiku' } } }, env);
  const loaded = loadConfig(env);
  assert.deepEqual(saved, loaded);
  assert.equal(loaded.dataDir, 'D:/x');
  assert.equal(loaded.questionLimit, 6);
  assert.deepEqual(loaded.calls.leak, { model: 'haiku', effort: 'low' });
  assert.deepEqual(loaded.calls.review, { model: 'opus', effort: 'high' });
});

test('값이 틀리면 bad_config', () => {
  const { env } = setup();
  const cases = [
    { questionLimit: 1 },
    { questionLimit: 31 },
    { claudeCommand: 'claude' },
    { claudeCommand: [] },
    { calls: { leak: { effort: 'fast' } } },
    { dataDir: 3 },
  ];
  for (const bad of cases) {
    writeRaw(env, bad);
    assert.throws(() => loadConfig(env), (e) => e.code === 'bad_config', JSON.stringify(bad));
  }
});

test('깨진 JSON이면 bad_config', () => {
  const { env } = setup();
  writeRaw(env, '{ 깨짐');
  assert.throws(() => loadConfig(env), (e) => e.code === 'bad_config');
});

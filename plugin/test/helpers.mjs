import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { saveConfig } from '../skills/pressure-interview/scripts/lib/config.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs');
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `면접 기록 ${label} `));

export function makeWorld(configPatch = {}) {
  const home = tmp('home');
  const dataDir = tmp('data');
  const fakeDir = tmp('fake');
  const { CLAUDE_CONFIG_DIR: _drop, ...base } = process.env;
  const env = { ...base, PRESSURE_INTERVIEW_HOME: home, PI_FAKE_DIR: fakeDir };
  const config = saveConfig({ dataDir, claudeCommand: [process.execPath, FAKE], ...configPatch }, env);
  return { home, dataDir, fakeDir, env, config };
}

export function push(fakeDir, kind, response) {
  const dir = path.join(fakeDir, kind);
  fs.mkdirSync(dir, { recursive: true });
  // 차지된 파일(.used)도 세어 번호가 겹치지 않게 한다
  const n = fs.readdirSync(dir).length + 1;
  fs.writeFileSync(path.join(dir, `${String(n).padStart(3, '0')}.json`), JSON.stringify(response));
}

export function fakeCalls(fakeDir) {
  const file = path.join(fakeDir, 'calls.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// fake-claude.mjs와 같은 규칙이다. 먼저 맞는 것이 종류다.
const KINDS = [
  ['reply', 'clarify'], ['role', 'jobRole'], ['keyPoints', 'answerKey'], ['corrections', 'verify'],
  ['premiseOk', 'premise'], ['techs', 'leak'], ['keyProblems', 'review'],
  ['questionIntent', 'question'], ['mentionedTechs', 'analyze'],
];

export function fakeLlm(queues) {
  const calls = [];
  const llm = {
    async callJson(req) {
      const required = req.schema?.required ?? [];
      const kind = req.kind ?? KINDS.find(([field]) => required.includes(field))?.[1];
      calls.push({ ...req, kind });
      const queue = queues[kind];
      if (!queue || queue.length === 0) throw new Error(`no fake response for ${kind}`);
      let value = queue.shift();
      if (typeof value === 'function') value = await value();
      if (value instanceof Error) throw value;
      return { data: value, usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' };
    },
  };
  return { llm, calls };
}

export const draft = (over = {}) => ({
  text: '인메모리 PostgreSQL이라면 Redis와 뭐가 다를까요?',
  questionIntent: 'A1',
  assumption: { axis: 'identity_swap', statement: 'PostgreSQL이 디스크 없이 동작' },
  ...over,
});
export const key = (over = {}) => ({
  vanishing: ['디스크 I/O'], remaining: ['데이터 모델'], alternatives: [], keyPoints: ['MVCC'], ...over,
});
export const analysis = (over = {}) => ({
  kind: 'answer', defects: [], mentionedTechs: [], unknownTechs: [], selfUnknownTechs: [], ...over,
});
export const review = (over = {}) => ({
  intent: { aimed: true, note: '' },
  defects: [],
  reactions: [],
  assumption: { result: 'none', note: '', sameAs: null },
  keyProblems: [],
  ...over,
});
export const panel = () => [
  { id: 'i1', role: 'dba', temperament: 'persistent' },
  { id: 'i2', role: 'textbook', temperament: 'helper' },
  { id: 'i3', role: 'scenario', temperament: 'shaker' },
];

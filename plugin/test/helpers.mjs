import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { saveConfig } from '../skills/pressure-interview/scripts/lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, 'fake-claude.mjs');
const CLI = path.join(HERE, '..', 'skills', 'pressure-interview', 'scripts', 'cli.mjs');

// 엔진 명령을 진짜 프로세스로 한 번 돌린다.
export function run(world, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: world.env, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: JSON.parse(r.stdout) };
}

// 진행자처럼 답 파일에 글을 쓰고 answer를 돌린다.
export function answer(world, out, text) {
  fs.writeFileSync(out.answerFile, text);
  return run(world, ['answer']);
}
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

// 종류마다 같은 성공 응답을 n개씩 쌓는다. 앞에 push한 응답이 먼저 쓰인다.
export function stock(fakeDir, replies, n = 6) {
  for (const [kind, data] of Object.entries(replies)) for (let i = 0; i < n; i++) push(fakeDir, kind, { data });
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
const NO_CORRECTIONS = { premiseOk: true, problems: [], corrections: { lists: [], alternatives: { changed: false, items: [] } } };
// 가짜 실행기에 쌓을 종류별 성공 응답.
export const replies = (over = {}) => ({
  jobRole: { role: 'dba' },
  question: draft(),
  leak: { techs: [] },
  premise: { premiseOk: true, problems: [] },
  answerKey: key(),
  verify: NO_CORRECTIONS,
  analyze: analysis(),
  clarify: { reply: '범위는 한 대의 서버입니다.' },
  review: review(),
  ...over,
});
export const panel = () => [
  { id: 'i1', role: 'dba', temperament: 'persistent' },
  { id: 'i2', role: 'textbook', temperament: 'helper' },
  { id: 'i3', role: 'scenario', temperament: 'shaker' },
];

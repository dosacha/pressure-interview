import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EngineError } from './errors.mjs';

export const DEFAULTS = {
  dataDir: null,
  questionLimit: 6,
  maxConsecutive: 2,
  maxRegenerations: 1,
  reissueAfterHours: 24,
  reviewConcurrency: 3,
  callTimeoutMs: 180000,
  pollMs: 300,
  claudeCommand: ['claude'],
  keepEnv: [],
  calls: {
    jobRole: { model: 'sonnet', effort: 'medium' },
    question: { model: 'opus', effort: 'medium' },
    leak: { model: 'sonnet', effort: 'low' },
    premise: { model: 'opus', effort: 'medium' },
    answerKey: { model: 'opus', effort: 'medium' },
    verify: { model: 'opus', effort: 'medium' },
    analyze: { model: 'opus', effort: 'medium' },
    clarify: { model: 'opus', effort: 'medium' },
    review: { model: 'opus', effort: 'high' },
  },
};

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const POSITIVE_INTS = ['maxConsecutive', 'maxRegenerations', 'reissueAfterHours', 'reviewConcurrency', 'callTimeoutMs', 'pollMs'];

export function configPath(env = process.env) {
  const home = env.PRESSURE_INTERVIEW_HOME || os.homedir();
  return path.join(home, '.pressure-interview', 'config.json');
}

function bad(detail) {
  return new EngineError('bad_config', detail);
}

function readRaw(env) {
  const file = configPath(env);
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw bad(`JSON을 읽지 못했다: ${error.message}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad('설정은 객체여야 한다');
  return raw;
}

// calls는 종류별로 합친다.
function mergeCalls(base, over) {
  const out = {};
  for (const kind of new Set([...Object.keys(base), ...Object.keys(over ?? {})])) {
    out[kind] = { ...base[kind], ...(over?.[kind] ?? {}) };
  }
  return out;
}

const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

function resolve(raw) {
  const cfg = { ...DEFAULTS, ...raw, calls: mergeCalls(DEFAULTS.calls, raw.calls) };
  if (!Number.isInteger(cfg.questionLimit) || cfg.questionLimit < 2 || cfg.questionLimit > 30) {
    throw bad('questionLimit은 2~30의 정수여야 한다');
  }
  for (const key of POSITIVE_INTS) {
    if (!Number.isInteger(cfg[key]) || cfg[key] < 1) throw bad(`${key}는 1 이상의 정수여야 한다`);
  }
  for (const [kind, call] of Object.entries(cfg.calls)) {
    if (typeof call.model !== 'string' || call.model === '') throw bad(`calls.${kind}.model이 틀렸다`);
    if (!EFFORTS.includes(call.effort)) throw bad(`calls.${kind}.effort가 틀렸다`);
  }
  if (!isStringArray(cfg.claudeCommand) || cfg.claudeCommand.length === 0) {
    throw bad('claudeCommand는 비어 있지 않은 문자열 배열이어야 한다');
  }
  if (!isStringArray(cfg.keepEnv)) throw bad('keepEnv는 문자열 배열이어야 한다');
  if (cfg.dataDir !== null && typeof cfg.dataDir !== 'string') throw bad('dataDir은 문자열이거나 null이어야 한다');
  return cfg;
}

export function loadConfig(env = process.env) {
  const raw = readRaw(env);
  return raw === null ? null : resolve(raw);
}

export function saveConfig(patch, env = process.env) {
  const current = readRaw(env) ?? {};
  const merged = { ...current, ...patch };
  if (current.calls || patch.calls) merged.calls = mergeCalls(current.calls ?? {}, patch.calls);
  resolve(merged); // 틀린 값은 쓰기 전에 막는다
  const file = configPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return loadConfig(env);
}

import fs from 'node:fs';
import path from 'node:path';

import { EngineError } from './errors.mjs';

export function slugify(topic) {
  const slug = String(topic)
    .replace(/[^\p{Script=Hangul}A-Za-z0-9_-]/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'interview';
}

const pad2 = (n) => String(n).padStart(2, '0');

function stamp(at) {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}-${pad2(at.getHours())}${pad2(at.getMinutes())}`;
}

// 같은 폴더의 임시 이름에 쓴 뒤 이름을 바꾼다.
function writeJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJsonIfExists = (file) => (fs.existsSync(file) ? readJson(file) : null);
const toDate = (v) => (v == null ? null : new Date(v));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function openStore(dataDir) {
  const root = path.join(dataDir, 'interviews');
  const dir = (id) => path.join(root, id);
  const hidden = (id) => path.join(dir(id), 'hidden');
  const turnDir = (id, seq) => path.join(hidden(id), 'turns', pad2(seq));
  const turnFile = (id, seq, name) => path.join(turnDir(id, seq), name);

  function writeTurnFile(id, seq, name, value) {
    fs.mkdirSync(turnDir(id, seq), { recursive: true });
    writeJson(turnFile(id, seq, name), value);
  }

  function readSession(id) {
    const file = path.join(hidden(id), 'session.json');
    if (!fs.existsSync(file)) throw new EngineError('not_found', id);
    const s = readJson(file);
    return { ...s, createdAt: toDate(s.createdAt), finishedAt: toDate(s.finishedAt), reviewedAt: toDate(s.reviewedAt) };
  }

  // question.json이 있는 폴더만 턴이다.
  function turnSeqs(id) {
    const base = path.join(hidden(id), 'turns');
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base)
      .filter((name) => /^\d+$/.test(name) && fs.existsSync(path.join(base, name, 'question.json')))
      .map(Number)
      .sort((a, b) => a - b);
  }

  function readTurns(id) {
    return turnSeqs(id).map((seq) => {
      const q = readJson(turnFile(id, seq, 'question.json'));
      const key = readJsonIfExists(turnFile(id, seq, 'key.json'));
      const a = readJsonIfExists(turnFile(id, seq, 'answer.json'));
      const r = readJsonIfExists(turnFile(id, seq, 'review.json'));
      return {
        id: pad2(seq),
        sessionId: id,
        seq,
        interviewerId: q.interviewerId,
        addOn: q.addOn,
        causeTurnId: q.causeTurnId,
        reactionIntent: q.reactionIntent,
        defect: q.defect,
        targetAxis: q.targetAxis,
        question: { ...q.draft, answerKey: key?.answerKey ?? null },
        prepared: { flags: q.prepared.flags, attempts: q.prepared.attempts, answerKeyCorrected: key?.answerKeyCorrected ?? false },
        verification: key?.verification ?? null,
        clarifications: a?.clarifications ?? [],
        answer: a?.answer ?? null,
        answerStartMs: null,
        answeredAt: toDate(a?.answeredAt),
        analysis: a?.analysis ?? null,
        pick: a?.pick ?? null,
        surprise: r?.surprise ?? null,
        review: r?.review ?? null,
        createdAt: toDate(q.createdAt),
        pendingSecondary: q.pendingSecondary ?? null,
      };
    });
  }

  return {
    createInterview(topic, at) {
      fs.mkdirSync(root, { recursive: true });
      const base = `${stamp(at)}-${slugify(topic)}`;
      for (let n = 1; ; n++) {
        const id = n === 1 ? base : `${base}-${n}`;
        try {
          fs.mkdirSync(dir(id)); // 이미 있으면 EEXIST
        } catch (error) {
          if (error.code === 'EEXIST') continue;
          throw error;
        }
        fs.mkdirSync(path.join(dir(id), 'answers'));
        fs.mkdirSync(path.join(hidden(id), 'turns'), { recursive: true });
        return id;
      }
    },

    listInterviews() {
      if (!fs.existsSync(root)) return [];
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(hidden(e.name), 'session.json')))
        .map((e) => {
          const s = readSession(e.name);
          return { id: e.name, topic: s.topic, status: s.status, createdAt: s.createdAt, questionCount: turnSeqs(e.name).length };
        })
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    },

    readSession,
    writeSession(id, session) {
      fs.mkdirSync(hidden(id), { recursive: true });
      writeJson(path.join(hidden(id), 'session.json'), session);
    },

    readTurns,
    writeQuestion(id, seq, q) {
      writeTurnFile(id, seq, 'question.json', q);
    },
    writeAnswer(id, seq, a) {
      writeTurnFile(id, seq, 'answer.json', a);
    },
    writeReview(id, seq, r) {
      writeTurnFile(id, seq, 'review.json', r);
    },

    readKey(id, seq) {
      return readJsonIfExists(turnFile(id, seq, 'key.json'));
    },
    writeKey(id, seq, key) {
      writeTurnFile(id, seq, 'key.json', key);
    },

    acquireKeyLock(id, seq, staleMs) {
      const file = turnFile(id, seq, 'key.lock');
      fs.mkdirSync(turnDir(id, seq), { recursive: true });
      for (let attempt = 0; attempt < 2; attempt++) {
        const mine = { pid: process.pid, at: Date.now() };
        try {
          fs.writeFileSync(file, JSON.stringify(mine), { flag: 'wx' });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          let held = null;
          try {
            held = readJson(file);
          } catch {
            // 깨진 잠금은 낡은 것으로 본다
          }
          const stale = !held || !pidAlive(held.pid) || !(Date.now() - held.at <= staleMs);
          if (!stale) return null;
          fs.rmSync(file, { force: true });
          continue;
        }
        return () => {
          try {
            const cur = readJson(file);
            if (cur.pid === mine.pid && cur.at === mine.at) fs.rmSync(file, { force: true });
          } catch {
            // 이미 없다
          }
        };
      }
      return null;
    },

    answerFile(id, seq, inputNo) {
      return `${path.join(dir(id), 'answers').replaceAll('\\', '/')}/${pad2(seq)}-${inputNo}.txt`;
    },
    readAnswerFile(file) {
      if (!fs.existsSync(file)) return null;
      const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
      return text.trim() === '' ? null : text;
    },
    removeAnswerFile(file) {
      fs.rmSync(file, { force: true });
    },

    appendCall(id, row) {
      fs.appendFileSync(path.join(hidden(id), 'calls.jsonl'), `${JSON.stringify(row)}\n`);
    },
    readCalls(id) {
      const file = path.join(hidden(id), 'calls.jsonl');
      if (!fs.existsSync(file)) return [];
      return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
    },

    logError(id, where, error) {
      const lines = [`[${new Date().toISOString()}] ${where}: ${error?.message ?? String(error)}`];
      if (error?.stack) lines.push(error.stack);
      if (error?.detail) lines.push(`detail: ${error.detail}`);
      const file = id ? path.join(hidden(id), 'errors.log') : path.join(dataDir, 'errors.log');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${lines.join('\n')}\n\n`);
    },

    readMemory() {
      const records = readJsonIfExists(path.join(dataDir, 'memory.json')) ?? [];
      return records.map((r) => ({ ...r, lastSeenAt: toDate(r.lastSeenAt), createdAt: toDate(r.createdAt) }));
    },
    writeMemory(records) {
      fs.mkdirSync(dataDir, { recursive: true });
      writeJson(path.join(dataDir, 'memory.json'), records);
    },
  };
}

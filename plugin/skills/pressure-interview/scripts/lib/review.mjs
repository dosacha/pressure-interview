// 앱(aeae0dd)의 src/review/review.service.ts와 src/memory/memory.service.ts를 손으로 옮긴 것이다. 앱과 다른 곳:
// 저장은 DB 대신 store의 파일이고, 복기는 뒤에서 돌지 않고 명령 안에서 끝까지 돈다. 결과는 review.md와 stats.md로 쓴다.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { foldAssumptions, pendingTopics } from './app/memory/memory-rules.mjs';
import { answerKeyOf, followUpsOf, isReviewTarget, memberOf, toReviewView } from './app/review/review.view.mjs';
import { computeStats } from './app/review/stats.mjs';
import { EngineError } from './errors.mjs';
import { renderReview, renderStats, summarizeCalls } from './render.mjs';
import { TurnService } from './turn.service.mjs';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byCreated = (a, b) => a.createdAt - b.createdAt || cmp(a.id, b.id);

/** 이 면접의 복기 결과로 memory.json을 다시 맞춘다. 여러 번 불러도 결과가 같다. */
// shortcut: 엔진 프로세스 하나를 전제한다(한 사용자, 한 세션), 동시 실행이 생기면 memory.json에 잠금 파일을
export function syncMemory(store, interviewId, at) {
  const session = store.readSession(interviewId);
  const records = store.readMemory();
  const byId = new Map(records.map((r) => [r.id, r]));
  const recordOfTurn = new Map();
  for (const r of records) for (const e of r.encounters) if (e.sessionId === interviewId) recordOfTurn.set(e.turnId, r.id);

  const folded = foldAssumptions(store.readTurns(interviewId), [...byId.keys()]);

  for (const r of records) r.encounters = r.encounters.filter((e) => e.sessionId !== interviewId);
  const created = [];
  for (const f of folded) {
    const id = f.recordId ?? f.turnIds.map((t) => recordOfTurn.get(t)).find((x) => x !== undefined);
    let record = id === undefined ? undefined : byId.get(id);
    if (!record) {
      record = { id: randomUUID(), axis: f.axis, statement: f.statement, encounters: [], createdAt: at };
      created.push(record);
    }
    record.encounters.push({
      sessionId: interviewId,
      turnId: f.turnIds[f.turnIds.length - 1],
      topic: session.topic,
      result: f.result,
      surprise: f.surprise,
      at: f.at,
    });
  }

  // 만남이 하나도 남지 않은 기록은 지운다.
  const kept = [...records, ...created].filter((r) => r.encounters.length > 0);
  for (const r of kept) {
    r.encounters.sort((a, b) => cmp(a.at, b.at) || cmp(a.turnId, b.turnId));
    const latest = r.encounters[r.encounters.length - 1];
    r.status = latest.result;
    r.lastSeenAt = new Date(latest.at);
  }
  store.writeMemory(
    kept.sort(byCreated).map((r) => ({
      id: r.id,
      axis: r.axis,
      statement: r.statement,
      status: r.status,
      encounters: r.encounters,
      lastSeenAt: r.lastSeenAt,
      createdAt: r.createdAt,
    })),
  );
}

// 임시 이름에 쓴 뒤 이름을 바꾼다.
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// 한 번의 run이 이만큼 돌았으면 새 묶음을 시작하지 않는다. 진행자의 도구 시간 상한(600초)보다 짧아야 한다.
export const REVIEW_BUDGET_MS = 420000;

export function createReviewService({ store, config, llmFor, now = () => new Date(), budgetMs = REVIEW_BUDGET_MS, clock = Date.now }) {
  const statsFile = path.join(config.dataDir, 'stats.md');
  const paths = (id) => ({ review: path.join(config.dataDir, 'interviews', id, 'review.md'), stats: statsFile });

  // 진행 중인 면접에는 복기 경로가 아무것도 하지 않는다. 숨긴 값이 면접 중에 나가지 않게 하려는 것이다.
  function finishedSession(id) {
    const session = store.readSession(id);
    if (session.status !== 'finished') throw new EngineError('not_finished', id);
    return session;
  }

  function sync(id) {
    try {
      syncMemory(store, id, now());
    } catch (error) {
      store.logError(id, '기억 맞추기', error);
      throw new EngineError('memory_sync_failed');
    }
  }

  function reviewInput(session, turns, t, memory) {
    const { axis } = t.question.assumption;
    const knownAssumptions =
      axis === 'none'
        ? []
        : [
            ...memory
              .filter((r) => r.axis === axis)
              .sort(byCreated)
              .map((r) => ({ key: r.id, statement: r.statement })),
            ...turns
              .filter((o) => o.seq < t.seq && o.question.assumption.axis === axis)
              .map((o) => ({ key: `turn:${o.id}`, statement: o.question.assumption.statement })),
          ];
    return {
      topic: session.topic,
      interviewer: memberOf(session, t.interviewerId),
      cause: { reactionIntent: t.reactionIntent, defect: t.defect },
      question: { ...t.question, answerKey: answerKeyOf(t) },
      clarifications: t.clarifications.map((c) => ({ ask: c.ask, reply: c.reply })),
      answer: t.answer,
      analysis: t.analysis,
      followUps: followUpsOf(t, turns).map((f) => {
        if (f.reactionIntent === null || f.defect === null) throw new Error(`반응 의도나 결함이 없는 후속 질문이다: ${f.id}`);
        return { interviewerId: f.interviewerId, addOn: f.addOn, reactionIntent: f.reactionIntent, defect: f.defect, text: f.question.text };
      }),
      knownAssumptions,
    };
  }

  function computeAll() {
    const finished = store.listInterviews().filter((s) => s.status === 'finished').slice(0, 10);
    const turns = finished.flatMap((s) => store.readTurns(s.id));
    const records = store.readMemory();
    const { improved, sessions } = computeStats(finished, turns, records);
    return {
      improved,
      // 답 시작 시간은 스킬에 없다.
      sessions: sessions.map(({ medianAnswerStartMs: _drop, ...s }) => s),
      pendingTopics: pendingTopics(records, now(), config.reissueAfterHours),
    };
  }

  function writeStats() {
    const stats = computeAll();
    writeText(statsFile, renderStats(stats));
    return stats;
  }

  function writeDocs(id) {
    const session = store.readSession(id);
    const turns = store.readTurns(id);
    const rows = store.readCalls(id);
    const usage = summarizeCalls(rows);
    const view = toReviewView(session, turns, {
      running: false,
      error: null,
      folded: foldAssumptions(turns, store.readMemory().map((r) => r.id)),
      usage,
      judgment: session.end?.judgeSeq == null ? null : (store.readJudge(id, session.end.judgeSeq)?.judgment ?? null),
    });
    const waits = rows.filter((r) => r.type === 'wait').map((r) => ({ seq: r.seq, wall_ms: r.wall_ms }));
    writeText(paths(id).review, renderReview(view, { usage, waits }));
    writeStats();
  }

  return {
    paths,

    latestFinished() {
      return store.listInterviews().find((s) => s.status === 'finished')?.id ?? null;
    },

    async run(id) {
      const session = finishedSession(id);
      const turns = store.readTurns(id);
      const todo = turns.filter((t) => isReviewTarget(t) && t.review === null);
      const memory = store.readMemory();
      const engine = new TurnService(llmFor(id), config);
      let failed = 0;
      // 한 턴의 실패는 나머지를 멈추지 않는다.
      const reviewOne = async (t) => {
        try {
          const { review } = await engine.reviewTurn(reviewInput(session, turns, t, memory));
          store.writeReview(id, t.seq, { review, surprise: t.surprise });
        } catch (error) {
          failed += 1;
          store.logError(id, `복기(턴 ${t.seq})`, error);
        }
      };
      const started = clock();
      for (let i = 0; i < todo.length; i += config.reviewConcurrency) {
        if (clock() - started >= budgetMs) break;
        await Promise.all(todo.slice(i, i + config.reviewConcurrency).map(reviewOne));
      }

      const targets = store.readTurns(id).filter(isReviewTarget);
      const done = targets.filter((t) => t.review !== null).length;
      if (done < targets.length) return { done, total: targets.length, failed, ready: false };
      if (session.reviewedAt === null) {
        sync(id);
        store.writeSession(id, { ...session, reviewedAt: now() });
      }
      writeDocs(id);
      return { done, total: targets.length, failed, ready: true };
    },

    mark(id, seq, { result, surprise }) {
      const session = finishedSession(id);
      if (session.reviewedAt === null) throw new EngineError('not_reviewed', id);
      const turn = store.readTurns(id).find((t) => t.seq === seq);
      // 복기에 보이지 않는 턴은 고칠 수 없다. 둘 중 하나라도 안 되면 아무것도 저장하지 않는다.
      if (!turn || !isReviewTarget(turn) || turn.review === null) throw new EngineError('not_reviewable', `턴 ${seq}`);
      let { review } = turn;
      if (result !== undefined) {
        if (turn.question.assumption.axis === 'none') throw new EngineError('not_reviewable', `턴 ${seq}`);
        review = { ...review, assumption: { ...review.assumption, userResult: result } };
      }
      store.writeReview(id, seq, { review, surprise: surprise ?? turn.surprise });
      try {
        sync(id);
      } catch (error) {
        // 턴에 저장한 값은 그대로 둔다. 다시 run하면 기억부터 맞춘다.
        store.writeSession(id, { ...session, reviewedAt: null });
        throw error;
      }
      writeDocs(id);
      return { ready: true };
    },

    stats() {
      return writeStats();
    },
  };
}

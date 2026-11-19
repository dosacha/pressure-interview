// 줄기(여는 질문 + 꼬리질문 하나)의 규칙과 끝내기 판정의 코드 확인 (설계 5.2, 5.4~5.6, 5.10의 1).
import { ROLES } from './app/interview/catalog.mjs';

export const THRESHOLDS = {
  CORE_MOSTLY_RATIO: 0.8,
  CORE_SOLID_RATIO: 0.5,
  PRACTICAL_THREADS: 2,
  LEARNING_SIGNALS: 1,
  SETTLED_WRONG_RATIO: 0.5,
  EXHAUSTED_CANDIDATES: 3,
  UNKNOWN_REOPEN_LIMIT: 2,
};

const END_DECISIONS = ['enough', 'exhausted', 'settled'];
const EXHAUSTED_VERDICTS = ['repeat', 'contrived', 'offTopic'];
const LEARNING = ['reasoning', 'selfCorrection'];
const GOOD = ['solid', 'mostly'];

export function followUpKind({ score, defects, askedUnknown }) {
  if (askedUnknown) return null;
  if (score === 'solid') return 'deepen';
  if (defects.some((d) => d.type !== 'none')) return 'defect';
  return null;
}

// 되묻기 답은 점수도 신호도 없고 줄기를 닫지 않는다.
const analyzed = (turn) => (turn?.analysis && turn.analysis.kind !== 'clarify' ? turn.analysis : null);

export function threadScore(thread) {
  if (thread.unknownPremise) return null;
  return thread.followKind === 'defect' ? thread.followScore : thread.openScore;
}

export function threadsOf(turns) {
  const byNo = new Map();
  for (const t of turns) {
    if (!t.thread) continue; // 예전 턴
    const parts = byNo.get(t.thread.no) ?? {};
    parts[t.thread.role] ??= t;
    byNo.set(t.thread.no, parts);
  }
  return [...byNo.entries()]
    .sort(([a], [b]) => a - b)
    .map(([no, { open, follow }]) => {
      const oa = analyzed(open);
      const fa = analyzed(follow);
      // turn.service가 이미 말한 기술을 거른 목록. 그 목록이 없는 턴만 분석의 원래 목록을 쓴다.
      const unknownPremise = Boolean(oa && (open.askedUnknown ?? oa.unknownTechs)?.length);
      const planned = oa ? followUpKind({ score: oa.score, defects: oa.defects ?? [], askedUnknown: unknownPremise }) : null;
      const followKind = follow ? follow.thread.followKind : planned;
      const followScore = fa?.score ?? null;
      const thread = {
        no,
        areaId: (open ?? follow).thread.areaId,
        openSeq: open?.seq ?? null,
        followSeq: follow?.seq ?? null,
        followKind,
        closed: follow ? Boolean(fa) : Boolean(oa) && planned === null,
        score: null,
        openScore: oa?.score ?? null,
        followScore,
        signals: [
          ...(oa?.signals ?? []).map((s) => ({ type: s.type, quote: s.quote, seq: open.seq })),
          ...(fa?.signals ?? []).map((s) => ({ type: s.type, quote: s.quote, seq: follow.seq })),
        ],
        depthLimit: followKind === 'deepen' && (followScore === 'unclear' || followScore === 'wrong'),
        unknownPremise,
      };
      thread.score = threadScore(thread);
      return thread;
    });
}

export function areaStatus(topicMap, threads) {
  const status = {};
  for (const area of topicMap.areas) {
    const mine = threads.filter((t) => t.areaId === area.id);
    const unknownCount = mine.filter((t) => t.unknownPremise).length;
    status[area.id] = {
      asked: mine.some((t) => t.closed && !t.unknownPremise) || unknownCount >= THRESHOLDS.UNKNOWN_REOPEN_LIMIT,
      unknownCount,
      threadNos: mine.map((t) => t.no),
    };
  }
  return status;
}

export function pickNextArea({ wanted, topicMap, threads }) {
  const status = areaStatus(topicMap, threads);
  const { areas } = topicMap;
  const open = (id) => status[id].unknownCount < THRESHOLDS.UNKNOWN_REOPEN_LIMIT;
  if (Object.hasOwn(status, wanted) && open(wanted)) return wanted;
  const unasked = areas.filter((a) => !status[a.id].asked);
  return (unasked.find((a) => a.core) ?? unasked[0] ?? areas.find((a) => open(a.id)) ?? areas[0]).id;
}

const ratio = (n, d) => (d === 0 ? 0 : n / d);

export function checkJudgment({ judgment, topicMap, threads }) {
  const status = areaStatus(topicMap, threads);
  const coreIds = new Set(topicMap.areas.filter((a) => a.core).map((a) => a.id));
  const coreCovered = [...coreIds].every((id) => status[id].asked);
  // 점수 없는 줄기(전제 모름 등)는 비율의 분자·분모에서 뺀다.
  const scored = threads.filter((t) => coreIds.has(t.areaId) && t.score !== null);
  const share = (scores) => ratio(scored.filter((t) => scores.includes(t.score)).length, scored.length);
  const byNo = new Map(threads.map((t) => [t.no, t]));
  const hasPractical = (t) => GOOD.includes(t.score) && t.signals.some((s) => s.type === 'practical');
  const learningCount = threads.reduce((n, t) => n + t.signals.filter((s) => LEARNING.includes(s.type)).length, 0);
  // 판정이 댄 근거 줄기가 있고, 모두 장부에 있고, 조건을 채우는가.
  const cites = (nos, ok = () => true) =>
    Array.isArray(nos) && nos.length > 0 && nos.every((no) => byNo.has(no) && ok(byNo.get(no)));
  const evidence = judgment.evidence ?? {};

  const failed = [];
  if (judgment.decision === 'enough') {
    if (
      !coreCovered ||
      share(['solid', 'mostly']) < THRESHOLDS.CORE_MOSTLY_RATIO ||
      share(['solid']) < THRESHOLDS.CORE_SOLID_RATIO ||
      !cites(evidence.knows)
    )
      failed.push('knows');
    if (threads.filter(hasPractical).length < THRESHOLDS.PRACTICAL_THREADS || !cites(evidence.applies, hasPractical))
      failed.push('applies');
    const learns = (t) => t.signals.some((s) => LEARNING.includes(s.type));
    if (learningCount < THRESHOLDS.LEARNING_SIGNALS || !cites(evidence.learns, learns)) failed.push('learns');
  } else if (judgment.decision === 'settled') {
    if (!coreCovered) failed.push('coreCovered');
    if (share(['wrong']) < THRESHOLDS.SETTLED_WRONG_RATIO) failed.push('wrongRatio');
    if (learningCount > 0) failed.push('noLearning');
  } else if (judgment.decision === 'exhausted') {
    if (!coreCovered) failed.push('coreCovered');
    const candidates = judgment.candidates ?? [];
    const valid =
      candidates.length === THRESHOLDS.EXHAUSTED_CANDIDATES &&
      candidates.every((c) => EXHAUSTED_VERDICTS.includes(c.verdict) && typeof c.why === 'string' && c.why.trim() !== '');
    if (!valid) failed.push('candidates');
  }

  if (END_DECISIONS.includes(judgment.decision) && failed.length === 0) {
    return { decision: judgment.decision, nextAreaId: null, failed };
  }
  return { decision: 'continue', nextAreaId: pickNextArea({ wanted: judgment.nextArea, topicMap, threads }), failed };
}

// pickNext(rules.mjs)와 같은 규칙: 연속 상한에 걸린 사람을 빼고, 가장 오래 쉰 사람.
export function pickOpenerFor({ area, panel, history, maxConsecutive }) {
  const tail = history.slice(-maxConsecutive);
  const capped = history.length >= maxConsecutive && tail.every((id) => id === tail[0]) ? tail[0] : null;
  // Oldest last-question position first; never-asked is -1; ties keep panel order.
  const oldest = (pool) =>
    pool.reduce((best, m) => (history.lastIndexOf(m.id) < history.lastIndexOf(best.id) ? m : best));
  const rest = panel.filter((m) => m.id !== capped);
  const owned = rest.filter((m) => ROLES[m.role].axes.includes(area.axis));
  return oldest(owned.length ? owned : rest.length ? rest : panel);
}

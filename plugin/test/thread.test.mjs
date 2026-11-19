import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areaStatus,
  checkJudgment,
  followUpKind,
  pickNextArea,
  pickOpenerFor,
  THRESHOLDS,
  threadScore,
  threadsOf,
} from '../skills/pressure-interview/scripts/lib/thread.mjs';

const NO_DEFECT = [{ type: 'none', axis: 'none', note: '' }];
const WRONG = [{ type: 'wrong', axis: 'durability', note: '틀림' }];

function turn(seq, { thread, score = null, signals = [], defects = NO_DEFECT, kind = 'answer', unknownTechs = [], analyzed = true }) {
  return {
    seq,
    thread,
    question: { text: `질문 ${seq}` },
    analysis: analyzed ? { kind, score, signals, defects, unknownTechs } : null,
  };
}
const open = (seq, no, areaId, opts = {}) => turn(seq, { thread: { no, role: 'open', areaId, followKind: null }, ...opts });
const follow = (seq, no, areaId, followKind, opts = {}) => turn(seq, { thread: { no, role: 'follow', areaId, followKind }, ...opts });
const sig = (type) => ({ type, quote: `${type} 인용` });

const MAP = {
  areas: [
    { id: 'a1', name: '영역1', core: true, axis: 'durability' },
    { id: 'a2', name: '영역2', core: true, axis: 'scale' },
    { id: 'a3', name: '영역3', core: true, axis: 'cost' },
    { id: 'a4', name: '영역4', core: true, axis: 'failure' },
    { id: 'a5', name: '영역5', core: true, axis: 'cs_premise' },
    { id: 'p1', name: '주변1', core: false, axis: 'attack' },
  ],
};

// 핵심 5개 다 묻고 mostly 이상 4/5, solid 3, practical 2줄기, reasoning 1
function enoughTurns() {
  return [
    open(1, 1, 'a1', { score: 'solid', signals: [sig('practical')] }),
    follow(2, 1, 'a1', 'deepen', { score: 'solid' }),
    open(3, 2, 'a2', { score: 'solid' }),
    follow(4, 2, 'a2', 'deepen', { score: 'mostly' }),
    open(5, 3, 'a3', { score: 'solid', signals: [sig('practical')] }),
    follow(6, 3, 'a3', 'deepen', { score: 'wrong' }),
    open(7, 4, 'a4', { score: 'mostly', signals: [sig('reasoning')] }),
    open(8, 5, 'a5', { score: 'unclear', defects: WRONG }),
    follow(9, 5, 'a5', 'defect', { score: 'wrong' }),
  ];
}
const enoughJudgment = (evidence = {}) => ({
  decision: 'enough',
  evidence: { knows: [1, 2, 3, 4], applies: [1, 3], learns: [4], ...evidence },
  candidates: [],
  nextArea: '',
});

test('THRESHOLDS: 설계의 출발값 일곱', () => {
  assert.deepEqual(THRESHOLDS, {
    CORE_MOSTLY_RATIO: 0.8,
    CORE_SOLID_RATIO: 0.5,
    PRACTICAL_THREADS: 2,
    LEARNING_SIGNALS: 1,
    SETTLED_WRONG_RATIO: 0.5,
    EXHAUSTED_CANDIDATES: 3,
    UNKNOWN_REOPEN_LIMIT: 2,
  });
});

test('followUpKind: 모름이면 null, solid면 deepen, 결함 있으면 defect, mostly에 결함 없으면 null', () => {
  assert.equal(followUpKind({ score: 'solid', defects: WRONG, askedUnknown: true }), null);
  assert.equal(followUpKind({ score: 'solid', defects: WRONG, askedUnknown: false }), 'deepen');
  assert.equal(followUpKind({ score: 'unclear', defects: WRONG, askedUnknown: false }), 'defect');
  assert.equal(followUpKind({ score: 'mostly', defects: NO_DEFECT, askedUnknown: false }), null);
  assert.equal(followUpKind({ score: 'mostly', defects: [], askedUnknown: false }), null);
});

test('threadsOf: 여는 질문 답이 되묻기면 줄기가 열려 있다', () => {
  const [t] = threadsOf([open(1, 1, 'a1', { kind: 'clarify', score: 'mostly', signals: [sig('practical')] })]);
  assert.equal(t.closed, false);
  assert.equal(t.openScore, null);
  assert.deepEqual(t.signals, []);
  assert.equal(t.score, null);
});

test('threadsOf: 꼬리질문 답이 되묻기여도 닫히지 않는다', () => {
  const [t] = threadsOf([
    open(1, 1, 'a1', { score: 'unclear', defects: WRONG }),
    follow(2, 1, 'a1', 'defect', { kind: 'clarify', score: 'solid' }),
  ]);
  assert.equal(t.closed, false);
  assert.equal(t.followSeq, 2);
  assert.equal(t.followScore, null);
});

test('threadsOf: 줄기 모양과 닫힘, 예전 턴은 건너뛴다', () => {
  const threads = threadsOf([
    { seq: 0, thread: null, question: { text: '예전' }, analysis: null },
    open(1, 1, 'a1', { score: 'mostly', signals: [sig('reasoning')] }),
    open(2, 2, 'a2', { score: 'solid' }),
    open(3, 3, 'a3', { analyzed: false }),
  ]);
  assert.equal(threads.length, 3);
  assert.deepEqual(threads[0], {
    no: 1, areaId: 'a1', openSeq: 1, followSeq: null, followKind: null, closed: true,
    score: 'mostly', openScore: 'mostly', followScore: null,
    signals: [{ type: 'reasoning', quote: 'reasoning 인용', seq: 1 }],
    depthLimit: false, unknownPremise: false,
  });
  // solid인데 꼬리질문이 아직 없으면 열려 있다
  assert.equal(threads[1].closed, false);
  assert.equal(threads[1].followKind, 'deepen');
  assert.equal(threads[2].closed, false);
});

test('threadScore: defect 꼬리질문은 꼬리질문 답 점수, deepen은 여는 답 점수이고 꼬리 wrong이면 depthLimit', () => {
  const [defect, deepen] = threadsOf([
    open(1, 1, 'a1', { score: 'wrong', defects: WRONG }),
    follow(2, 1, 'a1', 'defect', { score: 'solid', signals: [sig('selfCorrection')] }),
    open(3, 2, 'a2', { score: 'solid' }),
    follow(4, 2, 'a2', 'deepen', { score: 'wrong' }),
  ]);
  assert.equal(threadScore(defect), 'solid');
  assert.equal(defect.closed, true);
  assert.equal(defect.depthLimit, false);
  assert.deepEqual(defect.signals.map((s) => s.seq), [2]);
  assert.equal(threadScore(deepen), 'solid');
  assert.equal(deepen.score, 'solid');
  assert.equal(deepen.depthLimit, true);
});

test('threadScore: 전제 모름은 null', () => {
  const [t] = threadsOf([open(1, 1, 'a1', { score: 'wrong', defects: WRONG, unknownTechs: ['Raft'] })]);
  assert.equal(t.unknownPremise, true);
  assert.equal(t.closed, true);
  assert.equal(t.followKind, null);
  assert.equal(threadScore(t), null);
});

test('areaStatus: 전제 모름 한 번은 안 물은 것, 두 번이면 물은 것', () => {
  const unknown = (seq, no) => open(seq, no, 'a1', { unknownTechs: ['Raft'] });
  const once = areaStatus(MAP, threadsOf([unknown(1, 1), open(2, 2, 'a2', { score: 'mostly' })]));
  assert.deepEqual(once.a1, { asked: false, unknownCount: 1, threadNos: [1] });
  assert.deepEqual(once.a2, { asked: true, unknownCount: 0, threadNos: [2] });
  assert.deepEqual(once.p1, { asked: false, unknownCount: 0, threadNos: [] });
  const twice = areaStatus(MAP, threadsOf([unknown(1, 1), unknown(2, 2)]));
  assert.deepEqual(twice.a1, { asked: true, unknownCount: 2, threadNos: [1, 2] });
});

test('checkJudgment enough: 핵심 5개 다 묻고 mostly 이상 4/5, solid 3, practical 2줄기, reasoning 1 → enough', () => {
  const threads = threadsOf(enoughTurns());
  assert.deepEqual(checkJudgment({ judgment: enoughJudgment(), topicMap: MAP, threads }), {
    decision: 'enough',
    nextAreaId: null,
    failed: [],
  });
});

test('checkJudgment enough: solid가 절반 미만이면 continue, failed에 knows', () => {
  const turns = enoughTurns();
  // 줄기 2를 mostly로 내린다: solid 2/5
  turns[2] = open(3, 2, 'a2', { score: 'mostly' });
  turns.splice(3, 1);
  const r = checkJudgment({ judgment: enoughJudgment(), topicMap: MAP, threads: threadsOf(turns) });
  assert.equal(r.decision, 'continue');
  assert.deepEqual(r.failed, ['knows']);
  assert.equal(r.nextAreaId, 'p1');
});

test('checkJudgment enough: 근거 줄기 번호가 장부에 없으면 continue', () => {
  const threads = threadsOf(enoughTurns());
  const r = checkJudgment({ judgment: enoughJudgment({ applies: [1, 99], learns: [] }), topicMap: MAP, threads });
  assert.equal(r.decision, 'continue');
  assert.deepEqual(r.failed, ['applies', 'learns']);
  // practical이 없는 줄기를 대도 어긋난다
  const r2 = checkJudgment({ judgment: enoughJudgment({ applies: [1, 2] }), topicMap: MAP, threads });
  assert.deepEqual(r2.failed, ['applies']);
  const r3 = checkJudgment({ judgment: enoughJudgment({ knows: [42] }), topicMap: MAP, threads });
  assert.deepEqual(r3.failed, ['knows']);
});

test('checkJudgment enough: 비율 계산에서 점수 없는 줄기를 뺀다', () => {
  // 줄기 6: a5의 전제 모름(점수 null). 빼지 않으면 mostly 이상 4/6 < 0.8
  const turns = [...enoughTurns(), open(10, 6, 'a5', { unknownTechs: ['Raft'] })];
  const r = checkJudgment({ judgment: enoughJudgment(), topicMap: MAP, threads: threadsOf(turns) });
  assert.equal(r.decision, 'enough');
});

const settledJudgment = { decision: 'settled', evidence: { knows: [], applies: [], learns: [] }, candidates: [], nextArea: '' };

test('checkJudgment settled: 핵심을 다 돌기 전이면 continue, failed에 coreCovered', () => {
  const threads = threadsOf([
    open(1, 1, 'a1', { score: 'wrong' }),
    open(2, 2, 'a2', { score: 'wrong' }),
  ]);
  const r = checkJudgment({ judgment: settledJudgment, topicMap: MAP, threads });
  assert.deepEqual(r, { decision: 'continue', nextAreaId: 'a3', failed: ['coreCovered'] });
});

test('checkJudgment settled: wrong 절반 이상이어도 reasoning이 있으면 continue', () => {
  const turns = ['a1', 'a2', 'a3', 'a4', 'a5'].map((a, i) => open(i + 1, i + 1, a, { score: i < 3 ? 'wrong' : 'mostly' }));
  assert.equal(checkJudgment({ judgment: settledJudgment, topicMap: MAP, threads: threadsOf(turns) }).decision, 'settled');
  turns[4] = open(5, 5, 'a5', { score: 'mostly', signals: [sig('reasoning')] });
  const r = checkJudgment({ judgment: settledJudgment, topicMap: MAP, threads: threadsOf(turns) });
  assert.equal(r.decision, 'continue');
  assert.deepEqual(r.failed, ['noLearning']);
});

test('checkJudgment exhausted: 후보가 둘이면 continue, failed에 candidates', () => {
  const threads = threadsOf(['a1', 'a2', 'a3', 'a4', 'a5'].map((a, i) => open(i + 1, i + 1, a, { score: 'mostly' })));
  const cand = (verdict, why = '까닭') => ({ question: '후보', verdict, why });
  const judgment = (candidates) => ({ decision: 'exhausted', evidence: { knows: [], applies: [], learns: [] }, candidates, nextArea: '' });
  const ok = checkJudgment({ judgment: judgment([cand('repeat'), cand('contrived'), cand('offTopic')]), topicMap: MAP, threads });
  assert.deepEqual(ok, { decision: 'exhausted', nextAreaId: null, failed: [] });
  const two = checkJudgment({ judgment: judgment([cand('repeat'), cand('contrived')]), topicMap: MAP, threads });
  assert.deepEqual(two, { decision: 'continue', nextAreaId: 'p1', failed: ['candidates'] });
  const okVerdict = checkJudgment({ judgment: judgment([cand('repeat'), cand('ok'), cand('offTopic')]), topicMap: MAP, threads });
  assert.deepEqual(okVerdict.failed, ['candidates']);
  const noWhy = checkJudgment({ judgment: judgment([cand('repeat'), cand('contrived', ' '), cand('offTopic')]), topicMap: MAP, threads });
  assert.deepEqual(noWhy.failed, ['candidates']);
});

test('checkJudgment continue: 판정이 준 영역을 쓴다', () => {
  const threads = threadsOf([open(1, 1, 'a1', { score: 'mostly' })]);
  const r = checkJudgment({ judgment: { ...settledJudgment, decision: 'continue', nextArea: 'a4' }, topicMap: MAP, threads });
  assert.deepEqual(r, { decision: 'continue', nextAreaId: 'a4', failed: [] });
});

test('pickNextArea: 지도에 없는 id면 안 물은 첫 핵심 영역', () => {
  const threads = threadsOf([open(1, 1, 'a1', { score: 'mostly' })]);
  assert.equal(pickNextArea({ wanted: 'zzz', topicMap: MAP, threads }), 'a2');
  assert.equal(pickNextArea({ wanted: 'a1', topicMap: MAP, threads }), 'a1');
  const all = threadsOf(MAP.areas.map((a, i) => open(i + 1, i + 1, a.id, { score: 'mostly' })));
  assert.equal(pickNextArea({ wanted: '', topicMap: MAP, threads: all }), 'a1');
});

test('pickNextArea: 전제 모름으로 두 번 닫힌 영역을 주면 다른 영역', () => {
  const threads = threadsOf([
    open(1, 1, 'a1', { score: 'mostly' }),
    open(2, 2, 'a2', { unknownTechs: ['Raft'] }),
    open(3, 3, 'a2', { unknownTechs: ['Paxos'] }),
  ]);
  assert.equal(pickNextArea({ wanted: 'a2', topicMap: MAP, threads }), 'a3');
  // 한 번이면 다시 열 수 있다
  assert.equal(pickNextArea({ wanted: 'a2', topicMap: MAP, threads: threads.slice(0, 2) }), 'a2');
});

test('pickOpenerFor: 축을 맡은 사람, 연속 상한이면 다른 사람, 맡은 사람이 없으면 가장 오래 쉰 사람', () => {
  const panel = [
    { id: 'p1', role: 'textbook', temperament: 'helper' },
    { id: 'p2', role: 'dba', temperament: 'persistent' },
    { id: 'p3', role: 'scenario', temperament: 'shaker' },
  ];
  const pick = (axis, history) => pickOpenerFor({ area: { axis }, panel, history, maxConsecutive: 2 }).id;
  assert.equal(pick('durability', ['p1']), 'p2');
  // 둘이 맡으면 가장 오래 쉰 사람
  assert.equal(pick('distribution', ['p2', 'p3']), 'p2');
  assert.equal(pick('distribution', ['p3', 'p2']), 'p3');
  // 맡은 사람이 연속 상한이면 나머지 가운데 가장 오래 쉰 사람
  assert.equal(pick('durability', ['p3', 'p2', 'p2']), 'p1');
  // 맡은 사람이 없으면 가장 오래 쉰 사람
  assert.equal(pick('attack', ['p1', 'p3']), 'p2');
});

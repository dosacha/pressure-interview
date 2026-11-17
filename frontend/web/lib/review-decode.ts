import { arr, bad, num, obj, str } from './decode';

// shortcut: 서버 타입(src/review/review.view.ts, stats.ts)을 손으로 옮겼다, 필드가 자주 바뀌면 공유 타입 폴더로
export type AssumptionResult = 'well' | 'wobbly' | 'wrong';
export interface Intent {
  id: string;
  name: string;
  group: string;
}
export interface DefectView {
  typeName: string;
  axisName: string;
  note: string;
}
export interface TurnReview {
  intent: { aimed: boolean; note: string };
  defects: { index: number; verdict: 'valid' | 'misjudged'; note: string }[];
  reactions: {
    index: number;
    verdict: 'valid_point' | 'misjudgment' | 'intended_test';
    note: string;
  }[];
  assumption: {
    result: AssumptionResult | 'none';
    note: string;
    sameAs: string | null;
    userResult?: AssumptionResult;
  };
  keyProblems: string[];
}
export interface ReviewTurnView {
  id: string;
  seq: number;
  addOn: boolean;
  interviewer: { id: string; roleName: string; temperamentName: string };
  text: string;
  clarifications: { ask: string; reply: string; leak: boolean }[];
  answer: string;
  answerStartMs: number | null;
  questionIntent: Intent;
  cause: { reactionIntent: Intent | null; defect: DefectView | null };
  assumption: { axisName: string; statement: string } | null;
  answerKey: {
    vanishing: string[];
    remaining: string[];
    alternatives: { name: string; traits: string }[];
    keyPoints: string[];
  };
  answerKeyCorrected: boolean;
  leakFlag: boolean;
  premiseFlag: boolean;
  analysis: DefectView[];
  followUps: { seq: number; addOn: boolean; roleName: string; reactionIntent: Intent }[];
  review: TurnReview | null;
  surprise: 'expected' | 'unexpected' | null;
}
export interface UsageSummary {
  role: string;
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  calls: number;
  fallbacks: number;
}
export interface ReviewView {
  id: string;
  topic: string;
  createdAt: string;
  status: 'none' | 'pending' | 'ready';
  progress: { done: number; total: number };
  error: 'REFUSAL' | 'MAX_TOKENS' | 'BAD_RESPONSE' | 'API_ERROR' | 'MEMORY_SYNC_FAILED' | null;
  turns: ReviewTurnView[];
  skippedAnswers: number;
  assumptions: { axisName: string; statement: string; result: AssumptionResult; turnSeq: number }[];
  usage: UsageSummary[];
}
export interface Stats {
  improved: number;
  sessions: {
    id: string;
    topic: string;
    date: string;
    medianAnswerStartMs: number | null;
    unexpectedRatio: number | null;
  }[];
}

const RESULTS: AssumptionResult[] = ['well', 'wobbly', 'wrong'];

function oneOf<T>(v: unknown, list: readonly T[], what: string): T {
  return list.includes(v as T) ? (v as T) : bad(what);
}
function bool(v: unknown, what: string): boolean {
  return typeof v === 'boolean' ? v : bad(what);
}
const strs = (v: unknown, what: string): string[] => arr(v, what).map((s) => str(s, what));
const numOrNull = (v: unknown, what: string): number | null => (v === null ? null : num(v, what));

function intent(v: unknown, what: string): Intent {
  const o = obj(v, what);
  return { id: str(o.id, what), name: str(o.name, what), group: str(o.group, what) };
}
function defect(v: unknown, what: string): DefectView {
  const o = obj(v, what);
  return {
    typeName: str(o.typeName, what),
    axisName: str(o.axisName, what),
    note: str(o.note, what),
  };
}

function decodeReview(v: unknown): TurnReview {
  const o = obj(v, 'review');
  const i = obj(o.intent, 'review.intent');
  const a = obj(o.assumption, 'review.assumption');
  return {
    intent: {
      aimed: bool(i.aimed, 'review.intent.aimed'),
      note: str(i.note, 'review.intent.note'),
    },
    defects: arr(o.defects, 'review.defects').map((x) => {
      const d = obj(x, 'review.defect');
      return {
        index: num(d.index, 'review.defect.index'),
        verdict: oneOf(d.verdict, ['valid', 'misjudged'] as const, 'review.defect.verdict'),
        note: str(d.note, 'review.defect.note'),
      };
    }),
    reactions: arr(o.reactions, 'review.reactions').map((x) => {
      const r = obj(x, 'review.reaction');
      return {
        index: num(r.index, 'review.reaction.index'),
        verdict: oneOf(
          r.verdict,
          ['valid_point', 'misjudgment', 'intended_test'] as const,
          'review.reaction.verdict',
        ),
        note: str(r.note, 'review.reaction.note'),
      };
    }),
    assumption: {
      result: oneOf(a.result, [...RESULTS, 'none'] as const, 'review.assumption.result'),
      note: str(a.note, 'review.assumption.note'),
      sameAs: a.sameAs === null ? null : str(a.sameAs, 'review.assumption.sameAs'),
      ...(a.userResult !== undefined && {
        userResult: oneOf(a.userResult, RESULTS, 'review.assumption.userResult'),
      }),
    },
    keyProblems: strs(o.keyProblems, 'review.keyProblems'),
  };
}

function decodeTurn(v: unknown): ReviewTurnView {
  const t = obj(v, 'turn');
  const who = obj(t.interviewer, 'turn.interviewer');
  const cause = obj(t.cause, 'turn.cause');
  const key = obj(t.answerKey, 'turn.answerKey');
  let assumption: ReviewTurnView['assumption'] = null;
  if (t.assumption !== null) {
    const a = obj(t.assumption, 'turn.assumption');
    assumption = {
      axisName: str(a.axisName, 'assumption.axisName'),
      statement: str(a.statement, 'assumption.statement'),
    };
  }
  return {
    id: str(t.id, 'turn.id'),
    seq: num(t.seq, 'turn.seq'),
    addOn: bool(t.addOn, 'turn.addOn'),
    interviewer: {
      id: str(who.id, 'interviewer.id'),
      roleName: str(who.roleName, 'interviewer.roleName'),
      temperamentName: str(who.temperamentName, 'interviewer.temperamentName'),
    },
    text: str(t.text, 'turn.text'),
    clarifications: arr(t.clarifications, 'turn.clarifications').map((x) => {
      const c = obj(x, 'clarification');
      return {
        ask: str(c.ask, 'clarification.ask'),
        reply: str(c.reply, 'clarification.reply'),
        leak: bool(c.leak, 'clarification.leak'),
      };
    }),
    answer: str(t.answer, 'turn.answer'),
    answerStartMs: numOrNull(t.answerStartMs, 'turn.answerStartMs'),
    questionIntent: intent(t.questionIntent, 'turn.questionIntent'),
    cause: {
      reactionIntent:
        cause.reactionIntent === null ? null : intent(cause.reactionIntent, 'cause.reactionIntent'),
      defect: cause.defect === null ? null : defect(cause.defect, 'cause.defect'),
    },
    assumption,
    answerKey: {
      vanishing: strs(key.vanishing, 'answerKey.vanishing'),
      remaining: strs(key.remaining, 'answerKey.remaining'),
      alternatives: arr(key.alternatives, 'answerKey.alternatives').map((x) => {
        const a = obj(x, 'alternative');
        return {
          name: str(a.name, 'alternative.name'),
          traits: str(a.traits, 'alternative.traits'),
        };
      }),
      keyPoints: strs(key.keyPoints, 'answerKey.keyPoints'),
    },
    answerKeyCorrected: bool(t.answerKeyCorrected, 'turn.answerKeyCorrected'),
    leakFlag: bool(t.leakFlag, 'turn.leakFlag'),
    premiseFlag: bool(t.premiseFlag, 'turn.premiseFlag'),
    analysis: arr(t.analysis, 'turn.analysis').map((x) => defect(x, 'analysis')),
    followUps: arr(t.followUps, 'turn.followUps').map((x) => {
      const f = obj(x, 'followUp');
      return {
        seq: num(f.seq, 'followUp.seq'),
        addOn: bool(f.addOn, 'followUp.addOn'),
        roleName: str(f.roleName, 'followUp.roleName'),
        reactionIntent: intent(f.reactionIntent, 'followUp.reactionIntent'),
      };
    }),
    review: t.review === null ? null : decodeReview(t.review),
    surprise: oneOf(t.surprise, ['expected', 'unexpected', null] as const, 'turn.surprise'),
  };
}

export function decodeReviewView(v: unknown): ReviewView {
  const o = obj(v, 'review view');
  const progress = obj(o.progress, 'progress');
  return {
    id: str(o.id, 'id'),
    topic: str(o.topic, 'topic'),
    createdAt: str(o.createdAt, 'createdAt'),
    status: oneOf(o.status, ['none', 'pending', 'ready'] as const, 'status'),
    progress: {
      done: num(progress.done, 'progress.done'),
      total: num(progress.total, 'progress.total'),
    },
    error: oneOf(
      o.error,
      ['REFUSAL', 'MAX_TOKENS', 'BAD_RESPONSE', 'API_ERROR', 'MEMORY_SYNC_FAILED', null] as const,
      'error',
    ),
    turns: arr(o.turns, 'turns').map(decodeTurn),
    skippedAnswers: num(o.skippedAnswers, 'skippedAnswers'),
    assumptions: arr(o.assumptions, 'assumptions').map((x) => {
      const a = obj(x, 'assumption');
      return {
        axisName: str(a.axisName, 'assumption.axisName'),
        statement: str(a.statement, 'assumption.statement'),
        result: oneOf(a.result, RESULTS, 'assumption.result'),
        turnSeq: num(a.turnSeq, 'assumption.turnSeq'),
      };
    }),
    usage: arr(o.usage, 'usage').map((x) => {
      const u = obj(x, 'usage');
      return {
        role: str(u.role, 'usage.role'),
        model: str(u.model, 'usage.model'),
        inputTokens: num(u.inputTokens, 'usage.inputTokens'),
        cacheCreationTokens: num(u.cacheCreationTokens, 'usage.cacheCreationTokens'),
        cacheReadTokens: num(u.cacheReadTokens, 'usage.cacheReadTokens'),
        outputTokens: num(u.outputTokens, 'usage.outputTokens'),
        calls: num(u.calls, 'usage.calls'),
        fallbacks: num(u.fallbacks, 'usage.fallbacks'),
      };
    }),
  };
}

export function decodeStats(v: unknown): Stats {
  const o = obj(v, 'stats');
  return {
    improved: num(o.improved, 'improved'),
    sessions: arr(o.sessions, 'sessions').map((x) => {
      const s = obj(x, 'stats session');
      return {
        id: str(s.id, 'session.id'),
        topic: str(s.topic, 'session.topic'),
        date: str(s.date, 'session.date'),
        medianAnswerStartMs: numOrNull(s.medianAnswerStartMs, 'session.medianAnswerStartMs'),
        unexpectedRatio: numOrNull(s.unexpectedRatio, 'session.unexpectedRatio'),
      };
    }),
  };
}

export const decodeTopics = (v: unknown): string[] => strs(obj(v, 'topics').topics, 'topics');

import {
  axisName,
  DEFECT_NAMES,
  INTENT_GROUPS,
  QUESTION_INTENTS,
  REACTION_INTENTS,
  ROLES,
  TEMPERAMENTS,
  type QuestionIntentId,
  type ReactionIntentId,
} from '../interview/catalog';
import type {
  AnswerKey,
  AssumptionResult,
  Defect,
  PanelMember,
  TurnReview,
} from '../interview/types';
import type { FoldedAssumption } from '../memory/memory-rules';
import type { InterviewSession } from '../session/interview-session.entity';
import type { InterviewTurn } from '../session/interview-turn.entity';
import type { UpstreamReason } from '../session/session-errors';
import type { UsageSummary } from '../usage/usage.service';

type Intent = { id: string; name: string; group: string };

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
  cause: {
    reactionIntent: Intent | null;
    defect: { typeName: string; axisName: string; note: string } | null;
  };
  assumption: { axisName: string; statement: string } | null;
  answerKey: AnswerKey;
  answerKeyCorrected: boolean;
  leakFlag: boolean;
  premiseFlag: boolean;
  analysis: { typeName: string; axisName: string; note: string }[];
  followUps: { seq: number; addOn: boolean; roleName: string; reactionIntent: Intent }[];
  review: TurnReview | null;
  surprise: 'expected' | 'unexpected' | null;
}

export interface ReviewView {
  id: string;
  topic: string;
  createdAt: string;
  status: 'none' | 'pending' | 'ready';
  progress: { done: number; total: number };
  error: UpstreamReason | 'MEMORY_SYNC_FAILED' | null;
  turns: ReviewTurnView[]; // 복기 대상 턴만
  skippedAnswers: number; // 답은 있는데 분석이 없거나 되묻기로 남아 빠진 턴의 수(P18)
  assumptions: {
    axisName: string;
    statement: string;
    result: AssumptionResult;
    turnSeq: number;
  }[];
  usage: UsageSummary[];
}

/** 복기 대상 턴: 답이 있고 분석이 답(되묻기가 아님)인 턴. */
export const isReviewTarget = (t: InterviewTurn): boolean =>
  t.answer !== null && t.analysis?.kind === 'answer';

/** 복기 대상 턴의 정답지. 분석 전에 맞추므로 있어야 한다. */
export function answerKeyOf(t: InterviewTurn): AnswerKey {
  if (t.question.answerKey === null) throw new Error(`정답지가 없는 질문이다: ${t.id}`);
  return t.question.answerKey;
}

/** 이 답에서 나온 질문: 이 턴이 원인인 턴들(seq 순). */
export const followUpsOf = (t: InterviewTurn, turns: InterviewTurn[]): InterviewTurn[] =>
  turns.filter((f) => f.causeTurnId === t.id).sort((a, b) => a.seq - b.seq);

export function memberOf(session: InterviewSession, interviewerId: string): PanelMember {
  const m = session.panel.find((p) => p.id === interviewerId);
  if (!m) throw new Error(`패널에 없는 면접관이다: ${interviewerId}`);
  return m;
}

function groupOf<T extends string>(groups: Record<string, T[]>, id: T): string {
  const found = Object.entries(groups).find(([, ids]) => ids.includes(id));
  if (!found) throw new Error(`묶음에 없는 의도다: ${id}`);
  return found[0];
}
const questionIntent = (id: QuestionIntentId): Intent => ({
  id,
  name: QUESTION_INTENTS[id],
  group: groupOf(INTENT_GROUPS.question, id),
});
const reactionIntent = (id: ReactionIntentId): Intent => ({
  id,
  name: REACTION_INTENTS[id],
  group: groupOf(INTENT_GROUPS.reaction, id),
});
const defectView = (d: Defect) => ({
  typeName: DEFECT_NAMES[d.type],
  axisName: axisName(d.axis),
  note: d.note,
});

function toTurnView(
  session: InterviewSession,
  t: InterviewTurn,
  turns: InterviewTurn[],
): ReviewTurnView {
  const m = memberOf(session, t.interviewerId);
  const { assumption } = t.question;
  return {
    id: t.id,
    seq: t.seq,
    addOn: t.addOn,
    interviewer: {
      id: m.id,
      roleName: ROLES[m.role].name,
      temperamentName: TEMPERAMENTS[m.temperament],
    },
    text: t.question.text,
    clarifications: t.clarifications.map((c) => ({ ask: c.ask, reply: c.reply, leak: c.leak })),
    answer: t.answer!,
    answerStartMs: t.answerStartMs,
    questionIntent: questionIntent(t.question.questionIntent),
    cause: {
      reactionIntent: t.reactionIntent === null ? null : reactionIntent(t.reactionIntent),
      defect: t.defect === null ? null : defectView(t.defect),
    },
    assumption:
      assumption.axis === 'none'
        ? null
        : { axisName: axisName(assumption.axis), statement: assumption.statement },
    answerKey: answerKeyOf(t),
    answerKeyCorrected: t.prepared.answerKeyCorrected,
    leakFlag: t.prepared.flags.leak,
    premiseFlag: t.prepared.flags.premise || t.verification?.premiseOk === false,
    analysis: t.analysis!.defects.map(defectView),
    followUps: followUpsOf(t, turns).map((f) => {
      if (f.reactionIntent === null) throw new Error(`반응 의도가 없는 후속 질문이다: ${f.id}`);
      return {
        seq: f.seq,
        addOn: f.addOn,
        roleName: ROLES[memberOf(session, f.interviewerId).role].name,
        reactionIntent: reactionIntent(f.reactionIntent),
      };
    }),
    review: t.review,
    surprise: t.surprise,
  };
}

// 끝난 면접에만 쓴다. 숨긴 값(의도·정답지·분석·성향)이 모두 실린다.
export function toReviewView(
  session: InterviewSession,
  turns: InterviewTurn[],
  extra: {
    running: boolean;
    error: ReviewView['error'];
    folded: FoldedAssumption[];
    usage: UsageSummary[];
  },
): ReviewView {
  const targets = turns.filter(isReviewTarget);
  const seqOf = new Map(turns.map((t) => [t.id, t.seq]));
  return {
    id: session.id,
    topic: session.topic,
    createdAt: session.createdAt.toISOString(),
    status: extra.running ? 'pending' : session.reviewedAt !== null ? 'ready' : 'none',
    progress: { done: targets.filter((t) => t.review !== null).length, total: targets.length },
    error: extra.error,
    turns: targets.map((t) => toTurnView(session, t, turns)),
    skippedAnswers: turns.filter((t) => t.answer !== null && !isReviewTarget(t)).length,
    assumptions: extra.folded.map((f) => ({
      axisName: axisName(f.axis),
      statement: f.statement,
      result: f.result,
      turnSeq: seqOf.get(f.turnIds[f.turnIds.length - 1])!,
    })),
    usage: extra.usage,
  };
}

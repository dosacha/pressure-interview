import { ROLES } from '../interview/catalog';
import type { InterviewSession } from './interview-session.entity';
import type { InterviewTurn } from './interview-turn.entity';
import { CLOSING_TEXT } from './session-rules';

export interface PublicTurn {
  id: string;
  seq: number;
  interviewerId: string;
  addOn: boolean;
  text: string;
  clarifications: { ask: string; reply: string }[];
  answer: string | null;
}

export interface InterviewView {
  id: string;
  topic: string;
  status: 'in_progress' | 'finished';
  questionLimit: number;
  panel: { id: string; roleName: string }[];
  turns: PublicTurn[];
  pending: 'answer' | 'retry' | null;
  closing: { interviewerId: string; text: string } | null;
  createdAt: string;
}

// 면접 중에 숨기는 값(정답지·의도·분석·성향)이 실리지 않도록 필드를 하나씩 골라 담는다.
export function toInterviewView(session: InterviewSession, turns: InterviewTurn[]): InterviewView {
  const finished = session.status === 'finished';
  return {
    id: session.id,
    topic: session.topic,
    status: session.status,
    questionLimit: session.questionLimit,
    panel: session.panel.map((m) => ({ id: m.id, roleName: ROLES[m.role].name })),
    turns: turns.map((t) => ({
      id: t.id,
      seq: t.seq,
      interviewerId: t.interviewerId,
      addOn: t.addOn,
      text: t.question.text,
      clarifications: t.clarifications.map((c) => ({ ask: c.ask, reply: c.reply })),
      answer: t.answer,
    })),
    pending: finished ? null : turns.at(-1)?.answer === null ? 'answer' : 'retry',
    closing: finished ? { interviewerId: turns[0].interviewerId, text: CLOSING_TEXT } : null,
    createdAt: session.createdAt.toISOString(),
  };
}

import type { AssumptionRecord } from '../memory/assumption-record.entity';
import type { InterviewSession } from '../session/interview-session.entity';
import type { InterviewTurn } from '../session/interview-turn.entity';

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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeStats(
  sessions: InterviewSession[],
  turns: InterviewTurn[],
  records: AssumptionRecord[],
): Stats {
  const improved = records.filter((r) => {
    if (r.status !== 'well') return false;
    const latest = Math.max(...r.encounters.map((e) => Date.parse(e.at)));
    return r.encounters.some(
      (e) => Date.parse(e.at) < latest && (e.result === 'wobbly' || e.result === 'wrong'),
    );
  }).length;
  const recent = sessions
    .filter((s) => s.status === 'finished')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);
  return {
    improved,
    sessions: recent.map((s) => {
      const own = turns.filter((t) => t.sessionId === s.id);
      const marked = own.filter((t) => t.surprise !== null);
      return {
        id: s.id,
        topic: s.topic,
        date: s.createdAt.toISOString(),
        medianAnswerStartMs: median(
          own.map((t) => t.answerStartMs).filter((v): v is number => v !== null),
        ),
        unexpectedRatio:
          marked.length === 0
            ? null
            : marked.filter((t) => t.surprise === 'unexpected').length / marked.length,
      };
    }),
  };
}

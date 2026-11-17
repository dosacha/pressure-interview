import type { AssumptionRecord } from '../memory/assumption-record.entity';
import type { InterviewSession } from '../session/interview-session.entity';
import type { InterviewTurn } from '../session/interview-turn.entity';
import { computeStats } from './stats';

const session = (id: string, createdAt = '2026-11-01T00:00:00.000Z') =>
  ({ id, topic: 'Redis', status: 'finished', createdAt: new Date(createdAt) }) as InterviewSession;
const turn = (
  sessionId: string,
  answerStartMs: number | null,
  surprise: 'expected' | 'unexpected' | null = null,
) => ({ sessionId, answerStartMs, surprise }) as InterviewTurn;
const encounter = (result: AssumptionRecord['status'], at: string) => ({
  sessionId: 's',
  turnId: 't',
  topic: 'Redis',
  result,
  surprise: null,
  at,
});

describe('추이', () => {
  it('흔들렸다가 잘 답한 가정만 improved로 센다', () => {
    const records = [
      {
        status: 'well',
        encounters: [
          encounter('wobbly', '2026-11-01T00:00:00.000Z'),
          encounter('well', '2026-11-02T00:00:00.000Z'),
        ],
      },
      { status: 'well', encounters: [encounter('well', '2026-11-01T00:00:00.000Z')] },
    ] as AssumptionRecord[];
    expect(computeStats([], [], records).improved).toBe(1);
  });

  it('답 시작 시간의 중앙값을 낸다. 값이 없으면 null', () => {
    const sessions = [
      session('a', '2026-11-03T00:00:00.000Z'),
      session('b', '2026-11-02T00:00:00.000Z'),
      session('c', '2026-11-01T00:00:00.000Z'),
    ];
    const turns = [
      turn('a', 5000),
      turn('a', 800),
      turn('a', null),
      turn('a', 1200),
      turn('b', 1000),
      turn('b', 2000),
      turn('c', null),
    ];
    const stats = computeStats(sessions, turns, []);
    expect(stats.sessions.map((s) => [s.id, s.medianAnswerStartMs])).toEqual([
      ['a', 1200],
      ['b', 1500],
      ['c', null],
    ]);
  });

  it('예상 밖 비율은 표시한 턴만으로 낸다', () => {
    const turns = [
      turn('a', null, 'expected'),
      turn('a', null, 'unexpected'),
      turn('a', null),
      turn('a', null),
      turn('b', null),
    ];
    const stats = computeStats([session('a'), session('b')], turns, []);
    expect(stats.sessions.map((s) => s.unexpectedRatio)).toEqual([0.5, null]);
  });

  it('끝난 면접만 최근 것부터 10개를 낸다', () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session(`s${i}`, `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
    );
    const running = { ...session('run', '2026-11-30T00:00:00.000Z'), status: 'in_progress' };
    const stats = computeStats([...sessions, running as InterviewSession], [], []);
    expect(stats.sessions.map((s) => s.id)).toEqual([
      's11',
      's10',
      's9',
      's8',
      's7',
      's6',
      's5',
      's4',
      's3',
      's2',
    ]);
    expect(stats.sessions[0]).toEqual({
      id: 's11',
      topic: 'Redis',
      date: '2026-11-12T00:00:00.000Z',
      medianAnswerStartMs: null,
      unexpectedRatio: null,
    });
  });
});

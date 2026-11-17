import type { InterviewSession } from './interview-session.entity';
import type { InterviewTurn } from './interview-turn.entity';
import { toInterviewView } from './interview.view';
import { CLOSING_TEXT } from './session-rules';

const session: InterviewSession = {
  id: 's1',
  topic: 'Redis',
  panel: [
    { id: 'p1', role: 'dba', temperament: 'persistent' },
    { id: 'p2', role: 'textbook', temperament: 'helper' },
    { id: 'p3', role: 'scenario', temperament: 'shaker' },
  ],
  questionLimit: 6,
  status: 'in_progress',
  userMentioned: ['Redis', '숨은-언급'],
  unknownTechs: ['숨은-모름'],
  pendingSecondary: {
    choice: {
      interviewerId: 'p3',
      defect: { type: 'missing_axis', axis: 'scale', note: '숨은-대기-결함' },
      reactionIntent: 'B9',
    },
    causeTurnId: 't0',
  },
  memory: { retired: [{ axis: 'scale', statement: '숨은-기억' }], reissue: [], expected: [] },
  createdAt: new Date('2026-11-17T00:00:00.000Z'),
  finishedAt: null,
  reviewedAt: null,
};

const draft = {
  text: '보이는 질문 문장',
  questionIntent: 'A1' as const,
  assumption: { axis: 'scale' as const, statement: '숨은-가정-문장' },
};
const answerKey = {
  vanishing: ['숨은-사라짐'],
  remaining: ['숨은-남음'],
  alternatives: [{ name: '숨은-대안', traits: '숨은-특징' }],
  keyPoints: ['숨은-핵심'],
};
const question = { ...draft, answerKey };

const turnWithEverything: InterviewTurn = {
  id: 't1',
  sessionId: 's1',
  seq: 1,
  interviewerId: 'p1',
  addOn: false,
  causeTurnId: 't0',
  reactionIntent: 'B6',
  defect: { type: 'wrong', axis: 'durability', note: '숨은-결함-메모' },
  targetAxis: 'scale',
  question,
  prepared: {
    flags: { leak: false, premise: false },
    answerKeyCorrected: false,
    attempts: [
      {
        draft,
        naming: { ok: true, violations: [], avoided: [] },
        premise: { premiseOk: true, problems: [{ field: 'text', problem: '숨은-전제-문제' }] },
        techs: [{ name: '숨은-기술', role: 'premise' }],
      },
    ],
  },
  verification: {
    premiseOk: true,
    problems: [{ field: 'f', problem: '숨은-문제' }],
    answerKey,
  },
  clarifications: [{ ask: '되묻기', reply: '응답', leak: true }],
  answer: '지원자 답',
  answerStartMs: 1200,
  answeredAt: new Date('2026-11-17T00:01:00.000Z'),
  analysis: {
    kind: 'answer',
    defects: [{ type: 'vague', axis: 'consistency', note: '숨은-분석-메모' }],
    mentionedTechs: ['숨은-언급'],
    unknownTechs: [],
  },
  pick: {
    interviewerId: 'p2',
    defect: { type: 'vague', axis: 'consistency', note: '숨은-분석-메모' },
    reactionIntent: 'B7',
    secondary: null,
  },
  surprise: 'unexpected',
  review: {
    intent: { aimed: true, note: '숨은-복기' },
    defects: [],
    reactions: [],
    assumption: { result: 'none', note: '', sameAs: null },
    keyProblems: [],
  },
  createdAt: new Date('2026-11-17T00:00:30.000Z'),
};

describe('toInterviewView', () => {
  it('뷰의 키는 타입에 적힌 것뿐이다 (Review Focus 1)', () => {
    const v = toInterviewView(session, [turnWithEverything]);
    expect(Object.keys(v).sort()).toEqual([
      'closing',
      'createdAt',
      'id',
      'panel',
      'pending',
      'questionLimit',
      'status',
      'topic',
      'turns',
    ]);
    expect(Object.keys(v.turns[0]).sort()).toEqual([
      'addOn',
      'answer',
      'clarifications',
      'id',
      'interviewerId',
      'seq',
      'text',
    ]);
    expect(Object.keys(v.turns[0].clarifications[0]).sort()).toEqual(['ask', 'reply']);
    expect(Object.keys(v.panel[0]).sort()).toEqual(['id', 'roleName']);
  });

  it('숨긴 값이 뷰의 어디에도 없다 (Review Focus 1)', () => {
    const json = JSON.stringify(toInterviewView(session, [turnWithEverything]));
    for (const hidden of [
      answerKey.keyPoints[0],
      answerKey.alternatives[0].name,
      draft.assumption.statement,
      '숨은-전제-문제',
      turnWithEverything.defect!.note,
      turnWithEverything.analysis!.defects[0].note,
      '집요형',
      '조력형',
      '흔드는형',
    ]) {
      expect(json).not.toContain(hidden);
    }
    expect(json).toContain(draft.text);
  });

  it('pending은 답을 기다리면 answer, 답 뒤 단계가 빠졌으면 retry, 끝났으면 null', () => {
    const open = { ...turnWithEverything, answer: null };
    expect(toInterviewView(session, [turnWithEverything, open]).pending).toBe('answer');
    expect(toInterviewView(session, [turnWithEverything]).pending).toBe('retry');
    const finished = toInterviewView({ ...session, status: 'finished' }, [
      turnWithEverything,
      open,
    ]);
    expect(finished.pending).toBeNull();
  });

  it('closing은 끝났을 때만 첫 질문자의 마무리다', () => {
    expect(toInterviewView(session, [turnWithEverything]).closing).toBeNull();
    const second = { ...turnWithEverything, id: 't2', seq: 2, interviewerId: 'p3' };
    const v = toInterviewView({ ...session, status: 'finished' }, [turnWithEverything, second]);
    expect(v.closing).toEqual({ interviewerId: 'p1', text: CLOSING_TEXT });
    expect(v.panel.map((p) => p.roleName)).toEqual(['DBA', '교과형', '시나리오형']);
    expect(v.createdAt).toBe('2026-11-17T00:00:00.000Z');
  });
});

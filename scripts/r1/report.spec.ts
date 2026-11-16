import { readEngineConfig } from '../../src/config/engine.config';
import { PreparedQuestion } from '../../src/interview/types';
import { R1Result, renderReport, sumUsage } from './report';

const prepared: PreparedQuestion = {
  question: {
    text: '인메모리 PostgreSQL이라면?',
    questionIntent: 'A1',
    assumption: { axis: 'identity_swap', statement: '디스크 없음' },
    answerKey: {
      vanishing: ['디스크 I/O'],
      remaining: ['데이터 모델'],
      alternatives: [{ name: 'Memcached', traits: '단순 KV' }],
      keyPoints: [],
    },
  },
  verification: {
    premiseOk: true,
    problems: [{ field: 'x', problem: 'y' }],
    answerKey: { vanishing: [], remaining: [], alternatives: [], keyPoints: [] },
  },
  answerKeyCorrected: true,
  flags: { leak: false, premise: false },
  usage: [],
  attempts: [],
};
prepared.attempts = [
  { question: prepared.question, naming: { ok: false, violations: ['Kafka'] }, verification: null },
  {
    question: prepared.question,
    naming: { ok: true, violations: [] },
    verification: prepared.verification,
  },
];
const results: R1Result[] = [
  {
    scenarioId: 'redis-identity',
    topic: 'Redis',
    panel: [{ id: 'p1', role: 'dba', temperament: 'shaker' }],
    first: { prepared, lateVerification: null },
    followUps: [
      {
        answerKind: 'wrong',
        answer: '...',
        analysis: {
          kind: 'answer',
          defects: [{ type: 'wrong', axis: 'durability', note: 'n' }],
          mentionedTechs: [],
        },
        pick: {
          interviewerId: 'p1',
          defect: { type: 'wrong', axis: 'durability', note: 'n' },
          reactionIntent: 'B9',
          secondary: null,
        },
        next: { prepared, lateVerification: null },
      },
    ],
    usage: [
      { input_tokens: 3, output_tokens: 4 },
      { input_tokens: 5, output_tokens: 6 },
    ],
    error: null,
  },
  {
    scenarioId: 'node-premise',
    topic: 'NodeJS',
    panel: [],
    first: null,
    followUps: [],
    usage: [],
    error: 'refusal: cyber',
  },
];

describe('R1 report', () => {
  it('사용량을 합친다', () => {
    expect(sumUsage(results[0].usage)).toEqual({ input_tokens: 8, output_tokens: 10 });
  });
  it('검토할 항목이 모두 들어간다', () => {
    const md = renderReport({ startedAt: '2026-11-16T00:00:00Z', results });
    for (const s of [
      '인메모리 PostgreSQL이라면?',
      'A1 원리 이해',
      '디스크 없음',
      'Memcached',
      '정답지 수정됨',
      'Kafka',
      'B9 수용성 시험',
      'DBA',
      '흔드는형',
      '- [ ] 예상 밖인가',
      '- [ ] 해답을 흘리지 않았나',
      '오류: refusal: cyber',
    ]) {
      expect(md).toContain(s);
    }
  });
  it('engine을 주면 모델 이름이, 버려진 시도가 있으면 그 질문 문장이 들어간다', () => {
    const discarded: PreparedQuestion = {
      ...prepared,
      attempts: [
        {
          question: { ...prepared.question, text: '버려진 질문: Kafka로 바꾸면?' },
          naming: { ok: false, violations: ['Kafka'] },
          verification: null,
        },
        prepared.attempts[1],
      ],
    };
    const engine = readEngineConfig({ ENGINE_MODEL_VERIFY: 'claude-test-verify' });
    const md = renderReport({
      startedAt: '2026-11-16T00:00:00Z',
      results: [{ ...results[0], first: { prepared: discarded, lateVerification: null } }],
      engine,
    });
    expect(md).toContain('claude-test-verify');
    expect(md).toContain('버려진 질문: Kafka로 바꾸면?');
  });
});

import { readEngineConfig } from '../../src/config/engine.config';
import { PreparedQuestion, Question } from '../../src/interview/types';
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
  it('질문자, 남은 위반, 사후 검증의 전제 오류, 후속 실패를 보여 주고 줄바꿈에 목록이 끊기지 않는다', () => {
    const leaked: PreparedQuestion = {
      ...prepared,
      question: { ...prepared.question, assumption: { axis: 'none', statement: '' } },
      verification: null,
      answerKeyCorrected: false,
      flags: { leak: true, premise: false },
      attempts: [
        {
          question: { ...prepared.question, text: '첫 줄\n둘째 줄' },
          naming: { ok: false, violations: ['Kafka'] },
          verification: null,
        },
        {
          question: prepared.question,
          naming: { ok: false, violations: ['RabbitMQ'] },
          verification: null,
        },
      ],
    };
    const late = {
      premiseOk: false,
      problems: [{ field: 'text', problem: '문제 첫 줄\n문제 둘째 줄' }],
      answerKey: prepared.question.answerKey,
    };
    const md = renderReport({
      startedAt: '2026-11-16T00:00:00Z',
      results: [
        {
          ...results[0],
          first: { prepared: leaked, lateVerification: late, askedBy: 'p1' },
          followUps: [{ ...results[0].followUps[0], next: null }],
          error: 'boom',
        },
      ],
    });
    expect(md).toContain('### 첫 질문 — p1 (DBA · 흔드는형)');
    expect(md).toContain('최종 질문에 남은 이름 위반: RabbitMQ');
    expect(md).toContain('이미 나간 질문의 전제가 사후 검증에서 틀린 것으로 나옴');
    expect(md).toContain('후속 질문 생성 중 실패');
    expect(md).toContain('  > 둘째 줄');
    expect(md).toContain('  > 문제 둘째 줄');
    expect(md).not.toMatch(/^둘째 줄/m);
    expect(md).not.toMatch(/^문제 둘째 줄/m);
  });
  it('흘림 검사가 찾은 기술과 역할을 시도마다 보여 주고, 가정 없는 질문의 premise 바꿈을 알린다', () => {
    const noAssumption: Question = {
      ...prepared.question,
      assumption: { axis: 'none', statement: '' },
    };
    const withTechs: PreparedQuestion = {
      ...prepared,
      question: noAssumption,
      verification: null,
      answerKeyCorrected: false,
      attempts: [
        {
          question: noAssumption,
          naming: { ok: false, violations: ['PostgreSQL'] },
          verification: null,
          techs: [
            { name: 'PostgreSQL', role: 'premise' },
            { name: 'Redis', role: 'user' },
          ],
        },
        {
          question: noAssumption,
          naming: { ok: true, violations: [] },
          verification: null,
          techs: [],
        },
      ],
    };
    const md = renderReport({
      startedAt: '2026-11-16T00:00:00Z',
      results: [{ ...results[0], first: { prepared: withTechs, lateVerification: null } }],
    });
    expect(md).toContain('- 시도 1 검출된 기술: PostgreSQL(premise), Redis(user)');
    expect(md).toContain('- 시도 2 검출된 기술: 없음');
    expect(md).toMatch(/시도 1.*premise.*solution.*PostgreSQL/);
    expect(md).not.toMatch(/시도 2.*premise.*solution/);
  });
  it('지정한 축을 보여 주고, 모델이 적은 축과 다르면 다르다고 적는다', () => {
    const none: PreparedQuestion = {
      ...prepared,
      question: { ...prepared.question, assumption: { axis: 'none', statement: '' } },
    };
    const render = (step: R1Result['first']) =>
      renderReport({
        startedAt: '2026-11-16T00:00:00Z',
        results: [{ ...results[0], first: step }],
      });
    const same = render({ prepared, lateVerification: null, targetAxis: 'identity_swap' });
    expect(same).toContain('- 지정한 축: 기술의 핵심 속성 바꾸기(정체성 비교)');
    expect(same).not.toContain('다르다');
    const differs = render({ prepared: none, lateVerification: null, targetAxis: 'identity_swap' });
    expect(differs).toMatch(/- 지정한 축: 기술의 핵심 속성 바꾸기\(정체성 비교\).*다르다/);
    expect(render({ prepared, lateVerification: null })).not.toContain('지정한 축');
  });
  it('가정 없는 질문의 premise flag는 해당 없음으로 적고, 버린 이유와 질문 문장은 따로 읽힌다', () => {
    const none: PreparedQuestion = {
      ...prepared,
      question: { ...prepared.question, assumption: { axis: 'none', statement: '' } },
      verification: null,
      answerKeyCorrected: false,
      attempts: [
        {
          question: { ...prepared.question, text: '버려진 질문 문장' },
          naming: { ok: true, violations: [] },
          verification: {
            premiseOk: false,
            problems: [{ field: 'text', problem: '이유 첫 줄\n이유 둘째 줄' }],
            answerKey: prepared.question.answerKey,
          },
        },
        prepared.attempts[1],
      ],
    };
    const md = renderReport({
      startedAt: '2026-11-16T00:00:00Z',
      results: [
        { ...results[0], first: { prepared: none, lateVerification: null }, followUps: [] },
      ],
    });
    expect(md).toMatch(/premise\(.*\) 해당 없음/);
    expect(md).not.toMatch(/premise\(.*\) false/);
    expect(md).toContain('  > 버려진 질문 문장');
    expect(md).not.toContain('이유 둘째 줄)\n  > 버려진 질문 문장');
  });
  it('pick이 없어 후속 질문이 없을 때, 사후 검증 중 실패, 시나리오가 멈춘 줄', () => {
    const none: PreparedQuestion = {
      ...prepared,
      question: { ...prepared.question, assumption: { axis: 'none', statement: '' } },
      verification: null,
    };
    const noPick = { ...results[0].followUps[0], pick: null, next: null };
    const ok = renderReport({
      startedAt: '2026-11-16T00:00:00Z',
      results: [{ ...results[0], followUps: [noPick] }],
    });
    expect(ok).toContain('- 고른 면접관 없음(pick 없음)');
    expect(ok).toContain('후속 질문을 만들지 않았다.');
    expect(ok).not.toContain('시나리오가 여기서 멈췄다');
    const failed = renderReport({
      startedAt: '2026-11-16T00:00:00Z',
      results: [
        {
          ...results[0],
          first: { prepared: none, lateVerification: null },
          followUps: [],
          error: '검증 실패',
          answerCount: 3,
        },
      ],
    });
    expect(failed).toContain('- 사후 검증 중 실패(시나리오 오류 참고)');
    expect(failed).toContain('시나리오가 여기서 멈췄다: 답 3개 중 0개까지 기록.');
  });
});

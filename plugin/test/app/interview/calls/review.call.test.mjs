// 서버판 src/interview/calls/review.call.spec.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { describe, it, expect, jest } from '../../../jest-shim.mjs';
import { REACTION_INTENTS } from '../../../../skills/pressure-interview/scripts/lib/app/interview/catalog.mjs';
                                                                          
import { buildReviewPrompt, REVIEW_SCHEMA, reviewTurn } from '../../../../skills/pressure-interview/scripts/lib/app/interview/calls/review.call.mjs';

const input              = {
  topic: 'Redis',
  interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
  cause: { reactionIntent: 'B6', defect: { type: 'vague', axis: 'scale', note: '앞 답의 결함' } },
  question: {
    text: '인메모리 PostgreSQL이라면 Redis와 뭐가 다를까요?',
    questionIntent: 'A7',
    assumption: { axis: 'identity_swap', statement: '디스크 없이 메모리에서만 동작한다.' },
    answerKey: {
      vanishing: ['디스크 I/O'],
      remaining: ['데이터 모델'],
      alternatives: [{ name: '대안-기술', traits: '대안-특징' }],
      keyPoints: ['정답지-핵심'],
    },
  },
  clarifications: [{ ask: '읽기 위주인가요?', reply: '읽기 위주로 보세요.' }],
  answer: '지원자-답-문장',
  analysis: {
    kind: 'answer',
    defects: [{ type: 'wrong', axis: 'durability', note: '분석-결함-메모' }],
    mentionedTechs: [],
  },
  followUps: [
    {
      interviewerId: 'p2',
      addOn: false,
      reactionIntent: 'B8',
      defect: { type: 'wrong', axis: 'durability', note: '분석-결함-메모' },
      text: '첫-후속-질문',
    },
    {
      interviewerId: 'p3',
      addOn: true,
      reactionIntent: 'B9',
      defect: { type: 'wrong', axis: 'durability', note: '분석-결함-메모' },
      text: '둘째-후속-질문',
    },
  ],
  knownAssumptions: [{ key: 'turn:t1', statement: '앞선-가정-문장' }],
};

                                                                              
const schema = REVIEW_SCHEMA                   ;

describe('review.call', () => {
  it('스키마의 verdict와 result 값이 타입과 같다', () => {
    const defectVerdicts                                             = ['valid', 'misjudged'];
    const reactionVerdicts                                               = [
      'valid_point',
      'misjudgment',
      'intended_test',
      'deepening',
    ];
    const results                                = ['well', 'wobbly', 'wrong', 'none'];
    const p = schema.properties;
    expect(p.defects.items.properties.verdict.enum).toEqual(defectVerdicts);
    expect(p.reactions.items.properties.verdict.enum).toEqual(reactionVerdicts);
    expect(p.assumption.properties.result.enum).toEqual(results);
    expect(REVIEW_SCHEMA.required).toEqual([
      'intent',
      'defects',
      'reactions',
      'assumption',
      'keyProblems',
    ]);
  });
  it('정답지, 답, 면접 중 판정, 이 답에서 나온 질문들을 모두 싣는다', () => {
    const { user } = buildReviewPrompt(input);
    for (const s of [
      input.question.answerKey.keyPoints[0],
      input.answer,
      input.analysis.defects[0].note,
      input.followUps[0].text,
      input.followUps[1].text,
    ])
      expect(user).toContain(s);
    expect(user).toContain(`B8 ${REACTION_INTENTS.B8}`);
    expect(user).toContain('읽기 위주로 보세요.');
  });
  it('덧붙이는 질문은 덧붙이기라고 표시해 싣는다', () => {
    const { user } = buildReviewPrompt(input);
    const lines = user.split('\n');
    expect(lines.find((l) => l.includes('둘째-후속-질문'))).toContain('덧붙이는 질문');
    expect(lines.find((l) => l.includes('첫-후속-질문'))).not.toContain('덧붙이는 질문');
  });
  it('가정 없는 질문이면 result를 none으로 두라고 알린다', () => {
    const { system } = buildReviewPrompt(input);
    expect(system).toContain('가정을 바꾸지 않은 질문이면 result를 none으로 둔다');
  });
  it('더 깊이 물은 질문을 가르는 분류와 그 까닭을 말한다', () => {
    const { system } = buildReviewPrompt(input);
    for (const s of [
      '- deepening: 답에 실제 결함이 없었고, 면접관도 답을 틀렸다고 보지 않은 채 난이도나 범위를 올려 더 물었거나 답이 다루지 않은 부분으로 넘어간 것이다.',
      '이면 deepening이 아니라 intended_test다.',
      'valid_point로 적으면 지원자가 맞는 답에 결함이 있었다고 오해한다.',
      '어느 것이 답이 맞아 더 물은 것이며,',
    ])
      expect(system).toContain(s);
    expect(system.indexOf('- intended_test:')).toBeLessThan(system.indexOf('- deepening:'));
    expect(system.indexOf('- deepening:')).toBeLessThan(system.indexOf('- valid_point:'));
  });
  it('같은 축의 가정을 key와 함께 싣는다', () => {
    const { user } = buildReviewPrompt(input);
    expect(user).toContain('turn:t1');
    expect(user).toContain('앞선-가정-문장');
  });
  it('이 답에서 나온 질문이 없으면 그 절이 없다', () => {
    const { user } = buildReviewPrompt(input);
    expect(user).toContain('이 답에서 나온 질문');
    const none = buildReviewPrompt({ ...input, followUps: [] }).user;
    expect(none).not.toContain('이 답에서 나온 질문');
    expect(none).not.toContain('첫-후속-질문');
  });
  it('review 역할과 복기 스키마로 호출한다', async () => {
    const callJson = jest
      .fn()
      .mockResolvedValue({ data: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: 'm' });
    await reviewTurn({ callJson }, input);
    expect(callJson).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'review', schema: REVIEW_SCHEMA }),
    );
  });
});

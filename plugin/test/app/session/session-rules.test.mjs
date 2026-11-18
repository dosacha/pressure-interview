// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/session/session-rules.spec.ts @ aeae0dd, 도구: tools/port-app-src.mjs
import { describe, it, expect, jest } from '../../jest-shim.mjs';
                                                           
import { chooseTargetAxis, composePanel, nextAsker, pickOpener } from '../../../skills/pressure-interview/scripts/lib/app/session/session-rules.mjs';

const choiceA             = {
  interviewerId: 'p1',
  defect: { type: 'vague', axis: 'scale', note: '막연하다' },
  reactionIntent: 'B2',
};
const choiceB             = {
  interviewerId: 'p2',
  defect: { type: 'none', axis: 'cost', note: '' },
  reactionIntent: 'B1',
};
const pickVague       = { ...choiceA, secondary: null };
const pickWrong       = {
  interviewerId: 'p3',
  defect: { type: 'wrong', axis: 'failure', note: '틀렸다' },
  reactionIntent: 'B6',
  secondary: null,
};
const pickUnknown       = {
  interviewerId: 'p3',
  defect: { type: 'vague', axis: 'failure', note: '모른다' },
  reactionIntent: 'B11',
  secondary: null,
};
const pickWithSecondary       = { ...choiceA, secondary: choiceB };

describe('composePanel', () => {
  it('패널은 직무형·교과형·시나리오형이고 성향 셋이 한 번씩 나온다', () => {
    const panel = composePanel('security', () => 0.42);
    expect(panel.map((m) => [m.id, m.role])).toEqual([
      ['p1', 'security'],
      ['p2', 'textbook'],
      ['p3', 'scenario'],
    ]);
    expect(panel.map((m) => m.temperament).sort()).toEqual(['helper', 'persistent', 'shaker']);
  });
  it('rng가 다르면 성향 배정이 달라진다', () => {
    const a = composePanel('dba', () => 0).map((m) => m.temperament);
    const b = composePanel('dba', () => 0.99).map((m) => m.temperament);
    expect(a).not.toEqual(b);
  });
});

describe('pickOpener', () => {
  it('rng로 패널에서 한 명을 고른다', () => {
    const panel = composePanel('architect', () => 0);
    expect(pickOpener(panel, () => 0).id).toBe('p1');
    expect(pickOpener(panel, () => 0.99).id).toBe('p3');
  });
});

describe('chooseTargetAxis', () => {
  it('첫 질문에는 축을 지정하지 않는다', () => {
    expect(chooseTargetAxis({ nextSeq: 1, questionLimit: 6, assumptionAxes: [] })).toBeNull();
  });
  it('절반을 넘도록 가정 변경이 없으면 정체성 비교 축을 지정한다', () => {
    expect(
      chooseTargetAxis({ nextSeq: 3, questionLimit: 6, assumptionAxes: ['none', 'none'] }),
    ).toBeNull();
    expect(
      chooseTargetAxis({
        nextSeq: 4,
        questionLimit: 6,
        assumptionAxes: ['none', 'none', 'none'],
      }),
    ).toBe('identity_swap');
  });
  it('가정 변경이 이미 있었으면 지정하지 않는다', () => {
    expect(
      chooseTargetAxis({
        nextSeq: 5,
        questionLimit: 6,
        assumptionAxes: ['none', 'scale', 'none', 'none'],
      }),
    ).toBeNull();
  });
  it('질문 수 상한이 2면 둘째 질문에 지정한다', () => {
    expect(chooseTargetAxis({ nextSeq: 2, questionLimit: 2, assumptionAxes: ['none'] })).toBe(
      'identity_swap',
    );
  });
});

describe('nextAsker', () => {
  it('덧붙이기가 기다리고 있으면 그것을 쓰고, 그것을 낳은 턴을 원인으로 적는다', () => {
    const r = nextAsker({
      lastTurnId: 't2',
      pick: pickVague,
      pending: { choice: choiceB, causeTurnId: 't1' },
    });
    expect(r).toEqual({ choice: choiceB, addOn: true, causeTurnId: 't1', pending: null });
  });
  it('기다리는 덧붙이기가 있어도 방금 답이 오답 의심이면 그 답에 반응하고 덧붙이기를 버린다', () => {
    const r = nextAsker({
      lastTurnId: 't2',
      pick: pickWrong,
      pending: { choice: choiceB, causeTurnId: 't1' },
    });
    expect(r.addOn).toBe(false);
    expect(r.causeTurnId).toBe('t2');
    expect(r.choice.interviewerId).toBe(pickWrong.interviewerId);
    expect(r.pending).toBeNull();
  });
  it('기다리는 덧붙이기가 있어도 방금 답이 모른다는 답(B11)이면 그 답에 반응한다', () => {
    const r = nextAsker({
      lastTurnId: 't2',
      pick: pickUnknown,
      pending: { choice: choiceB, causeTurnId: 't1' },
    });
    expect(r.addOn).toBe(false);
    expect(r.causeTurnId).toBe('t2');
    expect(r.choice.reactionIntent).toBe('B11');
  });
  it('pick에 secondary가 있으면 primary를 쓰고 secondary를 대기시킨다', () => {
    const r = nextAsker({ lastTurnId: 't1', pick: pickWithSecondary, pending: null });
    expect(r.addOn).toBe(false);
    expect(r.choice).toEqual(choiceA);
    expect(r.choice).not.toHaveProperty('secondary');
    expect(r.pending).toEqual({ choice: choiceB, causeTurnId: 't1' });
  });
});

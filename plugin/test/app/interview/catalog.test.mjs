// 생성된 파일이다. 손으로 고치지 않는다. 원본: src/interview/catalog.spec.ts @ aeae0dd, 도구: tools/port-app-src.mjs
import { describe, it, expect, jest } from '../../jest-shim.mjs';
import { AXES, SHARED_AXES, OWNABLE_AXES, ROLES, DEFECT_PRIORITY, QUESTION_INTENTS, REACTION_INTENTS, INTENT_GROUPS } from '../../../skills/pressure-interview/scripts/lib/app/interview/catalog.mjs';

describe('catalog', () => {
  it('역할의 축은 모두 소유 가능한 축이다', () => {
    for (const role of Object.values(ROLES))
      for (const axis of role.axes) expect(OWNABLE_AXES).toContain(axis);
    expect(SHARED_AXES).toEqual(['identity_swap']);
    expect(OWNABLE_AXES).toHaveLength(AXES.length - 1);
  });
  it('결함 우선순위는 설계 6.2 순서', () => {
    const p = DEFECT_PRIORITY;
    expect(p.wrong).toBeGreaterThan(p.missing_axis);
    expect(p.missing_axis).toBeGreaterThan(p.no_why);
    expect(p.no_why).toBe(p.no_tradeoff);
    expect(p.no_tradeoff).toBeGreaterThan(p.vague);
    expect(p.vague).toBe(p.no_evidence);
    expect(p.no_evidence).toBeGreaterThan(p.none);
  });
  it('의도 묶음은 A1–A15, B1–B11을 한 번씩 덮는다', () => {
    expect(Object.values(INTENT_GROUPS.question).flat().sort()).toEqual(
      Object.keys(QUESTION_INTENTS).sort(),
    );
    expect(Object.values(INTENT_GROUPS.reaction).flat().sort()).toEqual(
      Object.keys(REACTION_INTENTS).sort(),
    );
    expect(Object.keys(QUESTION_INTENTS)).toHaveLength(15);
    expect(Object.keys(REACTION_INTENTS)).toHaveLength(11);
  });
});

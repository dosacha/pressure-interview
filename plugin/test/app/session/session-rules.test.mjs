// 서버판 src/session/session-rules.spec.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { describe, it, expect, jest } from '../../jest-shim.mjs';
                                                           
import { composePanel } from '../../../skills/pressure-interview/scripts/lib/app/session/session-rules.mjs';

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

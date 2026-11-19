// 서버판 src/interview/rules.spec.ts @ aeae0dd에서 옮겨 와 스킬이 고쳐 쓴다.
import { describe, it, expect, jest } from '../../jest-shim.mjs';
import { pickNext } from '../../../skills/pressure-interview/scripts/lib/app/interview/rules.mjs';


const panel                = [
  { id: 'p1', role: 'dba', temperament: 'shaker' },
  { id: 'p2', role: 'textbook', temperament: 'persistent' },
  { id: 'p3', role: 'scenario', temperament: 'helper' },
];
const d = (type                , axis                )         => ({ type, axis, note: '' });
const run = (defects          , history           = []) =>
  pickNext({ defects, panel, history, maxConsecutive: 2 });

describe('pickNext', () => {
  it('우선순위가 가장 높은 결함의 담당이 질문한다', () => {
    const r = run([d('vague', 'scale'), d('wrong', 'durability')]);
    expect([r.interviewerId, r.defect.type, r.reactionIntent]).toEqual(['p1', 'wrong', 'B9']);
  });
  it('결함 없음이면 성향대로 상향 심화나 확신 시험', () => {
    expect(run([d('none', 'resource_limit')]).reactionIntent).toBe('B1');
    expect(run([d('none', 'durability')]).reactionIntent).toBe('B8');
  });
  it('연속 상한에 걸린 면접관은 건너뛴다', () => {
    expect(run([d('wrong', 'durability')], ['p1', 'p1']).interviewerId).not.toBe('p1');
  });
  it('담당이 없는 축이면 가장 오래전에 질문한 면접관', () => {
    expect(run([d('vague', 'cost')], ['p2', 'p3', 'p1']).interviewerId).toBe('p2');
  });
  it('직전 질문자라는 이유로 이어받지 않는다', () => {
    expect(run([d('vague', 'scale')], ['p1']).interviewerId).toBe('p3');
  });
  it('공동 담당 축은 오래전에 질문한 쪽', () => {
    expect(run([d('vague', 'distribution')], ['p3']).interviewerId).toBe('p1');
  });
  it('높은 결함 두 개의 담당이 다르면 덧붙이기, 아니면 null', () => {
    expect(
      run([d('wrong', 'durability'), d('missing_axis', 'scale')]).secondary?.interviewerId,
    ).toBe('p3');
    expect(run([d('wrong', 'durability'), d('vague', 'scale')]).secondary).toBeNull();
  });
  it('한 번만 질문한 담당은 계속 질문할 수 있다', () => {
    expect(run([d('wrong', 'durability')], ['p1']).interviewerId).toBe('p1');
  });
  it('가장 오래전은 마지막으로 질문한 시점 기준이다', () => {
    expect(run([d('vague', 'cost')], ['p1', 'p2', 'p1', 'p3']).interviewerId).toBe('p2');
  });
  it('두 결함의 축을 같은 사람이 맡으면 덧붙이지 않는다', () => {
    expect(run([d('wrong', 'durability'), d('missing_axis', 'consistency')]).secondary).toBeNull();
  });
  it('두 번째 결함의 축을 맡은 사람이 패널에 없으면 덧붙이지 않는다', () => {
    expect(run([d('wrong', 'durability'), d('missing_axis', 'cost')]).secondary).toBeNull();
  });
  it('덧붙이는 사람의 결함과 반응 의도', () => {
    expect(run([d('wrong', 'durability'), d('missing_axis', 'scale')]).secondary).toEqual({
      interviewerId: 'p3',
      defect: { type: 'missing_axis', axis: 'scale', note: '' },
      reactionIntent: 'B4',
    });
  });
});

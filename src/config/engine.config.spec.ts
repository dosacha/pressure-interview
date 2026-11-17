import { readEngineConfig } from './engine.config';

describe('readEngineConfig', () => {
  it('기본값은 모든 호출 claude-opus-5-5와 설계 노력 수준', () => {
    const c = readEngineConfig({});
    expect(Object.values(c.models)).toEqual(Array(5).fill('claude-opus-5-5'));
    expect(c.effort).toEqual({
      analyze: 'medium',
      question: 'medium',
      verify: 'medium',
      leak: 'low',
      review: 'high',
    });
    expect([c.maxConsecutive, c.maxRegenerations]).toEqual([2, 1]);
  });
  it('review 역할의 기본값은 claude-opus-5-5, high', () => {
    const c = readEngineConfig({});
    expect(c.models.review).toBe('claude-opus-5-5');
    expect(c.effort.review).toBe('high');
  });
  it('question과 verify의 기본 effort는 medium이다', () => {
    const c = readEngineConfig({});
    expect([c.effort.question, c.effort.verify]).toEqual(['medium', 'medium']);
  });
  it('환경 변수로 호출별 값을 바꾼다', () => {
    const c = readEngineConfig({
      ENGINE_MODEL_LEAK: 'claude-haiku-5-5',
      ENGINE_EFFORT_QUESTION: 'xhigh',
    });
    expect(c.models.leak).toBe('claude-haiku-5-5');
    expect(c.effort.question).toBe('xhigh');
  });
  it('잘못된 값은 키 이름과 함께 실패한다', () => {
    expect(() => readEngineConfig({ ENGINE_EFFORT_VERIFY: 'huge' })).toThrow(
      'ENGINE_EFFORT_VERIFY',
    );
    expect(() => readEngineConfig({ ENGINE_MAX_CONSECUTIVE: '0' })).toThrow(
      'ENGINE_MAX_CONSECUTIVE',
    );
  });
  it('빈 문자열 값은 설정 안 함으로 보고 기본값을 쓴다', () => {
    const c = readEngineConfig({ ENGINE_MODEL_LEAK: '', ENGINE_MAX_CONSECUTIVE: '' });
    expect(c.models.leak).toBe('claude-opus-5-5');
    expect(c.maxConsecutive).toBe(2);
  });
});

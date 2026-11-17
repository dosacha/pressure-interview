import { ClarifyInput } from '../types';
import { CLARIFY_SCHEMA, answerClarification, buildClarifyPrompt } from './clarify.call';
import { REQUIRED_RULES } from './question.call';

const input: ClarifyInput & { feedback: string[] } = {
  topic: 'Redis',
  interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
  question: {
    text: '쓰기가 읽기보다 훨씬 많아지면 지금 구성에서 무엇이 먼저 무너질까요?',
    questionIntent: 'A3',
    assumption: { axis: 'distribution', statement: '쓰기 요청이 읽기 요청보다 훨씬 많아진다.' },
    answerKey: {
      vanishing: ['읽기 캐시 이점'],
      remaining: ['단일 스레드 처리'],
      alternatives: [{ name: 'Cassandra', traits: 'LSM 트리로 쓰기에 강하다' }],
      keyPoints: ['AOF fsync 비용이 커진다', '복제 지연이 늘어난다'],
    },
  },
  questionTechs: [],
  exchanges: [
    { ask: '첫째 되묻기입니다', reply: '첫째 답입니다' },
    { ask: '둘째 되묻기입니다', reply: '둘째 답입니다' },
  ],
  ask: '읽기 위주인가요?',
  userMentioned: ['Redis'],
  avoidTechs: [],
  feedback: [],
};

describe('clarify.call', () => {
  it('정답지와 질문 의도를 프롬프트에 싣지 않는다', () => {
    const { system, user } = buildClarifyPrompt(input);
    for (const hidden of [
      ...input.question.answerKey.keyPoints,
      input.question.answerKey.alternatives[0].name,
    ]) {
      expect(system + user).not.toContain(hidden);
    }
    expect(user).not.toContain(`${input.question.questionIntent} `);
    expect(user).toContain(input.question.text);
    expect(user).toContain(input.ask);
  });
  it('기술 이름 규칙 문장을 그대로 싣는다', () => {
    const { system } = buildClarifyPrompt(input);
    for (const line of REQUIRED_RULES.split('\n')) expect(system).toContain(line);
  });
  it('앞선 되묻기를 순서대로 싣는다', () => {
    const { user } = buildClarifyPrompt(input);
    const order = ['첫째 되묻기입니다', '첫째 답입니다', '둘째 되묻기입니다', '둘째 답입니다'];
    const at = order.map((s) => user.indexOf(s));
    expect(at.every((i) => i > -1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(user.indexOf('둘째 답입니다')).toBeLessThan(user.indexOf(input.ask));
  });
  it('question 역할과 스키마로 호출한다', async () => {
    const callJson = jest.fn().mockResolvedValue({
      data: { reply: 'r' },
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'm',
    });
    await answerClarification({ callJson }, input);
    expect(callJson).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'question', schema: CLARIFY_SCHEMA }),
    );
  });
});

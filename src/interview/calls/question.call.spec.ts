import { AXES, QUESTION_INTENTS, REACTION_INTENTS } from '../catalog';
import { QuestionInput } from '../types';
import {
  REQUIRED_RULES,
  QUESTION_SCHEMA,
  buildQuestionPrompt,
  generateQuestion,
} from './question.call';

const input: QuestionInput = {
  topic: 'Redis',
  interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
  reactionIntent: 'B9',
  defect: { type: 'wrong', axis: 'durability', note: 'AOF 설명 오류' },
  targetAxis: 'identity_swap',
  history: [{ interviewerId: 'p2', text: 'Q', answer: 'A' }],
  userMentioned: ['Redis'],
  feedback: ['Kafka를 꺼내지 마라'],
};
type Props = {
  questionIntent: { enum: string[] };
  assumption: { properties: { axis: { enum: string[] } } };
};

describe('question.call', () => {
  it('스키마 enum은 카탈로그와 같다', () => {
    const p = QUESTION_SCHEMA.properties as unknown as Props;
    expect(p.questionIntent.enum).toEqual(Object.keys(QUESTION_INTENTS));
    expect(p.assumption.properties.axis.enum).toEqual([...AXES.map((a) => a.id), 'none']);
    expect(QUESTION_SCHEMA.additionalProperties).toBe(false);
  });
  it('시스템 프롬프트에 규칙 문장이 그대로 있다', () => {
    expect(buildQuestionPrompt(input).system).toContain(REQUIRED_RULES);
    expect(REQUIRED_RULES).toContain('O: "사용하신 기술 말고 다른 대안은 없었을까요?"');
  });
  it('user 프롬프트에 입력이 들어간다', () => {
    const { user } = buildQuestionPrompt(input);
    for (const s of [
      'Redis',
      'DBA',
      '흔드는형',
      'B9',
      'AOF 설명 오류',
      '정체성 비교',
      'Kafka를 꺼내지 마라',
    ])
      expect(user).toContain(s);
  });
  it('question 역할과 스키마로 호출한다', async () => {
    const callJson = jest
      .fn()
      .mockResolvedValue({ data: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: 'm' });
    await generateQuestion({ callJson }, input);
    expect(callJson).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'question', schema: QUESTION_SCHEMA }),
    );
  });
  it('시스템 프롬프트에 의도 id와 축 이름이 모두 있다', () => {
    const { system } = buildQuestionPrompt(input);
    for (const [id, name] of Object.entries(QUESTION_INTENTS))
      expect(system).toContain(`${id} ${name}:`);
    for (const [id, name] of Object.entries(REACTION_INTENTS))
      expect(system).toContain(`${id} ${name}:`);
    for (const a of AXES) expect(system).toContain(a.name);
    const systemLines = system.split('\n');
    for (const a of AXES) expect(systemLines).toContain(`- ${a.id} ${a.name}`);
    expect(systemLines).toContain('- none 가정을 바꾸지 않는 질문');
  });
  it('축이 지정된 첫 질문에는 기본 질문 안내가 없다', () => {
    const first = { ...input, reactionIntent: null, defect: null, history: [], feedback: [] };
    const basic = '기본 질문으로 시작해도 된다';
    expect(buildQuestionPrompt({ ...first, targetAxis: null }).user).toContain(basic);
    const { user } = buildQuestionPrompt(first);
    expect(user).toContain('첫 질문');
    expect(user).not.toContain(basic);
  });
});

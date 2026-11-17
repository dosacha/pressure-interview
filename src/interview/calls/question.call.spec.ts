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
  it('한 질문에서 묻는 것은 하나, 많아야 둘이라고 말한다', () => {
    const { system } = buildQuestionPrompt(input);
    expect(system).toContain(
      '한 질문에서 묻는 것은 하나다. 꼭 이어서 물어야 할 때만 둘까지 묻고, 셋 이상은 묻지 않는다.',
    );
    expect(system).toContain('더 묻고 싶은 것은 다음 질문으로 남긴다.');
    expect(system).not.toContain('질문은 한 번에 하나만 한다');
  });
  it('질문 의도를 말하지 않는다는 줄은 그대로 있다', () => {
    expect(REQUIRED_RULES).toContain('- 질문 의도는 말하지 않는다.');
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
  it('기억의 세 목록을 축 이름과 함께 싣고, 빈 목록의 줄은 넣지 않는다', () => {
    const { user } = buildQuestionPrompt({
      ...input,
      memory: {
        retired: [{ axis: 'durability', statement: '쓰기가 재시작 뒤에도 남아야 한다' }],
        reissue: [],
        expected: [],
      },
    });
    expect(user).toContain('다시 내지 않는 가정');
    expect(user).toContain('durability 영속성·전달 보장: 쓰기가 재시작 뒤에도 남아야 한다');
    expect(user).not.toContain('다시 낼 수 있는 가정');
  });
  it('다시 낼 가정과 예상했던 가정에는 쓰는 법이 붙는다', () => {
    const { user } = buildQuestionPrompt({
      ...input,
      memory: {
        retired: [],
        reissue: [{ axis: 'durability', statement: 'r' }],
        expected: [{ axis: 'durability', statement: 'e' }],
      },
    });
    expect(user).toContain(
      '- 다시 낼 수 있는 가정(흔들렸거나 틀렸다): durability 영속성·전달 보장: r',
    );
    expect(user).toContain('이어지지 않으면 쓰지 않는다.');
    expect(user).toContain('- 지원자가 예상했던 가정: durability 영속성·전달 보장: e');
    expect(user).toContain('새 가정을 고를 때 피한다.');
    expect(user).not.toContain('다시 내지 않는 가정');
  });
  it('기억이 없거나 모두 비면 기억 절이 없다', () => {
    expect(buildQuestionPrompt(input).user).not.toContain('기억(');
    const empty = { retired: [], reissue: [], expected: [] };
    expect(buildQuestionPrompt({ ...input, memory: empty }).user).not.toContain('기억(');
  });
  it('모른다고 한 기술 줄과 덧붙이는 질문 줄을 넣는다', () => {
    const { user } = buildQuestionPrompt({
      ...input,
      avoidTechs: ['Memcached', 'Lua'],
      addOn: true,
      memory: { retired: [{ axis: 'durability', statement: 's' }], reissue: [], expected: [] },
    });
    const avoid =
      '지원자가 모른다고 한 기술(질문에 다시 넣지 않는다. 전제로도 쓰지 않는다): Memcached, Lua';
    const addOn =
      '- 덧붙이는 질문이다. 다른 면접관이 먼저 물었고 지원자가 거기에 답한 뒤에, "저도 하나 덧붙이면"처럼 시작해 얹는다. 이 질문이 반응하는 답변은 바로 앞 답변이 아니라 그 앞의 답변(대화 목록의 끝에서 두 번째)이다.';
    expect(user).toContain(avoid);
    expect(user).toContain(`이번 질문:
${addOn}
`);
    const order = [
      '지원자가 지금까지 말한 기술',
      avoid,
      '기억(이전 면접들에서 만난 가정):',
      '이번 질문:',
      addOn,
      '- 반응 의도',
      '- 그 앞의 답변의 결함',
    ].map((s) => user.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(user).toContain('그 앞의 답변에 이 의도로 반응한다');
    expect(user).toContain('그 앞의 답변의 결함');
    expect(user).not.toContain('직전 답변에 이 의도로 반응한다');
    expect(user).not.toContain('직전 답변의 결함');
    const plain = buildQuestionPrompt(input).user;
    expect(plain).not.toContain('모른다고 한 기술');
    expect(plain).not.toContain('덧붙이는 질문');
    for (const u of [plain, buildQuestionPrompt({ ...input, addOn: false }).user]) {
      expect(u).toContain('직전 답변에 이 의도로 반응한다');
      expect(u).toContain('직전 답변의 결함');
      expect(u).not.toContain('그 앞의 답변');
    }
  });
  it('시스템 프롬프트가 덧붙이는 질문의 직전 답변을 그 앞의 답변으로 읽게 한다', () => {
    expect(buildQuestionPrompt(input).system).toContain(
      'user 메시지가 덧붙이는 질문이라고 하면, 이 프롬프트에서 직전 답변이라고 한 곳은 모두 user 메시지가 가리키는 그 앞의 답변을 뜻한다.',
    );
  });
  it('지원자가 말한 기술이 비어도 모른다고 한 기술 줄과 기억 절은 들어간다', () => {
    const { user } = buildQuestionPrompt({
      ...input,
      userMentioned: [],
      avoidTechs: ['Memcached'],
      memory: { retired: [{ axis: 'durability', statement: 's' }], reissue: [], expected: [] },
    });
    expect(user).not.toContain('지원자가 지금까지 말한 기술');
    expect(user).toContain('지원자가 모른다고 한 기술');
    expect(user).toContain('기억(이전 면접들에서 만난 가정):');
  });
});

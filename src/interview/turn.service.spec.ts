import { Test } from '@nestjs/testing';
import { engineConfig, readEngineConfig } from '../config/engine.config';
import { LlmService } from './llm/llm.service';
import { TurnService } from './turn.service';
import { AnswerKey, PanelMember, Question, QuestionInput } from './types';

// 호출 역할별 응답 큐를 차례로 돌려주는 가짜 LlmService
function fakeLlm(queues: Record<string, unknown[]>) {
  const calls: { role: string; user: string }[] = [];
  const callJson = (req: { role: string; user: string }) => {
    calls.push(req);
    return Promise.resolve({
      data: queues[req.role].shift(),
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'm',
    });
  };
  return { calls, llm: { callJson } };
}
async function service(queues: Record<string, unknown[]>) {
  const fake = fakeLlm(queues);
  const mod = await Test.createTestingModule({
    providers: [
      TurnService,
      { provide: LlmService, useValue: fake.llm },
      { provide: engineConfig.KEY, useValue: readEngineConfig({}) },
    ],
  }).compile();
  return { turn: mod.get(TurnService), calls: fake.calls };
}
const key = (keyPoints: string[] = ['k']): AnswerKey => ({
  vanishing: [],
  remaining: [],
  alternatives: [],
  keyPoints,
});
const q = (axis: Question['assumption']['axis'], text = 'Q'): Question => ({
  text,
  questionIntent: 'A1',
  assumption: { axis, statement: 's' },
  answerKey: key(),
});
const base: QuestionInput = {
  topic: 'Redis',
  interviewer: { id: 'p1', role: 'dba', temperament: 'shaker' },
  reactionIntent: null,
  defect: null,
  targetAxis: null,
  history: [],
  userMentioned: ['Redis'],
  feedback: [],
};
const panel: PanelMember[] = [
  { id: 'p1', role: 'dba', temperament: 'shaker' },
  { id: 'p2', role: 'textbook', temperament: 'persistent' },
];

describe('TurnService.prepareQuestion', () => {
  it('이름 위반이면 피드백을 붙여 한 번 다시 만든다', async () => {
    const { turn, calls } = await service({
      question: [q('none', 'Kafka는요?'), q('none', '다른 대안은요?')],
      leak: [{ techs: [{ name: 'Kafka', role: 'solution' }] }, { techs: [] }],
    });
    const r = await turn.prepareQuestion(base);
    expect(r.question.text).toBe('다른 대안은요?');
    expect(calls[2].user).toContain('Kafka');
    expect(r.flags.leak).toBe(false);
  });
  it('이름 위반이 끝까지 남으면 flags.leak이고, 걸린 시도는 검증하지 않는다', async () => {
    const leaked = { techs: [{ name: 'Kafka', role: 'solution' }] };
    const { turn, calls } = await service({
      question: [q('identity_swap', 'Kafka는요?'), q('identity_swap', 'Kafka는요?')],
      leak: [leaked, leaked],
    });
    const r = await turn.prepareQuestion(base);
    expect(r.flags.leak).toBe(true);
    expect(r.verification).toBeNull();
    expect(calls.map((c) => c.role)).toEqual(['question', 'leak', 'question', 'leak']);
    expect(r.attempts).toHaveLength(2);
  });
  it('가정 변경 질문은 보여 주기 전에 검증하고, 고친 정답지를 쓴다', async () => {
    const fixed = key(['고침']);
    const { turn, calls } = await service({
      question: [q('identity_swap')],
      leak: [{ techs: [] }],
      verify: [
        { premiseOk: true, problems: [{ field: 'keyPoints', problem: '틀림' }], answerKey: fixed },
      ],
    });
    const r = await turn.prepareQuestion(base);
    expect(calls.map((c) => c.role)).toEqual(['question', 'leak', 'verify']);
    expect(r.question.answerKey).toEqual(fixed);
    expect(r.answerKeyCorrected).toBe(true);
  });
  it('가정 없는 질문은 미리 검증하지 않는다', async () => {
    const { turn } = await service({ question: [q('none')], leak: [{ techs: [] }] });
    expect((await turn.prepareQuestion(base)).verification).toBeNull();
  });
  it('전제가 틀리면 다시 만들고, 끝까지 틀리면 flags.premise', async () => {
    const bad = {
      premiseOk: false,
      problems: [{ field: 'text', problem: '전제 오류' }],
      answerKey: key(),
    };
    const { turn, calls } = await service({
      question: [q('identity_swap'), q('identity_swap')],
      leak: [{ techs: [] }, { techs: [] }],
      verify: [bad, bad],
    });
    const r = await turn.prepareQuestion(base);
    expect(calls[3].user).toContain('전제 오류');
    expect(r.flags.premise).toBe(true);
  });
});

describe('TurnService.handleAnswer', () => {
  it('되묻기면 질문자를 바꾸지 않고 언급 기술은 합친다', async () => {
    const { turn } = await service({
      analyze: [{ kind: 'clarify', defects: [], mentionedTechs: ['Redis', 'Lua'] }],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p1'],
      askedBy: 'p1',
      question: q('durability'),
      answer: '영속성 관점에서 여쭤보시는 건가요?',
      userMentioned: ['Redis'],
    });
    expect(r.pick).toBeNull();
    expect(r.userMentioned).toEqual(['Redis', 'Lua']);
  });
  it('결함이 비면 질문 축(공유 축이면 질문자의 첫 축)의 결함 없음으로 본다', async () => {
    const { turn } = await service({
      analyze: [{ kind: 'answer', defects: [], mentionedTechs: [] }],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p2'],
      askedBy: 'p2',
      question: q('identity_swap'),
      answer: '...',
      userMentioned: [],
    });
    expect(r.pick?.defect).toEqual({ type: 'none', axis: 'resource_limit', note: '' });
  });
  it('결함이 있으면 규칙이 고른 면접관과 반응 의도를 돌려준다', async () => {
    const { turn } = await service({
      analyze: [
        {
          kind: 'answer',
          defects: [{ type: 'wrong', axis: 'durability', note: 'n' }],
          mentionedTechs: [],
        },
      ],
    });
    const r = await turn.handleAnswer({
      topic: 'Redis',
      panel,
      history: ['p2'],
      askedBy: 'p2',
      question: q('durability'),
      answer: '...',
      userMentioned: [],
    });
    expect(r.pick?.interviewerId).toBe('p1');
    expect(r.pick?.reactionIntent).toBe('B9');
  });
});

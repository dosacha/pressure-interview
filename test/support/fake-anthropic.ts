export type CallKind =
  | 'question'
  | 'analyze'
  | 'leak'
  | 'verify'
  | 'premise'
  | 'answerKey'
  | 'clarify'
  | 'jobRole'
  | 'review';
export type FakeReply =
  object | Error | ((params: Record<string, unknown>) => object | Promise<object>);

const RAW = Symbol('rawText');

/** JSON으로 감싸지 않고 이 글자를 그대로 text 블록에 싣게 하는 표시. */
export function rawText(text: string): object {
  return { [RAW]: text };
}

export interface FakeAnthropic {
  client: {
    beta: { messages: { create: (params: Record<string, unknown>) => Promise<object> } };
  };
  calls: { kind: CallKind; params: Record<string, unknown> }[];
  /** 이 종류의 호출에 앞으로 이 응답을 준다. */
  on(kind: CallKind, reply: FakeReply): void;
  /** 다음 한 번만 이 응답을 준다. on보다 먼저 쓰인다. */
  once(kind: CallKind, reply: FakeReply): void;
}

// 요청 스키마의 required에 든 키로 호출 종류를 알아낸다. 검증의 required에도 premiseOk가 있으므로
// corrections를 premiseOk보다 먼저 본다.
const KIND_BY_REQUIRED_KEY: [string, CallKind][] = [
  ['questionIntent', 'question'],
  ['kind', 'analyze'],
  ['techs', 'leak'],
  ['corrections', 'verify'],
  ['premiseOk', 'premise'],
  ['keyPoints', 'answerKey'],
  ['reply', 'clarify'],
  ['role', 'jobRole'],
  ['intent', 'review'],
];

const DEFAULT_REPLIES: Record<CallKind, object> = {
  question: {
    text: '기본 질문입니다.',
    questionIntent: 'A1',
    assumption: { axis: 'none', statement: '' },
  },
  analyze: { kind: 'answer', defects: [], mentionedTechs: [], unknownTechs: [] },
  leak: { techs: [] },
  verify: {
    premiseOk: true,
    problems: [],
    corrections: { lists: [], alternatives: { changed: false, items: [] } },
  },
  premise: { premiseOk: true, problems: [] },
  answerKey: { vanishing: [], remaining: [], alternatives: [], keyPoints: ['k1'] },
  clarify: { reply: '범위는 한 대의 서버입니다.' },
  jobRole: { role: 'dba' },
  review: {
    intent: { aimed: true, note: '' },
    defects: [],
    reactions: [],
    assumption: { result: 'none', note: '', sameAs: null },
    keyProblems: [],
  },
};

function detectKind(params: Record<string, unknown>): CallKind {
  const output = params.output_config as
    { format?: { schema?: { required?: unknown } } } | undefined;
  const required = output?.format?.schema?.required;
  const keys = Array.isArray(required) ? required : [];
  const found = KIND_BY_REQUIRED_KEY.find(([key]) => keys.includes(key));
  if (!found) throw new Error('호출 종류를 알아내지 못했다: output_config.format.schema.required');
  return found[1];
}

export function createFakeAnthropic(): FakeAnthropic {
  const calls: FakeAnthropic['calls'] = [];
  const onceReplies = new Map<CallKind, FakeReply[]>();
  const onReplies = new Map<CallKind, FakeReply>();

  async function create(params: Record<string, unknown>): Promise<object> {
    const kind = detectKind(params);
    calls.push({ kind, params });
    const reply = onceReplies.get(kind)?.shift() ?? onReplies.get(kind) ?? DEFAULT_REPLIES[kind];
    if (reply instanceof Error) throw reply;
    const body: object =
      typeof reply === 'function'
        ? await (reply as (p: Record<string, unknown>) => Promise<object>)(params)
        : reply;
    const raw = (body as { [RAW]?: string })[RAW];
    const text = raw ?? JSON.stringify(body);
    return {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 5, iterations: null },
      model: 'fake-model',
    };
  }

  return {
    client: { beta: { messages: { create } } },
    calls,
    on: (kind, reply) => void onReplies.set(kind, reply),
    once: (kind, reply) => void onceReplies.set(kind, [...(onceReplies.get(kind) ?? []), reply]),
  };
}

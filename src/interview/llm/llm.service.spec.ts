import { Test } from '@nestjs/testing';
import { engineConfig, readEngineConfig } from '../../config/engine.config';
import { ANTHROPIC_CLIENT } from './anthropic.provider';
import { LlmService, RefusalError, usageRows } from './llm.service';
import { UsageRecorder } from './usage-recorder';

const ok = {
  stop_reason: 'end_turn',
  model: 'claude-opus-5-5',
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: '{"a":1}' },
  ],
};
async function make(response: object, env: NodeJS.ProcessEnv = {}) {
  const create = jest.fn<Promise<object>, [object]>().mockResolvedValue(response);
  const mod = await Test.createTestingModule({
    providers: [
      LlmService,
      UsageRecorder,
      { provide: ANTHROPIC_CLIENT, useValue: { beta: { messages: { create } } } },
      { provide: engineConfig.KEY, useValue: readEngineConfig(env) },
    ],
  }).compile();
  return { llm: mod.get(LlmService), create, recorder: mod.get(UsageRecorder) };
}
const call = (llm: LlmService) =>
  llm.callJson({ role: 'question', system: 'S', user: 'U', schema: { type: 'object' } });

describe('LlmService', () => {
  it('호출별 모델·노력, 폴백, 스키마를 요청에 싣고 사용량만 돌려준다', async () => {
    const { llm, create } = await make(ok);
    const out = await call(llm);
    expect(out).toEqual({
      data: { a: 1 },
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'claude-opus-5-5',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: 'S',
        messages: [{ role: 'user', content: 'U' }],
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: { type: 'object' } },
        },
      }),
    );
    expect(create.mock.calls[0][0]).not.toHaveProperty('thinking');
  });
  it('모델과 effort는 부른 역할의 설정에서 온다', async () => {
    const { llm, create } = await make(ok, {
      ENGINE_MODEL_ANALYZE: 'm-analyze',
      ENGINE_MODEL_QUESTION: 'm-question',
      ENGINE_MODEL_VERIFY: 'm-verify',
      ENGINE_MODEL_LEAK: 'm-leak',
      ENGINE_EFFORT_ANALYZE: 'low',
      ENGINE_EFFORT_QUESTION: 'medium',
      ENGINE_EFFORT_VERIFY: 'high',
      ENGINE_EFFORT_LEAK: 'max',
    });
    await llm.callJson({ role: 'leak', system: 'S', user: 'U', schema: {} });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'm-leak',
      output_config: { effort: 'max' },
    });
  });
  it('거절은 RefusalError', async () => {
    const { llm } = await make({
      ...ok,
      stop_reason: 'refusal',
      stop_details: { category: 'cyber' },
      content: [],
    });
    await expect(call(llm)).rejects.toBeInstanceOf(RefusalError);
  });
  it('max_tokens로 잘리면 오류', async () => {
    const { llm } = await make({ ...ok, stop_reason: 'max_tokens' });
    await expect(call(llm)).rejects.toThrow('max_tokens');
  });
  it('text 블록이 없으면 오류', async () => {
    const { llm } = await make({ ...ok, content: [{ type: 'thinking', thinking: '' }] });
    await expect(call(llm)).rejects.toThrow('text 블록');
  });
  it('거절로 끝난 호출도 기록한 뒤에 RefusalError를 던진다', async () => {
    const { llm, recorder } = await make({
      ...ok,
      stop_reason: 'refusal',
      stop_details: { category: 'cyber' },
      content: [],
    });
    const record = jest.spyOn(recorder, 'record');
    await expect(call(llm)).rejects.toBeInstanceOf(RefusalError);
    expect(record).toHaveBeenCalledWith([
      {
        role: 'question',
        model: 'claude-opus-5-5',
        input_tokens: 10,
        output_tokens: 5,
        fallback: false,
      },
    ]);
  });
  it('성공한 호출은 사용량을 한 번 기록하고 반환 모양은 그대로다', async () => {
    const { llm, recorder } = await make(ok);
    const record = jest.spyOn(recorder, 'record');
    const out = await call(llm);
    expect(record).toHaveBeenCalledTimes(1);
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });
});

describe('usageRows', () => {
  it('iterations가 없으면 최상위 usage 한 줄', () => {
    expect(
      usageRows('analyze', {
        model: 'm',
        usage: { input_tokens: 3, output_tokens: 2, iterations: null },
      }),
    ).toEqual([{ role: 'analyze', model: 'm', input_tokens: 3, output_tokens: 2, fallback: false }]);
  });
  it('거절된 시도와 폴백 응답을 각각 한 줄로 센다', () => {
    const rows = usageRows('question', {
      model: 'b',
      usage: {
        input_tokens: 9,
        output_tokens: 9,
        iterations: [
          { type: 'message', model: 'a', input_tokens: 5, output_tokens: 1 },
          { type: 'fallback_message', model: 'b', input_tokens: 5, output_tokens: 4 },
        ],
      },
    });
    expect(rows.map((r) => [r.model, r.input_tokens, r.output_tokens, r.fallback])).toEqual([
      ['a', 5, 1, false],
      ['b', 5, 4, true],
    ]);
  });
  it('항목의 model이 null이면 응답의 model을 쓴다', () => {
    const rows = usageRows('question', {
      model: 'b',
      usage: {
        input_tokens: 9,
        output_tokens: 9,
        iterations: [{ type: 'message', model: null, input_tokens: 5, output_tokens: 1 }],
      },
    });
    expect(rows.map((r) => r.model)).toEqual(['b']);
  });
  it('iterations에 message도 fallback_message도 없으면 최상위 usage 한 줄', () => {
    const rows = usageRows('question', {
      model: 'b',
      usage: {
        input_tokens: 9,
        output_tokens: 8,
        iterations: [{ type: 'compaction', input_tokens: 7, output_tokens: 7 }],
      },
    });
    expect(rows).toEqual([
      { role: 'question', model: 'b', input_tokens: 9, output_tokens: 8, fallback: false },
    ]);
  });
  it('message도 fallback_message도 아닌 항목은 세지 않는다', () => {
    const rows = usageRows('question', {
      model: 'b',
      usage: {
        input_tokens: 9,
        output_tokens: 9,
        iterations: [
          { type: 'compaction', input_tokens: 7, output_tokens: 7 },
          { type: 'message', input_tokens: 5, output_tokens: 1 },
        ],
      },
    });
    expect(rows.map((r) => [r.input_tokens, r.output_tokens])).toEqual([[5, 1]]);
  });
  it('토큰이 숫자가 아닌 항목은 세지 않는다', () => {
    const rows = usageRows('question', {
      model: 'b',
      usage: {
        input_tokens: 9,
        output_tokens: 9,
        iterations: [
          { type: 'message', input_tokens: '5', output_tokens: 1 },
          { type: 'message', input_tokens: 2, output_tokens: 1 },
        ],
      },
    });
    expect(rows.map((r) => r.input_tokens)).toEqual([2]);
  });
});

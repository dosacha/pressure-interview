import { Test } from '@nestjs/testing';
import { engineConfig, readEngineConfig } from '../../config/engine.config';
import { ANTHROPIC_CLIENT } from './anthropic.provider';
import { LlmService, RefusalError } from './llm.service';

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
      { provide: ANTHROPIC_CLIENT, useValue: { beta: { messages: { create } } } },
      { provide: engineConfig.KEY, useValue: readEngineConfig(env) },
    ],
  }).compile();
  return { llm: mod.get(LlmService), create };
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
          effort: 'high',
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
});

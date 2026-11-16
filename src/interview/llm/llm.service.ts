import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CallRole, engineConfig } from '../../config/engine.config';
import type { TokenUsage } from '../types';
import { ANTHROPIC_CLIENT } from './anthropic.provider';

export class RefusalError extends Error {
  override readonly name = 'RefusalError';
  constructor(readonly category: string | null) {
    super(`모델이 응답을 거절했다 (category: ${category ?? '없음'})`);
  }
}

export interface JsonRequest {
  role: CallRole;
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

export interface JsonLlm {
  callJson<T>(req: JsonRequest): Promise<{ data: T; usage: TokenUsage; model: string }>;
}

@Injectable()
export class LlmService implements JsonLlm {
  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic,
    @Inject(engineConfig.KEY) private readonly config: ConfigType<typeof engineConfig>,
  ) {}

  async callJson<T>(req: JsonRequest): Promise<{ data: T; usage: TokenUsage; model: string }> {
    const res = await this.client.beta.messages.create({
      model: this.config.models[req.role],
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: {
        effort: this.config.effort[req.role],
        format: { type: 'json_schema', schema: req.schema },
      },
    });
    if (res.stop_reason === 'refusal') throw new RefusalError(res.stop_details?.category ?? null);
    if (res.stop_reason === 'max_tokens') throw new Error('max_tokens');
    const text = res.content.find((b) => b.type === 'text');
    if (!text) throw new Error(`응답에 text 블록이 없다 (stop_reason: ${res.stop_reason})`);
    const data: unknown = JSON.parse(text.text);
    return {
      data: data as T,
      // shortcut: 최상위 usage만 센다. 폴백이 일어나면 거절된 시도의 사용량(usage.iterations)은 빠진다, 비용 추적이 필요해지면 iterations 합산
      usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
      model: res.model,
    };
  }
}

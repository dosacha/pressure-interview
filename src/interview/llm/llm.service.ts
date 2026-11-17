import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CallRole, engineConfig } from '../../config/engine.config';
import type { TokenUsage } from '../types';
import { ANTHROPIC_CLIENT } from './anthropic.provider';
import { UsageRecorder, type UsageRow } from './usage-recorder';

// toUpstreamError가 같은 문자열로 오류를 나눈다.
export const MAX_TOKENS_MESSAGE = 'max_tokens';
export const NO_TEXT_BLOCK_PREFIX = '응답에 text 블록이 없다';

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const tokens = (v: unknown): number => (typeof v === 'number' ? v : 0);

// 캐시 수명. 면접 중 호출은 지원자가 답을 쓰는 동안 다음 호출까지 5분을 넘길 수 있어 1시간으로 둔다(쓰기 2배, 읽기 0.05배).
// 복기는 세 개씩 몰아 불러 5분 안에 끝나므로 5분으로 둔다(쓰기 1.25배).
const cacheTtl = (role: CallRole): '5m' | '1h' => (role === 'review' ? '5m' : '1h');

/** iterations가 있으면 거절된 시도까지 한 줄씩, 없으면 최상위 usage 한 줄. 둘을 함께 세지 않는다. */
export function usageRows(
  role: CallRole,
  res: {
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
      iterations?: unknown;
    };
  },
): UsageRow[] {
  const { iterations } = res.usage;
  if (Array.isArray(iterations) && iterations.length > 0) {
    const rows: UsageRow[] = [];
    for (const it of iterations as unknown[]) {
      if (!isRecord(it) || (it.type !== 'message' && it.type !== 'fallback_message')) continue;
      if (typeof it.input_tokens !== 'number' || typeof it.output_tokens !== 'number') continue;
      rows.push({
        role,
        model: typeof it.model === 'string' ? it.model : res.model,
        input_tokens: it.input_tokens,
        output_tokens: it.output_tokens,
        cache_creation_input_tokens: tokens(it.cache_creation_input_tokens),
        cache_read_input_tokens: tokens(it.cache_read_input_tokens),
        fallback: it.type === 'fallback_message',
      });
    }
    // 셀 수 있는 항목이 하나도 없으면 과금된 호출이 빠지지 않게 최상위 usage로 센다.
    if (rows.length > 0) return rows;
  }
  return [
    {
      role,
      model: res.model,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_creation_input_tokens: tokens(res.usage.cache_creation_input_tokens),
      cache_read_input_tokens: tokens(res.usage.cache_read_input_tokens),
      fallback: false,
    },
  ];
}

@Injectable()
export class LlmService implements JsonLlm {
  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic,
    @Inject(engineConfig.KEY) private readonly config: ConfigType<typeof engineConfig>,
    private readonly recorder: UsageRecorder,
  ) {}

  async callJson<T>(req: JsonRequest): Promise<{ data: T; usage: TokenUsage; model: string }> {
    const res = await this.client.beta.messages.create({
      model: this.config.models[req.role],
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        {
          type: 'text',
          text: req.system,
          cache_control: { type: 'ephemeral', ttl: cacheTtl(req.role) },
        },
      ],
      messages: [{ role: 'user', content: req.user }],
      output_config: {
        effort: this.config.effort[req.role],
        format: { type: 'json_schema', schema: req.schema },
      },
    });
    // 거절·max_tokens로 끝난 호출도 과금되므로 stop_reason을 보기 전에 센다.
    this.recorder.record(usageRows(req.role, res));
    if (res.stop_reason === 'refusal') throw new RefusalError(res.stop_details?.category ?? null);
    if (res.stop_reason === 'max_tokens') throw new Error(MAX_TOKENS_MESSAGE);
    const text = res.content.find((b) => b.type === 'text');
    if (!text) throw new Error(`${NO_TEXT_BLOCK_PREFIX} (stop_reason: ${res.stop_reason})`);
    const data: unknown = JSON.parse(text.text);
    return {
      data: data as T,
      usage: {
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        cache_creation_input_tokens: tokens(res.usage.cache_creation_input_tokens),
        cache_read_input_tokens: tokens(res.usage.cache_read_input_tokens),
      },
      model: res.model,
    };
  }
}

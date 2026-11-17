import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { UsageRecorder, type UsageRow } from '../interview/llm/usage-recorder';
import { LlmUsage } from './llm-usage.entity';

export interface UsageSummary {
  role: string;
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  calls: number;
  fallbacks: number;
}

@Injectable()
export class UsageService implements OnModuleInit {
  private readonly logger = new Logger(UsageService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @InjectRepository(LlmUsage) private readonly repo: Repository<LlmUsage>,
    private readonly recorder: UsageRecorder,
  ) {}

  onModuleInit(): void {
    this.recorder.setSink((sessionId, rows) => this.insert(sessionId, rows));
  }

  // 사용량 기록 실패가 면접을 멈추면 안 되므로 오류는 로그만 남기고 삼킨다.
  private insert(sessionId: string, rows: UsageRow[]): void {
    const task: Promise<void> = this.repo
      .insert(
        rows.map((r) => ({
          sessionId,
          callRole: r.role,
          model: r.model,
          inputTokens: r.input_tokens,
          cacheCreationInputTokens: r.cache_creation_input_tokens,
          cacheReadInputTokens: r.cache_read_input_tokens,
          outputTokens: r.output_tokens,
          fallback: r.fallback,
        })),
      )
      .then(
        () => undefined,
        (err: unknown) => {
          this.logger.error(
            `사용량 기록 실패: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      )
      .finally(() => {
        this.pending.delete(task);
      });
    this.pending.add(task);
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  async summarize(sessionId: string): Promise<UsageSummary[]> {
    const raw = await this.repo
      .createQueryBuilder('u')
      .select('u.call_role', 'role')
      .addSelect('u.model', 'model')
      .addSelect('SUM(u.input_tokens)', 'inputTokens')
      .addSelect('SUM(u.cache_creation_input_tokens)', 'cacheCreationTokens')
      .addSelect('SUM(u.cache_read_input_tokens)', 'cacheReadTokens')
      .addSelect('SUM(u.output_tokens)', 'outputTokens')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('COUNT(*) FILTER (WHERE u.fallback)', 'fallbacks')
      .where('u.session_id = :sessionId', { sessionId })
      .groupBy('u.call_role')
      .addGroupBy('u.model')
      .orderBy('u.call_role')
      .addOrderBy('u.model')
      .getRawMany<Record<keyof UsageSummary, string>>();
    return raw.map((r) => ({
      role: r.role,
      model: r.model,
      inputTokens: Number(r.inputTokens),
      cacheCreationTokens: Number(r.cacheCreationTokens),
      cacheReadTokens: Number(r.cacheReadTokens),
      outputTokens: Number(r.outputTokens),
      calls: Number(r.calls),
      fallbacks: Number(r.fallbacks),
    }));
  }
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { CallRole } from '../../config/engine.config';

export interface UsageRow {
  role: CallRole;
  model: string;
  input_tokens: number;
  output_tokens: number;
  fallback: boolean;
}

export type UsageSink = (sessionId: string, rows: UsageRow[]) => void;

/** 엔진은 DB를 모른다. 세션 id와 sink가 모두 있을 때만 사용량을 밖으로 넘긴다. */
@Injectable()
export class UsageRecorder {
  private readonly sessions = new AsyncLocalStorage<string>();
  private sink: UsageSink | null = null;

  setSink(sink: UsageSink): void {
    this.sink = sink;
  }

  run<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    return this.sessions.run(sessionId, fn);
  }

  record(rows: UsageRow[]): void {
    const sessionId = this.sessions.getStore();
    if (sessionId === undefined || this.sink === null) return;
    this.sink(sessionId, rows);
  }
}

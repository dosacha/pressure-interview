import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';

import { LlmService } from '../src/interview/llm/llm.service';
import { UsageRecorder } from '../src/interview/llm/usage-recorder';
import { UsageService } from '../src/usage/usage.service';
import { createFakeAnthropic } from './support/fake-anthropic';
import { resetDb } from './support/reset-db';
import { createTestApp } from './support/test-app';

const leak = { role: 'leak' as const, system: 's', user: 'u', schema: { required: ['techs'] } };

describe('사용량 기록 (e2e)', () => {
  let app: NestExpressApplication;
  let recorder: UsageRecorder;
  let llm: LlmService;
  let usage: UsageService;

  beforeAll(async () => {
    app = await createTestApp(createFakeAnthropic());
    recorder = app.get(UsageRecorder);
    llm = app.get(LlmService);
    usage = app.get(UsageService);
  });
  beforeEach(async () => {
    await resetDb(app.get(DataSource));
  });
  afterAll(async () => {
    await app.close();
  });

  it('run 안의 호출이 llm_usage에 남고 summarize가 역할별로 합친다', async () => {
    const sessionId = randomUUID();
    await recorder.run(sessionId, () => llm.callJson(leak));
    await usage.flush();
    expect(await usage.summarize(sessionId)).toEqual([
      { role: 'leak', model: 'fake-model', inputTokens: 10, outputTokens: 5, calls: 1, fallbacks: 0 },
    ]);
  });

  it('run 밖의 호출은 남기지 않는다', async () => {
    await llm.callJson(leak);
    await usage.flush();
    const rows = await app.get(DataSource).query<{ n: string }[]>('SELECT COUNT(*) AS n FROM llm_usage');
    expect(Number(rows[0].n)).toBe(0);
  });

  it('넣기가 실패해도 호출은 결과를 돌려준다', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const out = await recorder.run('uuid가 아님', () => llm.callJson<{ techs: unknown[] }>(leak));
    await usage.flush();
    expect(out.data).toEqual({ techs: [] });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { REVIEW_SCHEMA } from '../src/interview/calls/review.call';
import { createFakeAnthropic, rawText } from './support/fake-anthropic';
import { resetDb } from './support/reset-db';
import { createTestApp } from './support/test-app';

describe('앱 뼈대', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp(createFakeAnthropic());
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDb(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health 는 200과 { status: "ok" }를 준다', async () => {
    await request(app.getHttpServer()).get('/v1/health').expect(200).expect({ status: 'ok' });
  });

  it('마이그레이션 테이블이 있다', async () => {
    const rows: { t: string | null }[] = await dataSource.query(
      `SELECT to_regclass('public.typeorm_migrations') AS t`,
    );
    expect(rows[0].t).toBe('typeorm_migrations');
  });

  it('가짜 클라이언트가 호출 종류를 알아낸다', async () => {
    const fake = createFakeAnthropic();
    await fake.client.beta.messages.create({
      output_config: { format: { schema: { required: ['techs'] } } },
    });
    expect(fake.calls[0].kind).toBe('leak');
  });

  it('required로 질문·정답지·전제 검사·검증을 가려낸다', async () => {
    const fake = createFakeAnthropic();
    for (const required of [
      ['text', 'questionIntent', 'assumption'],
      ['vanishing', 'remaining', 'alternatives', 'keyPoints'],
      ['premiseOk', 'problems'],
      ['premiseOk', 'problems', 'corrections'],
      REVIEW_SCHEMA.required,
    ]) {
      await fake.client.beta.messages.create({
        output_config: { format: { schema: { required } } },
      });
    }
    expect(fake.calls.map((c) => c.kind)).toEqual([
      'question',
      'answerKey',
      'premise',
      'verify',
      'review',
    ]);
  });

  it('once가 on보다 먼저 쓰이고 한 번만 쓰인다', async () => {
    const fake = createFakeAnthropic();
    const params = { output_config: { format: { schema: { required: ['reply'] } } } };
    const textOf = async () => {
      const res = (await fake.client.beta.messages.create(params)) as {
        content: { text: string }[];
      };
      return res.content[0].text;
    };
    fake.on('clarify', { reply: 'on' });
    fake.once('clarify', { reply: 'once' });
    expect(await textOf()).toBe('{"reply":"once"}');
    expect(await textOf()).toBe('{"reply":"on"}');
    expect(await textOf()).toBe('{"reply":"on"}');
  });

  it('rawText는 글자를 그대로 싣는다', async () => {
    const fake = createFakeAnthropic();
    fake.on('leak', rawText('{깨진'));
    const res = (await fake.client.beta.messages.create({
      output_config: { format: { schema: { required: ['techs'] } } },
    })) as { content: { text: string }[] };
    expect(res.content[0].text).toBe('{깨진');
  });
});

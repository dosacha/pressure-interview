import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { InterviewTurn } from '../src/session/interview-turn.entity';
import { InterviewService, RNG } from '../src/session/interview.service';
import { UsageService } from '../src/usage/usage.service';
import { createFakeAnthropic, rawText, type FakeAnthropic } from './support/fake-anthropic';
import { resetDb } from './support/reset-db';
import { createTestApp } from './support/test-app';

const MARKED_KEY = {
  vanishing: [],
  remaining: [],
  alternatives: [{ name: '비밀-대안-7734', traits: 't' }],
  keyPoints: ['비밀-핵심-7731'],
};

describe('면접 HTTP API (e2e)', () => {
  let fake: FakeAnthropic;
  let app: NestExpressApplication;
  let server: App;

  beforeEach(async () => {
    fake = createFakeAnthropic();
    app = await createTestApp(fake, [{ provide: RNG, useValue: () => 0 }]);
    server = app.getHttpServer();
    await resetDb(app.get(DataSource));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.get(InterviewService).settle();
    await app.get(UsageService).flush();
    await app.close();
  });

  async function begin(): Promise<{ id: string; turnId: string }> {
    const res = await request(server).post('/v1/interviews').send({ topic: 'Redis' }).expect(201);
    const body = res.body as { id: string; turns: { id: string }[] };
    return { id: body.id, turnId: body.turns[0].id };
  }
  const answerOf = (turnId: string) => ({ turnId, text: '답입니다.', answerStartMs: 1000 });

  it('면접 중의 모든 응답 본문에 숨긴 값이 없다 (Review Focus 1)', async () => {
    fake.on('question', {
      text: '질문',
      questionIntent: 'A1',
      assumption: { axis: 'scale', statement: '비밀-가정-7732' },
    });
    fake.on('answerKey', MARKED_KEY);
    fake.on('analyze', {
      kind: 'answer',
      defects: [{ type: 'vague', axis: 'scale', note: '비밀-메모-7733' }],
      mentionedTechs: [],
      unknownTechs: [],
    });
    const start = await request(server).post('/v1/interviews').send({ topic: 'Redis' }).expect(201);
    const { id, turns } = start.body as { id: string; turns: { id: string }[] };
    const bodies = [
      start.text,
      (
        await request(server)
          .post(`/v1/interviews/${id}/answers`)
          .send(answerOf(turns[0].id))
          .expect(200)
      ).text,
      (await request(server).get(`/v1/interviews/${id}`).expect(200)).text,
      (await request(server).get('/v1/interviews').expect(200)).text,
    ];
    for (const body of bodies)
      for (const mark of ['7731', '7732', '7733', '7734', '집요형', '조력형', '흔드는형'])
        expect(body).not.toContain(mark);
    // 표식이 DB에는 있어야 위 단언이 뜻을 가진다. 정답지는 뒤 작업이 채우므로 끝나기를 기다린다.
    await app.get(InterviewService).settle();
    const rows = await app
      .get(DataSource)
      .getRepository(InterviewTurn)
      .find({ where: { sessionId: id } });
    const first = rows.sort((x, y) => x.seq - y.seq)[0];
    expect(first.question.answerKey?.keyPoints).toContain('비밀-핵심-7731');
    expect(first.question.answerKey?.alternatives[0].name).toBe('비밀-대안-7734');
    expect(first.question.assumption.statement).toBe('비밀-가정-7732');
    expect(first.analysis?.defects[0].note).toBe('비밀-메모-7733');
  });

  it('모델이 깨진 JSON을 주면 502이고 본문에 응답 글자가 없다 (Review Focus 1)', async () => {
    fake.once('question', rawText('{"answerKey":{"keyPoints":["비밀-핵심-7731"'));
    const res = await request(server).post('/v1/interviews').send({ topic: 'Redis' }).expect(502);
    expect(res.body).toEqual({ error: 'LLM_FAILED', reason: 'BAD_RESPONSE', category: null });
  });

  it('잘못된 입력은 400이고 모델을 부르지 않는다', async () => {
    const res = await request(server).post('/v1/interviews').send({ topic: '' }).expect(400);
    expect(res.body).toEqual({
      error: 'INVALID_INPUT',
      issues: [{ field: 'topic', reason: 'EMPTY' }],
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('JSON이 아닌 본문도 400이고 원래 파싱 오류 메시지가 없다', async () => {
    const res = await request(server)
      .post('/v1/interviews')
      .set('Content-Type', 'application/json')
      .send('{깨진 글자')
      .expect(400);
    expect(res.body).toEqual({ error: 'HTTP_ERROR' });
    expect(res.text).not.toMatch(/JSON|Unexpected|position/i);
    expect(fake.calls).toHaveLength(0);
  });

  it('없는 면접은 404, uuid가 아닌 id는 400', async () => {
    const missing = await request(server).get(`/v1/interviews/${randomUUID()}`).expect(404);
    expect(missing.body).toEqual({ error: 'NOT_FOUND' });
    const bad = await request(server).get('/v1/interviews/abc').expect(400);
    expect(bad.body).toEqual({
      error: 'INVALID_INPUT',
      issues: [{ field: 'id', reason: 'MUST_BE_UUID' }],
    });
    await request(server).post('/v1/interviews/abc/advance').expect(400);
    await request(server).get('/v1/없는-경로').expect(404);
  });

  it('같은 답을 두 번 보내면 두 번째는 409 TURN_NOT_OPEN (Review Focus 3)', async () => {
    const { id, turnId } = await begin();
    await request(server).post(`/v1/interviews/${id}/answers`).send(answerOf(turnId)).expect(200);
    const second = await request(server)
      .post(`/v1/interviews/${id}/answers`)
      .send(answerOf(turnId))
      .expect(409);
    expect(second.body).toEqual({ error: 'TURN_NOT_OPEN' });
  });

  it('모델 실패는 502 LLM_FAILED API_ERROR이고, advance로 이어 간다 (Review Focus 2)', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', new Error('upstream 비밀-9912'));
    const failed = await request(server)
      .post(`/v1/interviews/${id}/answers`)
      .send(answerOf(turnId))
      .expect(502);
    expect(failed.body).toEqual({ error: 'LLM_FAILED', reason: 'API_ERROR', category: null });
    expect(failed.text).not.toContain('9912');
    const view = await request(server).get(`/v1/interviews/${id}`).expect(200);
    expect((view.body as { pending: string }).pending).toBe('retry');
    const resumed = await request(server).post(`/v1/interviews/${id}/advance`).expect(200);
    const body = resumed.body as { pending: string; turns: unknown[] };
    expect(body.turns).toHaveLength(2);
    expect(body.pending).toBe('answer');
  });

  it('할 일이 없는 advance는 409 NOTHING_TO_RETRY', async () => {
    const { id } = await begin();
    const res = await request(server).post(`/v1/interviews/${id}/advance`).expect(409);
    expect(res.body).toEqual({ error: 'NOTHING_TO_RETRY' });
  });

  it('finish는 200이고 끝난 면접에 답하면 409 INTERVIEW_FINISHED', async () => {
    const { id, turnId } = await begin();
    const done = await request(server).post(`/v1/interviews/${id}/finish`).expect(200);
    expect((done.body as { status: string }).status).toBe('finished');
    const res = await request(server)
      .post(`/v1/interviews/${id}/answers`)
      .send(answerOf(turnId))
      .expect(409);
    expect(res.body).toEqual({ error: 'INTERVIEW_FINISHED' });
  });

  it('500 응답에 메시지와 스택이 없다', async () => {
    const { id } = await begin();
    jest.spyOn(app.get(InterviewService), 'getView').mockRejectedValue(new Error('내부-9911'));
    const res = await request(server).get(`/v1/interviews/${id}`).expect(500);
    expect(res.body).toEqual({ error: 'INTERNAL' });
    expect(res.text).not.toContain('9911');
  });
});

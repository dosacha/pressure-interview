import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { MemoryService } from '../src/memory/memory.service';
import { ReviewService } from '../src/review/review.service';
import type { ReviewView } from '../src/review/review.view';
import { InterviewTurn } from '../src/session/interview-turn.entity';
import { InterviewService, RNG } from '../src/session/interview.service';
import { UsageService } from '../src/usage/usage.service';
import { createFakeAnthropic, type CallKind, type FakeAnthropic } from './support/fake-anthropic';
import { resetDb } from './support/reset-db';
import { createTestApp } from './support/test-app';

const WITH_SECONDARY = {
  kind: 'answer',
  defects: [
    { type: 'wrong', axis: 'durability', note: 'n1' },
    { type: 'missing_axis', axis: 'scale', note: 'n2' },
  ],
  mentionedTechs: [],
  unknownTechs: [],
};
const CLARIFY = { kind: 'clarify', defects: [], mentionedTechs: [], unknownTechs: [] };
const NO_CORRECTIONS = { lists: [], alternatives: { changed: false, items: [] } };
const REVIEW_WOBBLY = {
  intent: { aimed: true, note: '' },
  defects: [],
  reactions: [],
  assumption: { result: 'wobbly', note: '', sameAs: null },
  keyProblems: [],
};

describe('복기 (e2e)', () => {
  let fake: FakeAnthropic;
  let app: NestExpressApplication;
  let server: App;
  let interviews: InterviewService;
  let review: ReviewService;
  let memory: MemoryService;
  let dataSource: DataSource;
  const sessions: string[] = [];

  beforeEach(async () => {
    fake = createFakeAnthropic();
    // 질문 문장을 호출마다 다르게 해서 프롬프트에서 어느 질문인지 가려낸다.
    let n = 0;
    fake.on('question', () => ({
      text: `질문-${++n}-끝`,
      questionIntent: 'A1',
      assumption: { axis: 'none', statement: '' },
    }));
    app = await createTestApp(fake, [{ provide: RNG, useValue: () => 0 }]);
    server = app.getHttpServer();
    interviews = app.get(InterviewService);
    review = app.get(ReviewService);
    memory = app.get(MemoryService);
    dataSource = app.get(DataSource);
    await resetDb(dataSource);
    sessions.length = 0;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await interviews.settle();
    for (const id of sessions) await review.whenIdle(id);
    await app.get(UsageService).flush();
    await app.close();
  });

  const calls = (kind: CallKind) => fake.calls.filter((c) => c.kind === kind);
  const userOf = (c: { params: Record<string, unknown> }) =>
    (c.params.messages as { content: string }[])[0].content;
  const turnRows = (sessionId: string) =>
    dataSource.getRepository(InterviewTurn).find({ where: { sessionId }, order: { seq: 'ASC' } });

  // 가정을 바꾸는 질문으로 바꾼다. 문장은 호출마다 다르다.
  function withAssumptions() {
    let n = 0;
    fake.on('question', () => ({
      text: `가정질문-${++n}-끝`,
      questionIntent: 'A8',
      assumption: { axis: 'scale', statement: `요청이 ${n}0배로 는다` },
    }));
  }
  async function begin(questionLimit?: number) {
    const v = await interviews.start({ topic: 'Redis', questionLimit });
    sessions.push(v.id);
    return v.id;
  }
  async function answerLast(id: string, text = '답입니다.') {
    const v = await interviews.getView(id);
    return interviews.submitAnswer(id, { turnId: v.turns.at(-1)!.id, text, answerStartMs: 1000 });
  }
  // 질문 수 상한까지 모두 답해 끝낸다.
  async function play(questionLimit = 2): Promise<string> {
    const id = await begin(questionLimit);
    for (let i = 0; i < questionLimit; i++) await answerLast(id);
    await interviews.settle();
    return id;
  }
  async function reviewed(id: string): Promise<ReviewView> {
    await review.start(id);
    await review.whenIdle(id);
    return review.getView(id);
  }

  it('진행 중인 면접의 복기는 409이고 숨긴 값을 주지 않는다 (Review Focus 1)', async () => {
    const id = await begin();
    const turnId = (await interviews.getView(id)).turns[0].id;
    // 요청은 하나씩 만든다. 미리 만들어 두면 듣지 않는 서버를 셋이 함께 열려고 해서 연결이 끊긴다.
    for (const req of [
      () => request(server).get(`/v1/interviews/${id}/review`),
      () => request(server).post(`/v1/interviews/${id}/review`),
      () =>
        request(server)
          .patch(`/v1/interviews/${id}/turns/${turnId}`)
          .send({ surprise: 'expected' }),
    ]) {
      const res = await req().expect(409);
      expect(res.body).toEqual({ error: 'INTERVIEW_NOT_FINISHED' });
    }
    expect(calls('review')).toHaveLength(0);
  });

  it('끝난 면접의 복기를 만들면 턴마다 재검사가 한 번씩 돈다', async () => {
    const id = await play(2);
    const answeredTurns = 2;
    await request(server).post(`/v1/interviews/${id}/review`).expect(202);
    await review.whenIdle(id);
    expect(calls('review')).toHaveLength(answeredTurns);
    const v = (await request(server).get(`/v1/interviews/${id}/review`).expect(200))
      .body as ReviewView;
    expect(v.status).toBe('ready');
    expect(v.progress).toEqual({ done: 2, total: 2 });
    expect(v.error).toBeNull();
    expect(v.turns[0].answerKey.keyPoints).toEqual(['k1']);
    expect(['집요형', '조력형', '흔드는형']).toContain(v.turns[0].interviewer.temperamentName);
    expect(v.turns[0].questionIntent).toEqual({ id: 'A1', name: '원리 이해', group: '깊이' });
    expect(v.turns[0].review).not.toBeNull();
  });

  it('복기를 두 번 눌러도 재검사는 턴마다 한 번이다 (Review Focus 5)', async () => {
    const id = await play(2);
    await Promise.all([
      request(server).post(`/v1/interviews/${id}/review`).expect(202),
      request(server).post(`/v1/interviews/${id}/review`).expect(202),
    ]);
    await review.whenIdle(id);
    await request(server).post(`/v1/interviews/${id}/review`).expect(202);
    await review.whenIdle(id);
    expect(calls('review')).toHaveLength(2);
    expect((await review.getView(id)).status).toBe('ready');
  });

  it('일부 턴이 실패하면 그 턴만 다시 만든다 (Review Focus 5)', async () => {
    const id = await play(2);
    const answeredTurns = 2;
    fake.once('review', new Error('boom'));
    await review.start(id);
    await review.whenIdle(id);
    const failed = await review.getView(id);
    expect(failed.status).toBe('none');
    expect(failed.error).toBe('API_ERROR');
    expect(failed.progress).toEqual({ done: 1, total: 2 });
    await review.start(id);
    await review.whenIdle(id);
    expect(calls('review')).toHaveLength(answeredTurns + 1);
    const v = await review.getView(id);
    expect(v.status).toBe('ready');
    expect(v.error).toBeNull();
  });

  it('기억 반영이 한 번 실패해도 다시 시작하면 반영된다 (Review Focus 5)', async () => {
    withAssumptions();
    fake.on('review', REVIEW_WOBBLY);
    const id = await play(2);
    const answeredTurns = 2;
    jest.spyOn(memory, 'syncSession').mockRejectedValueOnce(new Error('sync'));
    await review.start(id);
    await review.whenIdle(id);
    const failed = await review.getView(id);
    expect(failed.status).toBe('none');
    expect(failed.error).toBe('MEMORY_SYNC_FAILED');
    expect(await memory.all()).toHaveLength(0);
    await review.start(id);
    await review.whenIdle(id);
    expect((await review.getView(id)).status).toBe('ready');
    expect(calls('review')).toHaveLength(answeredTurns); // 재검사는 다시 하지 않는다
    expect(await memory.all()).not.toHaveLength(0);
  });

  it('덧붙이기가 낀 면접에서 이 답에서 나온 질문을 원인 턴으로 짝짓는다', async () => {
    // seq 1의 답 → seq 2(primary), seq 3(addOn, 원인 seq 1). seq 2의 답 → 나온 질문 없음
    const id = await begin(3);
    fake.once('analyze', WITH_SECONDARY);
    for (let i = 0; i < 3; i++) await answerLast(id);
    await interviews.settle();
    const rows = await turnRows(id);
    expect(rows.map((r) => [r.seq, r.addOn, r.causeTurnId])).toEqual([
      [1, false, null],
      [2, false, rows[0].id],
      [3, true, rows[0].id],
    ]);
    const textOf = (seq: number) => rows[seq - 1].question.text;
    const v = await reviewed(id);
    const reviewCalls = calls('review');
    expect(reviewCalls).toHaveLength(3);
    expect(userOf(reviewCalls[0])).toContain(textOf(2));
    expect(userOf(reviewCalls[0])).toContain(textOf(3));
    expect(userOf(reviewCalls[1])).not.toContain(textOf(3));
    expect(v.turns[0].followUps.map((f) => [f.seq, f.addOn])).toEqual([
      [2, false],
      [3, true],
    ]);
    expect(v.turns[0].followUps[1].roleName).toBe('시나리오형');
    expect(v.turns[1].followUps).toEqual([]);
    expect(v.turns[2].cause.reactionIntent).not.toBeNull();
    expect(v.turns[2].cause.defect).not.toBeNull();
  });

  it('분석 없이 남은 답은 복기에서 빠지고 수로만 보인다', async () => {
    const id = await begin();
    await answerLast(id);
    fake.once('analyze', new Error('boom'));
    await expect(answerLast(id)).rejects.toThrow();
    await interviews.finish(id);
    await interviews.settle();
    const v = await reviewed(id);
    expect(v.skippedAnswers).toBe(1);
    expect(v.turns).toHaveLength(1);
    expect(v.progress).toEqual({ done: 1, total: 1 });
    expect(v.status).toBe('ready');
    expect(calls('review')).toHaveLength(1);
  });

  it('되묻기 응답이 실패한 채 끝낸 턴은 복기 대상이 아니고 재검사 호출이 나가지 않는다', async () => {
    // analyze → clarify, clarify 호출 Error, finish. 그 턴에는 answer와 analysis(kind clarify)가 남아 있다
    const id = await begin();
    fake.once('analyze', CLARIFY);
    fake.once('clarify', new Error('boom'));
    await expect(answerLast(id, '읽기 위주인가요?')).rejects.toThrow();
    await interviews.finish(id);
    await interviews.settle();
    const [row] = await turnRows(id);
    expect(row.answer).toBe('읽기 위주인가요?');
    expect(row.analysis?.kind).toBe('clarify');
    await review.start(id);
    await review.whenIdle(id);
    expect(calls('review')).toHaveLength(0);
    const v = await review.getView(id);
    expect(v.skippedAnswers).toBe(1);
    expect(v.turns).toEqual([]);
    // 복기에 보이지 않는 턴에는 표시도 저장하지 않는다.
    const res = await request(server)
      .patch(`/v1/interviews/${id}/turns/${row.id}`)
      .send({ surprise: 'expected' })
      .expect(409);
    expect(res.body).toEqual({ error: 'NOT_REVIEWABLE' });
  });

  it('결과를 고친 뒤 기억 반영이 실패하면 status가 none이 되고, 다시 시작하면 반영된다 (Review Focus 5)', async () => {
    withAssumptions();
    fake.on('review', REVIEW_WOBBLY);
    const id = await play(2);
    expect((await reviewed(id)).status).toBe('ready');
    const [first] = await turnRows(id);
    // memory.syncSession이 한 번 던지게 한 뒤 PATCH assumptionResult
    jest.spyOn(memory, 'syncSession').mockRejectedValueOnce(new Error('sync'));
    await request(server)
      .patch(`/v1/interviews/${id}/turns/${first.id}`)
      .send({ assumptionResult: 'well' })
      .expect(200);
    const v = await review.getView(id);
    expect([v.status, v.error]).toEqual(['none', 'MEMORY_SYNC_FAILED']);
    expect(v.turns[0].review?.assumption.userResult).toBe('well');
    await review.start(id);
    await review.whenIdle(id);
    expect((await review.getView(id)).status).toBe('ready');
    const record = (await memory.all()).find((r) => r.encounters[0].turnId === first.id);
    expect(record?.status).toBe('well');
  });

  it('같은 축의 앞선 가정을 knownAssumptions로 준다', async () => {
    withAssumptions();
    const id = await play(2);
    const [first, second] = await turnRows(id);
    await reviewed(id);
    const secondCall = calls('review').find((c) =>
      userOf(c).includes(`질문 문장: ${second.question.text}`),
    );
    expect(userOf(secondCall!)).toContain(
      `key turn:${first.id}: ${first.question.assumption.statement}`,
    );
    const firstCall = calls('review').find((c) =>
      userOf(c).includes(`질문 문장: ${first.question.text}`),
    );
    expect(userOf(firstCall!)).not.toContain('key turn:');
  });

  it('복기가 끝나면 가정이 기억에 들어간다', async () => {
    withAssumptions();
    fake.on('review', REVIEW_WOBBLY);
    const id = await play(2);
    const v = await reviewed(id);
    expect(v.status).toBe('ready');
    expect(await memory.all()).toHaveLength(2);
    expect(v.assumptions).toEqual([
      {
        axisName: '규모',
        statement: v.turns[0].assumption?.statement,
        result: 'wobbly',
        turnSeq: 1,
      },
      {
        axisName: '규모',
        statement: v.turns[1].assumption?.statement,
        result: 'wobbly',
        turnSeq: 2,
      },
    ]);
  });

  it('가정 결과를 고치면 기억이 따라 바뀐다', async () => {
    withAssumptions();
    fake.on('review', REVIEW_WOBBLY);
    const id = await play(2);
    await reviewed(id);
    const [first] = await turnRows(id);
    const res = await request(server)
      .patch(`/v1/interviews/${id}/turns/${first.id}`)
      .send({ assumptionResult: 'well' })
      .expect(200);
    const v = res.body as ReviewView;
    expect(v.status).toBe('ready');
    expect(v.assumptions[0].result).toBe('well');
    const record = (await memory.all()).find((r) => r.encounters[0].turnId === first.id);
    expect(record?.status).toBe('well');
  });

  it('가정을 바꾼 질문이 아닌 턴의 결과를 고치려 하면 409 NOT_REVIEWABLE', async () => {
    const id = await play(2);
    await reviewed(id);
    const [first] = await turnRows(id);
    const res = await request(server)
      .patch(`/v1/interviews/${id}/turns/${first.id}`)
      .send({ assumptionResult: 'well', surprise: 'expected' })
      .expect(409);
    expect(res.body).toEqual({ error: 'NOT_REVIEWABLE' });
    // 함께 보낸 표시도 저장되지 않는다.
    expect((await turnRows(id))[0].surprise).toBeNull();
  });

  it('예상 표시를 저장한다', async () => {
    const id = await play(2);
    await reviewed(id);
    const [, second] = await turnRows(id);
    const res = await request(server)
      .patch(`/v1/interviews/${id}/turns/${second.id}`)
      .send({ surprise: 'unexpected' })
      .expect(200);
    expect((res.body as ReviewView).turns[1].surprise).toBe('unexpected');
    expect((await review.getView(id)).turns.map((t) => t.surprise)).toEqual([null, 'unexpected']);
  });

  it('되묻기 응답의 흘림 표시가 복기에 보인다', async () => {
    const id = await begin(2);
    fake.once('analyze', CLARIFY);
    fake.on('leak', { techs: [{ name: 'Memcached', role: 'solution' }] });
    await answerLast(id, '읽기 위주인가요?');
    fake.on('leak', { techs: [] });
    await answerLast(id);
    await answerLast(id);
    await interviews.settle();
    const v = await reviewed(id);
    expect(v.turns[0].clarifications).toEqual([
      { ask: '읽기 위주인가요?', reply: '범위는 한 대의 서버입니다.', leak: true },
    ]);
  });

  it('사후 검증에서 전제가 틀린 것으로 드러난 질문은 premiseFlag가 참이다', async () => {
    fake.once('verify', {
      premiseOk: false,
      problems: [{ field: 'text', problem: 'p' }],
      corrections: NO_CORRECTIONS,
    });
    const id = await play(2);
    const v = await reviewed(id);
    expect(v.turns.map((t) => [t.premiseFlag, t.leakFlag])).toEqual([
      [true, false],
      [false, false],
    ]);
  });

  it('사용량에 복기 호출이 든다', async () => {
    const id = await play(2);
    const v = await reviewed(id);
    expect(v.usage.find((u) => u.role === 'review')?.calls).toBe(2);
  });

  it('본문이 비거나 값이 목록 밖이면 400', async () => {
    const id = await play(2);
    const [first] = await turnRows(id);
    const empty = await request(server)
      .patch(`/v1/interviews/${id}/turns/${first.id}`)
      .send({})
      .expect(400);
    expect(empty.body).toEqual({
      error: 'INVALID_INPUT',
      issues: [{ field: 'body', reason: 'REQUIRED' }],
    });
    const bad = await request(server)
      .patch(`/v1/interviews/${id}/turns/${first.id}`)
      .send({ surprise: 'maybe' })
      .expect(400);
    expect(bad.body).toEqual({
      error: 'INVALID_INPUT',
      issues: [{ field: 'surprise', reason: 'NOT_ALLOWED' }],
    });
  });

  it('추이와 다시 낼 주제를 준다', async () => {
    const id = await play(2);
    await reviewed(id);
    const stats = (await request(server).get('/v1/stats').expect(200)).body as {
      improved: number;
      sessions: { id: string; medianAnswerStartMs: number | null }[];
    };
    expect(stats.improved).toBe(0);
    expect(stats.sessions.map((s) => [s.id, s.medianAnswerStartMs])).toEqual([[id, 1000]]);
    const topics = await request(server).get('/v1/memory/topics').expect(200);
    expect(topics.body).toEqual({ topics: [] });
  });
});

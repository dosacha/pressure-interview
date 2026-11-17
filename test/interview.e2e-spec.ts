import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';

import type { QuestionMemory } from '../src/interview/types';
import { InterviewTurn } from '../src/session/interview-turn.entity';
import { InterviewSession } from '../src/session/interview-session.entity';
import { InterviewService, MEMORY_SOURCE, RNG } from '../src/session/interview.service';
import { ConflictError, NotFoundError, UpstreamError } from '../src/session/session-errors';
import { CLOSING_TEXT } from '../src/session/session-rules';
import { UsageService } from '../src/usage/usage.service';
import {
  createFakeAnthropic,
  rawText,
  type CallKind,
  type FakeAnthropic,
} from './support/fake-anthropic';
import { resetDb } from './support/reset-db';
import { createTestApp } from './support/test-app';

const RNG_ZERO = { provide: RNG, useValue: () => 0 };

const question = (over: object = {}) => ({
  text: '기본 질문입니다.',
  questionIntent: 'A1',
  assumption: { axis: 'none', statement: '' },
  ...over,
});
// 가짜 클라이언트의 기본 정답지 응답
const KEY = { vanishing: [], remaining: [], alternatives: [], keyPoints: ['k1'] };
const NO_CORRECTIONS = { lists: [], alternatives: { changed: false, items: [] } };
const CORRECTING_VERIFY = {
  premiseOk: true,
  problems: [{ field: 'keyPoints', problem: 'p' }],
  corrections: { ...NO_CORRECTIONS, lists: [{ field: 'keyPoints', items: ['고친 핵심'] }] },
};
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
const UNKNOWN = { kind: 'answer', defects: [], mentionedTechs: [], unknownTechs: ['Memcached'] };

const tick = () => new Promise((r) => setTimeout(r, 50));
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!cond()) throw new Error('조건이 오지 않았다');
}
// 다음 한 번의 호출을 붙잡아 둔다. 테스트가 끝나기 전에 release로 풀어야 settle()이 끝난다.
function hold(f: FakeAnthropic, kind: CallKind, reply: object) {
  const held = { release: () => {} };
  f.once(kind, () => new Promise<object>((r) => (held.release = () => r(reply))));
  return held;
}

describe('면접 서비스 (e2e)', () => {
  let fake: FakeAnthropic;
  let app: NestExpressApplication;
  let service: InterviewService;
  let dataSource: DataSource;

  async function open(
    f: FakeAnthropic,
    overrides: { provide: unknown; useValue: unknown }[] = [RNG_ZERO],
  ): Promise<void> {
    fake = f;
    app = await createTestApp(f, overrides);
    service = app.get(InterviewService);
    dataSource = app.get(DataSource);
  }
  async function reopen(f: FakeAnthropic, overrides?: { provide: unknown; useValue: unknown }[]) {
    await app.get(UsageService).flush();
    await app.close();
    await open(f, overrides);
  }

  const calls = (kind: CallKind) => fake.calls.filter((c) => c.kind === kind);
  const lastCall = (kind: CallKind) => calls(kind).at(-1)!;
  const userOf = (c: { params: Record<string, unknown> }) =>
    (c.params.messages as { content: string }[])[0].content;
  const answer = (turnId: string, text = '답입니다.') => ({ turnId, text, answerStartMs: 1000 });
  const turnRows = (sessionId: string) =>
    dataSource.getRepository(InterviewTurn).find({ where: { sessionId }, order: { seq: 'ASC' } });
  const sessionRow = (id: string) =>
    dataSource.getRepository(InterviewSession).findOneByOrFail({ id });

  async function begin(questionLimit?: number) {
    const v = await service.start({ topic: 'Redis', questionLimit });
    return { id: v.id, turnId: v.turns[0].id };
  }
  // 마지막 턴에 답해 다음 턴까지 간다.
  async function answerLast(id: string, text?: string) {
    const v = await service.getView(id);
    return service.submitAnswer(id, answer(v.turns.at(-1)!.id, text));
  }

  beforeEach(async () => {
    await open(createFakeAnthropic());
    await resetDb(dataSource);
  });
  afterEach(async () => {
    await service.settle();
    await app.get(UsageService).flush();
    await app.close();
  });

  it('시작하면 직무를 고르고 첫 질문을 만든다', async () => {
    fake.on('jobRole', { role: 'architect' });
    const v = await service.start({ topic: 'Redis' });
    expect(v.panel.map((p) => p.roleName)).toEqual(['아키텍트', '교과형', '시나리오형']);
    expect(v.turns).toHaveLength(1);
    expect(v.pending).toBe('answer');
    expect(v.questionLimit).toBe(6);
  });

  it('답하면 분석하고 다음 질문을 만든다. 새 턴의 cause_turn_id는 답한 턴이다', async () => {
    const { id, turnId } = await begin();
    const v = await service.submitAnswer(id, answer(turnId));
    expect(v.turns).toHaveLength(2);
    expect(v.turns[0].answer).toBe('답입니다.');
    expect(v.pending).toBe('answer');
    const rows = await turnRows(id);
    expect(rows[1].causeTurnId).toBe(turnId);
    expect(rows[1].seq).toBe(2);
    expect(rows[0].analysis).not.toBeNull();
    expect(rows[0].answeredAt).toBeInstanceOf(Date);
  });

  it('둘째 질문의 프롬프트에 세션의 기억과 지금까지 말한 기술이 실린다', async () => {
    const memory: QuestionMemory = {
      retired: [{ axis: 'scale', statement: '요청이 백 배로 는다.' }],
      reissue: [],
      expected: [],
    };
    await reopen(createFakeAnthropic(), [
      RNG_ZERO,
      { provide: MEMORY_SOURCE, useValue: { snapshot: () => Promise.resolve(memory) } },
    ]);
    const { id, turnId } = await begin();
    fake.once('analyze', {
      kind: 'answer',
      defects: [],
      mentionedTechs: ['Kafka'],
      unknownTechs: [],
    });
    await service.submitAnswer(id, answer(turnId));
    expect(userOf(lastCall('question'))).toContain('기억(');
    expect(userOf(lastCall('question'))).toContain('요청이 백 배로 는다.');
    expect(userOf(lastCall('question'))).toContain('지원자가 지금까지 말한 기술: Redis, Kafka');
  });

  it('되묻기면 같은 턴에 응답을 붙이고 답을 다시 기다린다', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', { kind: 'clarify', defects: [], mentionedTechs: [], unknownTechs: [] });
    const v = await service.submitAnswer(id, {
      turnId,
      text: '읽기 위주인가요?',
      answerStartMs: 1200,
    });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0].clarifications).toEqual([
      { ask: '읽기 위주인가요?', reply: expect.any(String) as string },
    ]);
    expect(v.turns[0].answer).toBeNull();
    expect(v.pending).toBe('answer');
  });

  it('되묻기 뒤의 답이 첫 입력 시간을 덮어쓰지 않는다', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', CLARIFY);
    await service.submitAnswer(id, { turnId, text: '읽기 위주인가요?', answerStartMs: 1200 });
    await service.submitAnswer(id, { turnId, text: '답입니다.', answerStartMs: 5000 });
    const rows = await turnRows(id);
    expect(rows[0].answerStartMs).toBe(1200);
    expect(rows[0].answer).toBe('답입니다.');
    expect(rows).toHaveLength(2);
  });

  it('되묻기 응답 호출이 실패하면, 다시 시도할 때 분석을 다시 하지 않는다 (Review Focus 2)', async () => {
    const { id, turnId } = await begin();
    const ask = { turnId, text: '읽기 위주인가요?', answerStartMs: 1200 };
    fake.once('analyze', { kind: 'clarify', defects: [], mentionedTechs: [], unknownTechs: [] });
    fake.once('clarify', new Error('boom'));
    await expect(service.submitAnswer(id, ask)).rejects.toBeInstanceOf(UpstreamError);
    expect((await service.getView(id)).pending).toBe('retry');
    await service.advance(id);
    expect(fake.calls.filter((c) => c.kind === 'analyze')).toHaveLength(1);
    const v = await service.getView(id);
    expect(v.turns[0].clarifications).toHaveLength(1);
    expect(v.pending).toBe('answer');
  });

  it('되묻기 응답에 흘림이 남으면 응답은 보여 주고 leak을 DB에 남긴다', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', CLARIFY);
    fake.on('leak', { techs: [{ name: 'Memcached', role: 'solution' }] });
    const v = await service.submitAnswer(id, {
      turnId,
      text: '읽기 위주인가요?',
      answerStartMs: 1200,
    });
    expect(v.turns[0].clarifications[0].reply).toBe('범위는 한 대의 서버입니다.');
    expect(v.turns[0].clarifications[0]).not.toHaveProperty('leak');
    const rows = await turnRows(id);
    expect(rows[0].clarifications[0].leak).toBe(true);
  });

  it('분석이 실패하면 답은 남고, advance가 이어 간다 (Review Focus 2)', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', new Error('boom'));
    await expect(service.submitAnswer(id, answer(turnId))).rejects.toBeInstanceOf(UpstreamError);
    expect((await service.getView(id)).pending).toBe('retry');
    expect((await service.getView(id)).turns[0].answer).toBe('답입니다.');
    const v = await service.advance(id);
    expect(v.turns).toHaveLength(2);
    expect(fake.calls.filter((c) => c.kind === 'analyze')).toHaveLength(2); // 실패 1 + 성공 1
  });

  it('질문 생성이 실패하면 분석은 남고, advance는 분석을 다시 하지 않는다 (Review Focus 2)', async () => {
    const { id, turnId } = await begin();
    fake.once('question', new Error('boom'));
    await expect(service.submitAnswer(id, answer(turnId))).rejects.toBeInstanceOf(UpstreamError);
    expect((await turnRows(id))[0].analysis).not.toBeNull();
    const v = await service.advance(id);
    expect(v.turns).toHaveLength(2);
    expect(calls('analyze')).toHaveLength(1);
  });

  it('secondary가 있는 답 뒤에 질문 생성이 한 번 실패해도, 다시 시도하면 primary가 먼저 묻는다', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', WITH_SECONDARY);
    fake.once('question', new Error('boom'));
    await expect(service.submitAnswer(id, answer(turnId))).rejects.toBeInstanceOf(UpstreamError);
    const v = await service.advance(id);
    expect(v.turns[1].addOn).toBe(false);
    expect(v.turns[1].interviewerId).toBe('p1');
    const after = await answerLast(id);
    expect(after.turns[2].addOn).toBe(true);
    expect(after.turns[2].interviewerId).toBe('p3');
    expect((await turnRows(id))[2].causeTurnId).toBe(turnId);
  });

  it('이미 답한 턴에 온 답은 TURN_NOT_OPEN이고 상태가 그대로다 (Review Focus 3)', async () => {
    const { id, turnId } = await begin();
    await service.submitAnswer(id, answer(turnId));
    const e = (await service
      .submitAnswer(id, answer(turnId))
      .catch((x: unknown) => x)) as ConflictError;
    expect(e).toBeInstanceOf(ConflictError);
    expect(e.code).toBe('TURN_NOT_OPEN');
    const other = (await service
      .submitAnswer(id, answer(randomUUID()))
      .catch((x: unknown) => x)) as ConflictError;
    expect(other.code).toBe('TURN_NOT_OPEN');
    expect(await turnRows(id)).toHaveLength(2);
    expect(calls('analyze')).toHaveLength(1);
  });

  it('없는 세션은 NotFoundError다', async () => {
    await expect(service.getView(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.submitAnswer(randomUUID(), answer(randomUUID()))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.advance(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.finish(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('동시에 온 같은 답 둘 중 하나만 받고, 모델 호출이 겹치지 않는다 (Review Focus 3)', async () => {
    const { id, turnId } = await begin();
    const results = await Promise.allSettled([
      service.submitAnswer(id, answer(turnId)),
      service.submitAnswer(id, answer(turnId)),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as ConflictError).code).toBe('TURN_NOT_OPEN');
    expect(fake.calls.filter((c) => c.kind === 'analyze')).toHaveLength(1);
    expect(fake.calls.filter((c) => c.kind === 'question')).toHaveLength(2); // 첫 질문 + 다음 질문
  });

  it('질문을 만드는 사이에 온 finish는 줄을 서고, 끝난 뒤 턴이 늘지 않는다', async () => {
    const { id, turnId } = await begin();
    let release!: () => void;
    fake.once('question', () => new Promise<object>((r) => (release = () => r(question()))));
    const order: string[] = [];
    const submitting = service.submitAnswer(id, answer(turnId)).then((v) => {
      order.push('submit');
      return v;
    });
    await until(() => calls('question').length === 2);
    const finishing = service.finish(id).then((v) => {
      order.push('finish');
      return v;
    });
    await tick();
    expect(order).toEqual([]);
    release();
    const [submitted, finished] = await Promise.all([submitting, finishing]);
    expect(order).toEqual(['submit', 'finish']);
    expect(submitted.turns).toHaveLength(2);
    expect(finished.status).toBe('finished');
    await expect(service.advance(id)).rejects.toMatchObject({ code: 'NOTHING_TO_RETRY' });
    await expect(service.submitAnswer(id, answer(submitted.turns[1].id))).rejects.toMatchObject({
      code: 'INTERVIEW_FINISHED',
    });
    expect(await turnRows(id)).toHaveLength(2);
  });

  it('질문은 정답지 없이 먼저 나가고, 정답지는 뒤에서 채워진다', async () => {
    const held = hold(fake, 'answerKey', KEY);
    const v = await service.start({ topic: 'Redis' });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0].text).toBe('기본 질문입니다.');
    await until(() => calls('answerKey').length === 1);
    const [before] = await turnRows(v.id);
    expect(before.question.answerKey).toBeNull();
    expect(before.verification).toBeNull();
    expect(before.prepared.answerKeyCorrected).toBe(false);
    expect(calls('verify')).toHaveLength(0);
    held.release();
    await service.settle();
    const [after] = await turnRows(v.id);
    expect(after.question.answerKey?.keyPoints).toEqual(['k1']);
    expect(after.verification).toEqual({ premiseOk: true, problems: [], answerKey: KEY });
    expect(after.question.text).toBe('기본 질문입니다.');
  });

  it('질문을 보여 주기까지 정답지 호출과 검증 호출을 기다리지 않는다', async () => {
    const { id, turnId } = await begin();
    // 첫 질문의 정답지는 분석에 필요하므로 끝까지 둔다. 둘째 질문의 정답지 호출만 붙잡는다.
    await service.settle();
    const held = hold(fake, 'answerKey', KEY);
    const v = await service.submitAnswer(id, answer(turnId));
    expect(v.turns).toHaveLength(2);
    expect(v.pending).toBe('answer');
    await until(() => calls('answerKey').length === 2);
    const rows = await turnRows(id);
    expect(rows[1].question.answerKey).toBeNull();
    expect(calls('verify')).toHaveLength(1);
    held.release();
    await service.settle();
    expect((await turnRows(id))[1].question.answerKey?.keyPoints).toEqual(['k1']);
  });

  it('답이 왔는데 정답지가 아직이면 기다렸다가 분석한다. 정답지 호출은 한 번이다', async () => {
    const held = hold(fake, 'answerKey', { ...KEY, keyPoints: ['k1', '늦은-핵심'] });
    const { id, turnId } = await begin();
    await until(() => calls('answerKey').length === 1);
    const submitting = service.submitAnswer(id, answer(turnId));
    await tick();
    expect(calls('analyze')).toHaveLength(0); // 분석은 진행 중인 정답지 작성을 기다린다
    held.release();
    await submitting;
    const kinds = fake.calls.map((c) => c.kind);
    const beforeAnalyze = kinds.slice(0, kinds.lastIndexOf('analyze'));
    expect(beforeAnalyze.filter((k) => k === 'answerKey')).toHaveLength(1);
    expect(beforeAnalyze.filter((k) => k === 'verify')).toHaveLength(1);
    expect(userOf(lastCall('analyze'))).toContain('k1');
    expect(userOf(lastCall('analyze'))).toContain('늦은-핵심');
  });

  it('앱을 다시 띄운 뒤 답이 오면 정답지를 그때 만든다 (Review Focus 4)', async () => {
    // 닫힌 앱 쪽 호출이라 끝나지 않게 둔다.
    fake.once('answerKey', () => new Promise<object>(() => {}));
    const { id, turnId } = await begin();
    await until(() => calls('answerKey').length === 1);
    await reopen(createFakeAnthropic());
    const v = await service.submitAnswer(id, answer(turnId));
    const kinds = fake.calls.map((c) => c.kind);
    expect(kinds.indexOf('answerKey')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('answerKey')).toBeLessThan(kinds.indexOf('verify'));
    expect(kinds.indexOf('verify')).toBeLessThan(kinds.indexOf('analyze'));
    expect(v.turns).toHaveLength(2);
    const [first] = await turnRows(id);
    expect(first.question.answerKey?.keyPoints).toEqual(['k1']);
    expect(first.verification).not.toBeNull();
  });

  it('검증이 정답지를 고치면 분석은 고친 정답지를 받고 DB에 남는다', async () => {
    const held = hold(fake, 'verify', CORRECTING_VERIFY);
    const { id, turnId } = await begin();
    await until(() => calls('verify').length === 1);
    const submitting = service.submitAnswer(id, answer(turnId));
    await tick();
    expect(calls('analyze')).toHaveLength(0);
    held.release();
    await submitting;
    expect(userOf(lastCall('analyze'))).toContain('고친 핵심');
    const [first] = await turnRows(id);
    expect(first.prepared.answerKeyCorrected).toBe(true);
    expect(first.question.answerKey?.keyPoints).toEqual(['고친 핵심']);
    expect(first.verification).toEqual({
      premiseOk: true,
      problems: CORRECTING_VERIFY.problems,
      answerKey: { ...KEY, keyPoints: ['고친 핵심'] },
    });
    // flags와 attempts는 그대로 남는다.
    expect(first.prepared.flags).toEqual({ leak: false, premise: false });
    expect(first.prepared.attempts).toHaveLength(1);
  });

  it('뒤에서 정답지를 반영해도 그 사이에 저장한 답이 지워지지 않는다', async () => {
    const held = hold(fake, 'answerKey', KEY);
    const { id, turnId } = await begin();
    await until(() => calls('answerKey').length === 1);
    const submitting = service.submitAnswer(id, answer(turnId));
    await tick();
    expect((await turnRows(id))[0].answer).toBe('답입니다.');
    held.release();
    await submitting;
    const [first] = await turnRows(id);
    expect(first.answer).toBe('답입니다.');
    expect(first.answeredAt).toBeInstanceOf(Date);
    expect(first.question.answerKey?.keyPoints).toEqual(['k1']);
    expect(first.verification).not.toBeNull();
    expect(first.analysis).not.toBeNull();
  });

  it('백그라운드 검증이 끝난 뒤 답을 저장해도 검증 결과가 지워지지 않는다', async () => {
    const { id, turnId } = await begin();
    await service.settle();
    expect((await turnRows(id))[0].verification).not.toBeNull();
    await service.submitAnswer(id, answer(turnId));
    const [first] = await turnRows(id);
    expect(first.verification).toEqual({ premiseOk: true, problems: [], answerKey: KEY });
    expect(first.answer).toBe('답입니다.');
    const kinds = fake.calls.map((c) => c.kind);
    expect(kinds.filter((k, i) => k === 'verify' && i < kinds.lastIndexOf('analyze'))).toHaveLength(
      1,
    );
  });

  it('뒤에서 정답지 작성이 실패하면 로그만 남기고, 답이 왔을 때 다시 만든다', async () => {
    fake.once('answerKey', new Error('뒤 작업 실패'));
    const { id, turnId } = await begin();
    await service.settle();
    expect((await turnRows(id))[0].question.answerKey).toBeNull();
    const v = await service.submitAnswer(id, answer(turnId));
    expect(v.turns).toHaveLength(2);
    const kinds = fake.calls.map((c) => c.kind);
    const beforeAnalyze = kinds.slice(0, kinds.lastIndexOf('analyze'));
    expect(beforeAnalyze.filter((k) => k === 'answerKey')).toHaveLength(2);
    expect((await turnRows(id))[0].question.answerKey?.keyPoints).toEqual(['k1']);
  });

  it('답이 온 뒤의 정답지 작성이 실패하면 답은 남고 advance가 정답지부터 이어 간다', async () => {
    fake.once('answerKey', new Error('뒤 작업 실패'));
    fake.once('answerKey', new Error('답 뒤 실패'));
    const { id, turnId } = await begin();
    await service.settle();
    await expect(service.submitAnswer(id, answer(turnId))).rejects.toBeInstanceOf(UpstreamError);
    const [row] = await turnRows(id);
    expect(row.answer).toBe('답입니다.');
    expect(row.question.answerKey).toBeNull();
    expect(row.analysis).toBeNull();
    expect((await service.getView(id)).pending).toBe('retry');
    const from = fake.calls.length;
    const v = await service.advance(id);
    expect(v.turns).toHaveLength(2);
    expect(
      fake.calls
        .slice(from)
        .map((c) => c.kind)
        .slice(0, 3),
    ).toEqual(['answerKey', 'verify', 'analyze']);
  });

  it('가정을 바꾼 질문은 전제 검사를 통과한 뒤에 나간다', async () => {
    const scale = { axis: 'scale', statement: '트래픽이 열 배로 늘어난다' };
    fake.once('question', question({ text: '틀린 전제의 질문', assumption: scale }));
    fake.once('premise', {
      premiseOk: false,
      problems: [{ field: 'text', problem: '전제-오류-문장' }],
    });
    fake.once('question', question({ text: '다시 만든 질문', assumption: scale }));
    const v = await service.start({ topic: 'Redis' });
    expect(v.turns.map((t) => t.text)).toEqual(['다시 만든 질문']);
    expect(calls('premise')).toHaveLength(2);
    expect(userOf(calls('question')[1])).toContain('전제-오류-문장');
    await service.settle();
    const kinds = fake.calls.map((c) => c.kind);
    // 전제 검사는 턴을 저장하기 전, 정답지 작성은 저장한 뒤에 돈다.
    expect(kinds.lastIndexOf('premise')).toBeLessThan(kinds.indexOf('answerKey'));
    const [row] = await turnRows(v.id);
    expect(row.prepared.attempts.map((a) => a.premise?.premiseOk)).toEqual([false, true]);
    expect(row.prepared.flags.premise).toBe(false);
  });

  it('덧붙이기: secondary가 있으면 다음 질문 뒤에 두 번째 면접관이 addOn으로 묻는다', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', WITH_SECONDARY);
    const second = await service.submitAnswer(id, answer(turnId));
    expect(second.turns[1].addOn).toBe(false);
    expect((await sessionRow(id)).pendingSecondary).toMatchObject({
      causeTurnId: turnId,
      choice: { interviewerId: 'p3' },
    });
    const third = await answerLast(id);
    expect(third.turns[2]).toMatchObject({ seq: 3, addOn: true, interviewerId: 'p3' });
    expect(userOf(lastCall('question'))).toContain('덧붙이는 질문');
    expect((await sessionRow(id)).pendingSecondary).toBeNull();
  });

  it('덧붙이기가 기다리는데 지원자가 모른다고 하면 덧붙이기를 버리고 같은 면접관이 넘어간다', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', WITH_SECONDARY);
    await service.submitAnswer(id, answer(turnId));
    fake.once('analyze', UNKNOWN);
    const v = await answerLast(id, 'Memcached는 모르겠습니다.');
    expect(v.turns[2]).toMatchObject({ seq: 3, addOn: false, interviewerId: 'p1' });
    const rows = await turnRows(id);
    expect(rows[2].reactionIntent).toBe('B11');
    expect((await sessionRow(id)).pendingSecondary).toBeNull();
  });

  it('모른다고 한 기술은 세션에 쌓여 이후 질문의 avoidTechs로 간다', async () => {
    const { id, turnId } = await begin();
    fake.once('analyze', UNKNOWN);
    await service.submitAnswer(id, answer(turnId, '잘 모르겠습니다.'));
    const line =
      '지원자가 모른다고 한 기술(질문에 다시 넣지 않는다. 전제로도 쓰지 않는다): Memcached';
    expect(userOf(lastCall('question'))).toContain(line);
    expect((await sessionRow(id)).unknownTechs).toEqual(['Memcached']);
    await answerLast(id);
    expect(userOf(lastCall('question'))).toContain(line);
  });

  it('절반을 넘도록 가정 변경이 없으면 정체성 비교 축을 지정한다', async () => {
    const { id } = await begin();
    await answerLast(id);
    await answerLast(id);
    expect(userOf(lastCall('question'))).not.toContain('identity_swap');
    const v = await answerLast(id);
    expect(v.turns).toHaveLength(4);
    expect(userOf(lastCall('question'))).toContain('가정 변경: identity_swap');
    expect((await turnRows(id))[3].targetAxis).toBe('identity_swap');
  });

  it('질문 수 상한에 닿으면 마지막 답을 분석하고 끝낸다', async () => {
    const { id } = await begin(2);
    await answerLast(id);
    const v = await answerLast(id);
    expect(v.status).toBe('finished');
    expect(v.closing).toEqual({ interviewerId: v.turns[0].interviewerId, text: CLOSING_TEXT });
    expect(v.turns).toHaveLength(2);
    expect(v.pending).toBeNull();
    expect(calls('analyze')).toHaveLength(2);
    expect((await turnRows(id))[1].analysis).not.toBeNull();
    expect((await sessionRow(id)).finishedAt).toBeInstanceOf(Date);
  });

  it('끝난 면접에 온 답은 INTERVIEW_FINISHED', async () => {
    const { id, turnId } = await begin();
    await service.finish(id);
    const e = (await service
      .submitAnswer(id, answer(turnId))
      .catch((x: unknown) => x)) as ConflictError;
    expect(e).toBeInstanceOf(ConflictError);
    expect(e.code).toBe('INTERVIEW_FINISHED');
  });

  it('finish는 답이 없는 턴이 있어도 끝낸다', async () => {
    const { id } = await begin();
    const v = await service.finish(id);
    expect(v.status).toBe('finished');
    expect(v.turns[0].answer).toBeNull();
    expect((await service.finish(id)).status).toBe('finished');
  });

  it('할 일이 없을 때 advance는 NOTHING_TO_RETRY', async () => {
    const { id } = await begin();
    await expect(service.advance(id)).rejects.toMatchObject({ code: 'NOTHING_TO_RETRY' });
  });

  it('호출 사용량이 세션에 남는다(시작 전 호출 포함)', async () => {
    const { id } = await begin();
    await service.settle();
    const usage = app.get(UsageService);
    await usage.flush();
    const roles = (await usage.summarize(id)).map((r) => r.role);
    expect(roles).toEqual(['analyze', 'leak', 'question', 'verify']);
  });

  it('뒤 작업의 정답지·검증 호출도 그 면접의 사용량으로 기록된다', async () => {
    const usage = app.get(UsageService);
    const callsOf = async (sessionId: string) => {
      await service.settle();
      await usage.flush();
      const rows = await usage.summarize(sessionId);
      return Object.fromEntries(rows.map((r) => [r.role, r.calls]));
    };
    const { id } = await begin();
    // 질문 역할: 질문 + 정답지, 검증 역할: 검증. 가정 없는 질문이라 전제 검사는 없다.
    expect(await callsOf(id)).toEqual({ analyze: 1, leak: 1, question: 2, verify: 1 });
    await answerLast(id);
    // 다음 질문에서 시작한 뒤 작업도 같은 면접에 남는다.
    expect(await callsOf(id)).toEqual({ analyze: 2, leak: 2, question: 4, verify: 2 });
  });

  it('시작이 실패하면 세션은 남지 않고 사용량은 남는다', async () => {
    fake.once('question', new Error('boom'));
    const e = (await service.start({ topic: 'Redis' }).catch((x: unknown) => x)) as UpstreamError;
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e.reason).toBe('API_ERROR');
    await app.get(UsageService).flush();
    const count = async (table: string) =>
      Number((await dataSource.query<{ n: string }[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);
    expect(await count('interview_sessions')).toBe(0);
    expect(await count('llm_usage')).toBe(1);
  });

  it('모델이 깨진 JSON을 주면 BAD_RESPONSE이고 오류에 응답 글자가 없다 (Review Focus 1)', async () => {
    fake.once('question', rawText('{"answerKey":{"keyPoints":["비밀-핵심-7731"'));
    const e = (await service.start({ topic: 'Redis' }).catch((x: unknown) => x)) as UpstreamError;
    expect(e).toBeInstanceOf(UpstreamError);
    expect(e.reason).toBe('BAD_RESPONSE');
    expect(e.message).not.toContain('7731');
  });

  it('list는 최근 세션을 질문 수와 함께 최신순으로 준다', async () => {
    const a = await begin();
    await service.submitAnswer(a.id, answer(a.turnId));
    const b = await begin();
    const list = await service.list();
    expect(list.map((s) => [s.id, s.questionCount, s.status])).toEqual([
      [b.id, 1, 'in_progress'],
      [a.id, 2, 'in_progress'],
    ]);
    expect(typeof list[0].createdAt).toBe('string');
  });

  it('뒤에서 정답지 작성이 실패하면 원래 오류의 메시지와 스택을 로그에 남긴다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      fake.once('answerKey', new Error('정답지-실패-4412'));
      const v = await service.start({ topic: 'Redis' });
      await service.settle();
      const logged = warn.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('정답지-실패-4412');
      expect(logged).toContain(v.turns[0].id);
      expect(warn.mock.calls.some((c) => String(c[1]).includes('Error: 정답지-실패-4412'))).toBe(
        true,
      );
    } finally {
      warn.mockRestore();
    }
  });
});

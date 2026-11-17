import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';

import type { AssumptionResult, TurnReview } from '../src/interview/types';
import { AssumptionRecord } from '../src/memory/assumption-record.entity';
import { MemoryService } from '../src/memory/memory.service';
import { InterviewSession } from '../src/session/interview-session.entity';
import { InterviewTurn } from '../src/session/interview-turn.entity';
import { InterviewService } from '../src/session/interview.service';
import { UsageService } from '../src/usage/usage.service';
import { createFakeAnthropic } from './support/fake-anthropic';
import { resetDb } from './support/reset-db';
import { createTestApp } from './support/test-app';

// createdAt만 뗀다. id는 비교에 넣는다.
const strip = ({ id, axis, statement, status, encounters, lastSeenAt }: AssumptionRecord) => ({
  id,
  axis,
  statement,
  status,
  encounters,
  lastSeenAt,
});

describe('가정 기억 (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let memory: MemoryService;

  beforeEach(async () => {
    app = await createTestApp(createFakeAnthropic());
    dataSource = app.get(DataSource);
    memory = app.get(MemoryService);
    await resetDb(dataSource);
  });
  afterEach(async () => {
    await app.get(InterviewService).settle();
    await app.get(UsageService).flush();
    await app.close();
  });

  const review = (result: AssumptionResult | 'none', sameAs: string | null = null): TurnReview => ({
    intent: { aimed: true, note: '' },
    defects: [],
    reactions: [],
    assumption: { result, note: '', sameAs },
    keyProblems: [],
  });

  // 끝난 세션 하나와 가정을 바꾼 턴들을 넣는다. answeredAt은 seq마다 1분씩 늦다.
  async function seed(
    topic: string,
    turns: { review: TurnReview; at: string; surprise?: 'expected' | 'unexpected' }[],
  ): Promise<{ id: string; turnIds: string[] }> {
    const id = randomUUID();
    await dataSource.getRepository(InterviewSession).insert({
      id,
      topic,
      panel: [],
      questionLimit: 6,
      status: 'finished',
      userMentioned: [topic],
      unknownTechs: [],
      pendingSecondary: null,
      memory: { retired: [], reissue: [], expected: [] },
    });
    const turnIds: string[] = [];
    for (const [i, t] of turns.entries()) {
      const turnId = randomUUID();
      turnIds.push(turnId);
      await dataSource.getRepository(InterviewTurn).insert({
        id: turnId,
        sessionId: id,
        seq: i + 1,
        interviewerId: 'p1',
        addOn: false,
        causeTurnId: null,
        reactionIntent: null,
        defect: null,
        targetAxis: null,
        question: {
          text: 'Q',
          questionIntent: 'A1',
          assumption: { axis: 'scale', statement: `${topic}-가정-${i + 1}` },
          answerKey: null,
        },
        prepared: {
          flags: { leak: false, premise: false },
          answerKeyCorrected: false,
          attempts: [],
        },
        verification: null,
        answer: '답',
        answeredAt: new Date(t.at),
        surprise: t.surprise ?? null,
        review: t.review,
      });
    }
    return { id, turnIds };
  }

  const setReview = (turnId: string, r: TurnReview) =>
    dataSource.getRepository(InterviewTurn).update(turnId, { review: r });

  // s1의 가정이 기록 R이 되고, s2의 턴이 R에 합류한다.
  async function joined() {
    const s1 = await seed('Redis', [{ review: review('wobbly'), at: '2026-11-01T00:00:00.000Z' }]);
    await memory.syncSession(s1.id);
    const [r] = await memory.all();
    const s2 = await seed('Kafka', [
      { review: review('well', r.id), at: '2026-11-02T00:00:00.000Z' },
    ]);
    return { s1, s2, r };
  }

  it('syncSession은 여러 번 불러도 기록의 id와 내용이 같다 (Review Focus 5)', async () => {
    const { id } = await seed('Redis', [
      { review: review('wobbly'), at: '2026-11-01T00:00:00.000Z' },
      { review: review('well'), at: '2026-11-01T00:01:00.000Z' },
    ]);
    await memory.syncSession(id);
    const a = await memory.all();
    await memory.syncSession(id);
    const b = await memory.all();
    expect(a).toHaveLength(2);
    expect(b.map(strip)).toEqual(a.map(strip));
  });

  it('결과를 고친 뒤 다시 맞추면 status는 바뀌고 lastSeenAt은 그대로다', async () => {
    const { id, turnIds } = await seed('Redis', [
      { review: review('wobbly'), at: '2026-11-01T00:00:00.000Z' },
    ]);
    await memory.syncSession(id);
    const [before] = await memory.all();
    await setReview(turnIds[0], {
      ...review('wobbly'),
      assumption: { ...review('wobbly').assumption, userResult: 'well' },
    });
    await memory.syncSession(id);
    const [after] = await memory.all();
    expect(before.status).toBe('wobbly');
    expect(after.status).toBe('well');
    expect(after.id).toBe(before.id);
    expect(after.lastSeenAt).toEqual(before.lastSeenAt);
    expect(after.lastSeenAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('두 세션이 같은 가정에 합류한 뒤 첫 세션을 다시 맞춰도 기록이 하나다 (Review Focus 5)', async () => {
    const { s1, s2 } = await joined();
    await memory.syncSession(s2.id);
    await setReview(s1.turnIds[0], {
      ...review('wobbly'),
      assumption: { ...review('wobbly').assumption, userResult: 'wrong' },
    });
    await memory.syncSession(s1.id);
    const all = await memory.all();
    expect(all).toHaveLength(1);
    expect(all[0].encounters.map((e) => e.sessionId).sort()).toEqual([s1.id, s2.id].sort());
  });

  it('두 세션이 합류한 기록에서도 다시 맞춘 뒤 만남의 순서가 그대로다 (Review Focus 5)', async () => {
    const { s1, s2 } = await joined();
    await memory.syncSession(s2.id);
    const before = (await memory.all())[0].encounters;
    await memory.syncSession(s1.id);
    const [after] = await memory.all();
    expect(before.map((e) => e.sessionId)).toEqual([s1.id, s2.id]);
    expect(after.encounters).toEqual(before);
    expect(after.status).toBe('well');
    expect(after.lastSeenAt.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it('서로 다른 두 세션을 동시에 맞춰도 합류한 기록의 만남이 둘 다 남는다 (Review Focus 5)', async () => {
    const { s1, s2 } = await joined();
    await Promise.all([memory.syncSession(s1.id), memory.syncSession(s2.id)]);
    expect(await memory.all()).toHaveLength(1);
    expect((await memory.all())[0].encounters).toHaveLength(2);
  });

  it('두 세션이 같은 기록에 처음 합류하며 동시에 맞춰도 만남이 모두 남는다 (Review Focus 5)', async () => {
    // 위 테스트는 겹침이 실제로 생기는지가 타이밍에 달려 있다. 여기서는 기록 테이블의 쓰기를 막아 두고
    // 맞추기를 둘 다 시작한다. 잠금이 없으면 둘 다 s0의 만남만 든 기록을 읽고, 늦게 쓴 쪽이 다른 쪽의 만남을 지운다.
    const { s1: s0, r } = await joined();
    const s1 = await seed('Go', [
      { review: review('wrong', r.id), at: '2026-11-03T00:00:00.000Z' },
    ]);
    const s2 = await seed('Rust', [
      { review: review('well', r.id), at: '2026-11-04T00:00:00.000Z' },
    ]);
    const blocker = dataSource.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    await blocker.query('LOCK TABLE assumption_records IN SHARE MODE');
    const syncing = Promise.all([memory.syncSession(s1.id), memory.syncSession(s2.id)]);
    for (let i = 0; i < 200; i++) {
      const [{ n }] = await dataSource.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
         WHERE c.relname = 'assumption_records' AND NOT l.granted`,
      );
      if (n > 0) break;
      await new Promise((res) => setTimeout(res, 10));
    }
    // 잠금이 없을 때 둘째 맞추기도 읽기를 마치고 쓰기에서 막히도록 기다린다.
    await new Promise((res) => setTimeout(res, 200));
    await blocker.commitTransaction();
    await blocker.release();
    await syncing;
    const all = await memory.all();
    expect(all).toHaveLength(1);
    expect(all[0].encounters.map((e) => e.sessionId)).toEqual([s0.id, s1.id, s2.id]);
  });

  it('다른 세션의 만남은 건드리지 않는다', async () => {
    const a = await seed('Redis', [{ review: review('wobbly'), at: '2026-11-01T00:00:00.000Z' }]);
    const b = await seed('Kafka', [{ review: review('well'), at: '2026-11-02T00:00:00.000Z' }]);
    await memory.syncSession(a.id);
    await memory.syncSession(b.id);
    const before = await memory.all();
    // a의 가정을 복기에서 없앤 것으로 바꾸면 a의 기록만 사라진다.
    await setReview(a.turnIds[0], review('none'));
    await memory.syncSession(a.id);
    const after = await memory.all();
    expect(before).toHaveLength(2);
    expect(after.map(strip)).toEqual(
      before.filter((r) => r.encounters[0].sessionId === b.id).map(strip),
    );
  });

  it('면접을 시작하면 그때의 기억이 세션에 저장된다', async () => {
    const s = await seed('Redis', [{ review: review('well'), at: '2026-11-01T00:00:00.000Z' }]);
    await memory.syncSession(s.id);
    const v = await app.get(InterviewService).start({ topic: 'Kafka' });
    const row = await dataSource.getRepository(InterviewSession).findOneByOrFail({ id: v.id });
    expect(row.memory.retired).toHaveLength(1);
    expect(row.memory.retired).toEqual([{ axis: 'scale', statement: 'Redis-가정-1' }]);
  });
});
